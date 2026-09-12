-- =============================================================================
-- 0016 - El poco estado que el bot necesita guardar
--
-- POR QUE: el bot corre en Edge Functions, que son isolates efimeros. Cualquier
-- cosa en memoria se pierde entre invocaciones, y peor: dos mensajes seguidos
-- pueden caer en isolates distintos. Hay exactamente tres cosas que no pueden
-- vivir en memoria:
--
--   1. La confirmacion de una escritura. El agente propone "registro $15.000 al
--      automotor de ABC123" y manda un boton. El callback de ese boton llega en
--      OTRA invocacion, casi siempre en otro isolate. Si los argumentos de la
--      escritura estuvieran en un Map, el boton no encontraria nada.
--
--      Meterlos en el callback_data tampoco alcanza: Telegram lo limita a 64
--      bytes y un motivo de anulacion no entra. Y aunque entrara, seria confiar
--      en un dato que viaja por el cliente: cualquiera podria fabricar un
--      callback con otro importe.
--
--   2. Los ultimos turnos de la conversacion. Sin esto, "y el DEF456?" no
--      significa nada porque no hay un "el" anterior.
--
--   3. Nada mas. El resto lo sabe la base y se consulta.
--
-- Las dos tablas son del sistema, como vinculos_telegram: sin politicas de RLS
-- y sin GRANT, o sea que solo service_role las toca. No son datos del inquilino
-- que el usuario deba poder leer con su JWT.
--
-- Ademas va aca avisos_pendientes(), que le arma al despachador todo lo que
-- necesita para un aviso -el vencimiento, la organizacion y a que chats va- en
-- una sola llamada, en vez de las tres por aviso que saldrian de recorrer
-- avisos -> vencimiento -> miembros -> vinculos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Acciones pendientes de confirmacion
--
-- Una escritura que el agente propuso y todavia no ejecuto. Vive minutos: si
-- nadie toca el boton, expira y no pasa nada. Que el "no pasa nada" sea el
-- resultado por defecto es la propiedad importante de esta tabla.
-- ---------------------------------------------------------------------------

create table public.acciones_pendientes (
  -- El id viaja en el callback_data del boton, asi que tiene que ser corto y
  -- no adivinable. 12 caracteres Crockford = 60 bits, el mismo formato que los
  -- codigos de invitacion.
  id               text primary key
                     check (id ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  telegram_user_id bigint not null,
  chat_id          bigint not null,
  herramienta      text not null,
  argumentos       jsonb not null,
  expira_en        timestamptz not null,
  resuelta_en      timestamptz,
  resultado        text check (resultado in ('confirmada', 'cancelada')),
  creado_en        timestamptz not null default now(),

  constraint acciones_resolucion_coherente
    check ((resuelta_en is null) = (resultado is null))
);

comment on table public.acciones_pendientes is
  'Escrituras propuestas por el agente, esperando el boton de confirmacion. De un solo uso y con vencimiento.';

comment on column public.acciones_pendientes.telegram_user_id is
  'Quien tiene que confirmar. Se verifica al canjear: en un grupo, el boton de uno no lo aprieta otro.';

create index acciones_pendientes_vivas_idx
  on public.acciones_pendientes (expira_en)
  where resuelta_en is null;

-- ---------------------------------------------------------------------------
-- Memoria corta de la conversacion
--
-- Solo texto plano: lo que dijo la persona y lo que contesto el bot. No se
-- guardan los tool_use ni los resultados de las herramientas -son grandes,
-- envejecen mal (un monto de ayer ya no es el monto) y el modelo puede volver
-- a consultar. Guardar el resumen y no los datos es a proposito.
-- ---------------------------------------------------------------------------

create table public.mensajes_conversacion (
  id               bigint generated always as identity primary key,
  telegram_user_id bigint not null,
  rol              text not null check (rol in ('usuario', 'asistente')),
  contenido        text not null,
  creado_en        timestamptz not null default now()
);

comment on table public.mensajes_conversacion is
  'Memoria corta del agente: los ultimos turnos de cada chat. Se poda sola.';

create index mensajes_conversacion_chat_idx
  on public.mensajes_conversacion (telegram_user_id, creado_en desc);

-- ---------------------------------------------------------------------------
-- Guardar una accion pendiente
-- ---------------------------------------------------------------------------

create or replace function public.guardar_accion_pendiente(
  p_telegram_user_id bigint,
  p_chat_id bigint,
  p_organizacion_id uuid,
  p_herramienta text,
  p_argumentos jsonb,
  p_minutos integer default 10
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'guardar_accion_pendiente solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  -- Poda oportunista: lo resuelto o vencido hace mas de un dia no le sirve a
  -- nadie. Sale gratis aca y evita tener que programar una limpieza aparte.
  delete from public.acciones_pendientes
  where expira_en < now() - interval '1 day';

  v_id := public.generar_codigo_invitacion();

  insert into public.acciones_pendientes (
    id, organizacion_id, telegram_user_id, chat_id,
    herramienta, argumentos, expira_en
  )
  values (
    v_id, p_organizacion_id, p_telegram_user_id, p_chat_id,
    p_herramienta, p_argumentos, now() + make_interval(mins => greatest(p_minutos, 1))
  );

  return v_id;
end;
$fn$;

comment on function public.guardar_accion_pendiente(bigint, bigint, uuid, text, jsonb, integer) is
  'Deja una escritura esperando confirmacion y devuelve el id que va en el boton. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Canjear la confirmacion
--
-- De un solo uso y atado a quien lo pidio. El update condicional hace las dos
-- cosas en una sentencia: si otra invocacion llego primero, el where no matchea
-- y esta devuelve null. Sin ventana entre leer y marcar.
-- ---------------------------------------------------------------------------

create or replace function public.tomar_accion_pendiente(
  p_id text,
  p_telegram_user_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'tomar_accion_pendiente solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  update public.acciones_pendientes a
  set resuelta_en = now(), resultado = 'confirmada'
  where a.id = p_id
    and a.telegram_user_id = p_telegram_user_id
    and a.resuelta_en is null
    and a.expira_en >= now()
  returning jsonb_build_object(
    'herramienta',     a.herramienta,
    'argumentos',      a.argumentos,
    'organizacion_id', a.organizacion_id,
    'chat_id',         a.chat_id
  )
  into v;

  return v;
end;
$fn$;

comment on function public.tomar_accion_pendiente(text, bigint) is
  'Canjea una confirmacion: de un solo uso y solo para quien la pidio. Devuelve null si ya no vale. Solo service_role.';

create or replace function public.cancelar_accion_pendiente(
  p_id text,
  p_telegram_user_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'cancelar_accion_pendiente solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  update public.acciones_pendientes
  set resuelta_en = now(), resultado = 'cancelada'
  where id = p_id
    and telegram_user_id = p_telegram_user_id
    and resuelta_en is null;

  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Memoria de conversacion
-- ---------------------------------------------------------------------------

create or replace function public.recordar_mensaje(
  p_telegram_user_id bigint,
  p_rol text,
  p_contenido text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'recordar_mensaje solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.mensajes_conversacion (telegram_user_id, rol, contenido)
  values (p_telegram_user_id, p_rol, left(p_contenido, 4000));

  -- La memoria es corta a proposito. Se poda al escribir para no necesitar cron.
  delete from public.mensajes_conversacion
  where telegram_user_id = p_telegram_user_id
    and id not in (
      select id from public.mensajes_conversacion
      where telegram_user_id = p_telegram_user_id
      order by creado_en desc, id desc
      limit 20
    );
end;
$fn$;

comment on function public.recordar_mensaje(bigint, text, text) is
  'Anota un turno de la conversacion y deja solo los ultimos 20. Solo service_role.';

create or replace function public.historial_conversacion(
  p_telegram_user_id bigint,
  p_maximo integer default 8,
  p_minutos integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'historial_conversacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  -- Una charla de hace tres horas no es la misma charla. La ventana de tiempo
  -- evita que el agente conteste sobre un contexto que la persona ya olvido.
  select coalesce(jsonb_agg(jsonb_build_object('rol', t.rol, 'contenido', t.contenido)
                            order by t.creado_en, t.id), '[]'::jsonb)
  into v
  from (
    select m.rol, m.contenido, m.creado_en, m.id
    from public.mensajes_conversacion m
    where m.telegram_user_id = p_telegram_user_id
      and m.creado_en >= now() - make_interval(mins => greatest(p_minutos, 1))
    order by m.creado_en desc, m.id desc
    limit greatest(p_maximo, 1)
  ) t;

  return v;
end;
$fn$;

create or replace function public.olvidar_conversacion(p_telegram_user_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'olvidar_conversacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.mensajes_conversacion where telegram_user_id = p_telegram_user_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Lo que el despachador necesita para mandar los avisos
--
-- Un aviso suelto no se puede mandar: hace falta el vencimiento del que habla,
-- la organizacion a la que pertenece y los chats de sus miembros. Resolverlo
-- desde el bot son tres consultas por aviso; aca es una sola para el lote.
-- ---------------------------------------------------------------------------

create or replace function public.avisos_pendientes(p_limite integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'avisos_pendientes solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(x order by x->>'programado_para', x->>'aviso_id'), '[]'::jsonb)
  into v
  from (
    select jsonb_build_object(
      'aviso_id',        a.id,
      'clave_regla',     a.clave_regla,
      'programado_para', a.programado_para,
      'organizacion_id', a.organizacion_id,
      'organizacion',    o.nombre,
      'vencimiento', jsonb_build_object(
        'id',                e.id,
        'dominio',           e.dominio,
        'tipo',              e.tipo_nombre,
        'periodo',           e.periodo,
        'fecha_vencimiento', e.fecha_vencimiento,
        'monto',             e.monto_vigente,
        'moneda',            e.moneda,
        'estado_efectivo',   e.estado_efectivo,
        'dias_para_vencer',  e.dias_para_vencer
      ),
      'destinatarios', coalesce((
        select jsonb_agg(distinct v.chat_id)
        from public.miembros m
        join public.vinculos_telegram v on v.usuario_id = m.usuario_id
        where m.organizacion_id = a.organizacion_id
      ), '[]'::jsonb)
    ) as x
    from public.avisos a
    join public.organizaciones o          on o.id = a.organizacion_id
    join public.v_vencimientos_estado e   on e.id = a.vencimiento_id
    where a.enviado_en is null
    order by a.programado_para, a.id
    limit greatest(p_limite, 1)
  ) s;

  return v;
end;
$fn$;

comment on function public.avisos_pendientes(integer) is
  'Los avisos sin despachar, ya resueltos contra su vencimiento y los chats a los que van. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Permisos
--
-- Ninguno. Desde 0011 una funcion nueva nace sin GRANT, y estas son todas del
-- servidor: service_role y nada mas. Las dos tablas quedan con RLS activo y sin
-- politicas, que es la forma de decir "por PostgREST no se entra".
-- ---------------------------------------------------------------------------

alter table public.acciones_pendientes    enable row level security;
alter table public.mensajes_conversacion  enable row level security;
