-- =============================================================================
-- 0012 - Vinculos de Telegram e invitaciones
--
-- Habilita el alta de usuarios desde el bot. Hoy no hay interfaz web, asi que
-- el bot es la unica puerta de entrada: la invitacion no "vincula un usuario
-- existente", tiene que crear el usuario, la membresia y el vinculo de una vez.
--
-- Reparto con el bot: crear el usuario de auth NO se puede hacer bien desde SQL
-- (auth.users tiene su propia maquinaria). Entonces el bot, con service_role:
--   1. crea o encuentra el usuario via Auth Admin API
--   2. llama a canjear_invitacion() con ese usuario_id
-- Todo lo demas -- validar el codigo, dar la membresia, atar el chat -- pasa
-- aca adentro, en una sola transaccion.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Generacion de codigos
--
-- gen_random_uuid() es CSPRNG y viene en el core: no depende de pgcrypto ni de
-- en que esquema este instalado. random() NO sirve aca: es un PRNG predecible y
-- esto es una credencial de acceso.
--
-- Alfabeto Crockford base32 (sin I, L, O, U): 32 caracteres exactos, asi que el
-- modulo sobre un byte no introduce sesgo. 12 caracteres = 60 bits.
-- ---------------------------------------------------------------------------

create or replace function public.generar_codigo_invitacion()
returns text
language sql
volatile
set search_path = ''
as $fn$
  select string_agg(
           substr(
             '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
             (get_byte(s.b, i) % 32) + 1,
             1
           ),
           '' order by i
         )
  from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as b) s,
       generate_series(0, 11) as i;
$fn$;

comment on function public.generar_codigo_invitacion() is
  'Codigo de 12 caracteres en alfabeto Crockford base32, derivado de gen_random_uuid().';

-- ---------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------

create table public.invitaciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  codigo          text not null unique check (codigo ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  email           text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  rol             public.rol_miembro not null default 'operador',
  creada_por      uuid references auth.users (id) on delete set null,
  expira_en       timestamptz not null,
  anulada         boolean not null default false,
  usada_en        timestamptz,
  usada_por       uuid references auth.users (id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- Ceder la propiedad de una flota tiene que ser un acto deliberado, no el
  -- efecto lateral de un codigo que circula por ahi.
  constraint invitaciones_no_crean_propietarios
    check (rol <> 'propietario'),

  constraint invitaciones_uso_coherente
    check ((usada_en is null) = (usada_por is null))
);

comment on table public.invitaciones is
  'Codigos de alta, de un solo uso. Uno por persona: es lo que permite auditar quien dejo entrar a quien.';

comment on column public.invitaciones.email is
  'Con que direccion se crea la cuenta. Real, no sintetica, para que el mismo usuario '
  'pueda entrar despues por la Mini App.';

create index invitaciones_vigentes_idx
  on public.invitaciones (organizacion_id, expira_en)
  where not anulada and usada_en is null;

-- ---------------------------------------------------------------------------
-- Vinculos de Telegram
--
-- Relacion 1 a 1 en los dos sentidos: una cuenta de Telegram corresponde a un
-- usuario y viceversa.
-- ---------------------------------------------------------------------------

create table public.vinculos_telegram (
  id                     uuid primary key default gen_random_uuid(),
  usuario_id             uuid not null unique references auth.users (id) on delete cascade,
  telegram_user_id       bigint not null unique,
  chat_id                bigint not null,
  nombre_telegram        text,
  organizacion_activa_id uuid references public.organizaciones (id) on delete set null,
  vinculado_en           timestamptz not null default now(),
  ultimo_uso_en          timestamptz
);

comment on table public.vinculos_telegram is
  'Que usuario esta detras de cada chat de Telegram. NO se expone por PostgREST: '
  'la maneja el bot con service_role y punto.';

comment on column public.vinculos_telegram.organizacion_activa_id is
  'Sobre que organizacion opera este chat. Existe porque un usuario puede pertenecer '
  'a varias y el chat necesita saber de cual esta hablando.';

create index vinculos_telegram_usuario_idx on public.vinculos_telegram (usuario_id);

-- ---------------------------------------------------------------------------
-- Crear una invitacion (la usa un administrador desde el bot o la futura web)
-- ---------------------------------------------------------------------------

create or replace function public.crear_invitacion(
  p_organizacion_id uuid,
  p_email text,
  p_rol public.rol_miembro default 'operador',
  p_dias_validez integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_codigo   text;
  v_id       uuid;
  v_expira   timestamptz;
  v_intentos integer := 0;
begin
  if not (public.puede_administrar(p_organizacion_id) or public.es_tarea_de_sistema()) then
    raise exception 'Sin permisos para invitar a la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_rol = 'propietario' then
    raise exception 'No se puede invitar como propietario: la propiedad se transfiere aparte'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_dias_validez not between 1 and 90 then
    raise exception 'La validez debe estar entre 1 y 90 dias (recibido %)', p_dias_validez
      using errcode = 'invalid_parameter_value';
  end if;

  v_expira := now() + make_interval(days => p_dias_validez);

  -- 60 bits hacen la colision practicamente imposible, pero el reintento cuesta
  -- nada y evita un fallo raro e inexplicable.
  loop
    v_intentos := v_intentos + 1;
    v_codigo := public.generar_codigo_invitacion();

    begin
      insert into public.invitaciones (organizacion_id, codigo, email, rol, creada_por, expira_en)
      values (p_organizacion_id, v_codigo, lower(btrim(p_email)), p_rol, (select auth.uid()), v_expira)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_intentos >= 5 then
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'invitacion_id', v_id,
    'codigo',        v_codigo,
    'email',         lower(btrim(p_email)),
    'rol',           p_rol,
    'expira_en',     v_expira
  );
end;
$fn$;

comment on function public.crear_invitacion(uuid, text, public.rol_miembro, integer) is
  'Genera un codigo de alta de un solo uso. El bot arma con el el enlace t.me/<bot>?start=<codigo>.';

-- ---------------------------------------------------------------------------
-- Canjear la invitacion
--
-- Solo desde el servidor: el bot ya creo el usuario de auth y pasa su id.
-- ---------------------------------------------------------------------------

create or replace function public.canjear_invitacion(
  p_codigo text,
  p_usuario_id uuid,
  p_telegram_user_id bigint,
  p_chat_id bigint,
  p_nombre_telegram text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inv    record;
  v_nombre text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'canjear_invitacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.* into v_inv
  from public.invitaciones i
  where i.codigo = upper(btrim(p_codigo))
  for update;

  -- Un unico mensaje para todos los fallos, a proposito: distinguir "no existe"
  -- de "ya se uso" le confirmaria a quien esta probando codigos que acerto uno.
  if not found
     or v_inv.anulada
     or v_inv.usada_en is not null
     or v_inv.expira_en < now() then
    raise exception 'Codigo de invitacion invalido, vencido o ya utilizado'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.miembros (organizacion_id, usuario_id, rol)
  values (v_inv.organizacion_id, p_usuario_id, v_inv.rol)
  on conflict (organizacion_id, usuario_id) do nothing;

  insert into public.vinculos_telegram as v (
    usuario_id, telegram_user_id, chat_id, nombre_telegram, organizacion_activa_id, ultimo_uso_en
  )
  values (
    p_usuario_id, p_telegram_user_id, p_chat_id, p_nombre_telegram, v_inv.organizacion_id, now()
  )
  on conflict (telegram_user_id) do update set
    chat_id                = excluded.chat_id,
    nombre_telegram        = coalesce(excluded.nombre_telegram, v.nombre_telegram),
    organizacion_activa_id = excluded.organizacion_activa_id,
    ultimo_uso_en          = now();

  update public.invitaciones
  set usada_en = now(), usada_por = p_usuario_id
  where id = v_inv.id;

  select o.nombre into v_nombre
  from public.organizaciones o where o.id = v_inv.organizacion_id;

  return jsonb_build_object(
    'organizacion_id', v_inv.organizacion_id,
    'organizacion',    v_nombre,
    'rol',             v_inv.rol,
    'usuario_id',      p_usuario_id
  );

exception
  -- El unique de usuario_id: esa cuenta ya tiene otro Telegram atado.
  when unique_violation then
    raise exception 'Ese usuario ya esta vinculado a otra cuenta de Telegram'
      using errcode = 'invalid_parameter_value';
end;
$fn$;

comment on function public.canjear_invitacion(text, uuid, bigint, bigint, text) is
  'Valida el codigo, da la membresia y ata el chat, todo en una transaccion. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Contexto de un chat: lo primero que consulta el bot en cada mensaje
-- ---------------------------------------------------------------------------

create or replace function public.contexto_telegram(p_telegram_user_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vinculo record;
  v_salida  jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'contexto_telegram solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_vinculo
  from public.vinculos_telegram v
  where v.telegram_user_id = p_telegram_user_id;

  if not found then
    return jsonb_build_object('vinculado', false);
  end if;

  update public.vinculos_telegram
  set ultimo_uso_en = now()
  where telegram_user_id = p_telegram_user_id;

  select jsonb_build_object(
    'vinculado',   true,
    'usuario_id',  v_vinculo.usuario_id,
    'chat_id',     v_vinculo.chat_id,
    'organizacion_activa', (
      select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'rol', m.rol)
      from public.organizaciones o
      join public.miembros m on m.organizacion_id = o.id and m.usuario_id = v_vinculo.usuario_id
      where o.id = v_vinculo.organizacion_activa_id
    ),
    'organizaciones', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'rol', m.rol) order by o.nombre)
      from public.miembros m
      join public.organizaciones o on o.id = m.organizacion_id
      where m.usuario_id = v_vinculo.usuario_id
    ), '[]'::jsonb)
  )
  into v_salida;

  return v_salida;
end;
$fn$;

comment on function public.contexto_telegram(bigint) is
  'Quien es este chat, sobre que organizacion opera y a cuales pertenece. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Cambiar de organizacion activa y desvincular
-- ---------------------------------------------------------------------------

create or replace function public.cambiar_organizacion_activa(
  p_telegram_user_id bigint,
  p_organizacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_usuario uuid;
  v_nombre  text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'cambiar_organizacion_activa solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select v.usuario_id into v_usuario
  from public.vinculos_telegram v
  where v.telegram_user_id = p_telegram_user_id;

  if not found then
    raise exception 'Ese chat no esta vinculado' using errcode = 'no_data_found';
  end if;

  -- Verificar la membresia aca y no confiar en el bot: es la unica barrera.
  if not exists (
    select 1 from public.miembros m
    where m.usuario_id = v_usuario and m.organizacion_id = p_organizacion_id
  ) then
    raise exception 'El usuario no pertenece a esa organizacion'
      using errcode = 'insufficient_privilege';
  end if;

  update public.vinculos_telegram
  set organizacion_activa_id = p_organizacion_id, ultimo_uso_en = now()
  where telegram_user_id = p_telegram_user_id;

  select o.nombre into v_nombre from public.organizaciones o where o.id = p_organizacion_id;

  return jsonb_build_object('organizacion_id', p_organizacion_id, 'organizacion', v_nombre);
end;
$fn$;

create or replace function public.desvincular_telegram(p_telegram_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_borrados integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'desvincular_telegram solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.vinculos_telegram where telegram_user_id = p_telegram_user_id;
  get diagnostics v_borrados = row_count;

  return v_borrados > 0;
end;
$fn$;

comment on function public.desvincular_telegram(bigint) is
  'Suelta el chat, NO quita la membresia. Sacar a alguien de la organizacion es borrar su fila de miembros.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger trg_invitaciones_actualizacion before update on public.invitaciones
  for each row execute function public.fn_marcar_actualizacion();

create trigger trg_invitaciones_auditoria after insert or update or delete on public.invitaciones
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.invitaciones      enable row level security;
alter table public.vinculos_telegram enable row level security;

-- invitaciones: solo administradores de la organizacion, y nunca anon.
create policy invitaciones_lectura on public.invitaciones
  for select to authenticated
  using (
    organizacion_id in (select public.organizaciones_del_usuario())
    and public.puede_administrar(organizacion_id)
  );

create policy invitaciones_modificacion on public.invitaciones
  for update to authenticated
  using (public.puede_administrar(organizacion_id))
  with check (public.puede_administrar(organizacion_id));

create policy invitaciones_baja on public.invitaciones
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- El alta pasa solo por crear_invitacion(), que genera el codigo. Sin politica
-- de INSERT, nadie puede crear una invitacion con un codigo elegido a mano.

-- vinculos_telegram: sin politicas y sin GRANT. Solo service_role la toca.

grant select, update, delete on public.invitaciones to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos (desde 0011 hay que concederlos uno por uno)
-- ---------------------------------------------------------------------------

grant execute on function
  public.crear_invitacion(uuid, text, public.rol_miembro, integer)
  to authenticated;

-- Sin GRANT, y por lo tanto reservadas a service_role:
--   generar_codigo_invitacion, canjear_invitacion, contexto_telegram,
--   cambiar_organizacion_activa, desvincular_telegram
