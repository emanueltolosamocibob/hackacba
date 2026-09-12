-- =============================================================================
-- 0016 - Vinculos de chat neutrales por canal
--
-- POR QUE: Telegram se descarto como canal. Las funciones de 0012 y 0013
-- estaban atadas a dos bigint de Telegram. Se reemplazan por un vinculo unico
-- y neutral, identificado por (canal, identificador_externo).
-- =============================================================================

-- La sustitucion es destructiva y solo es segura mientras la tabla vieja este
-- vacia. Una fila real necesita una decision humana: un id de Telegram no se
-- puede convertir automaticamente en un identificador de WhatsApp.
do $guarda$
begin
  if exists (select 1 from public.vinculos_telegram) then
    raise exception 'vinculos_telegram tiene filas: migrarlas antes de aplicar 0016'
      using errcode = 'raise_exception';
  end if;
end;
$guarda$;

-- Todas estas firmas cambian. Se eliminan antes que la tabla que referencian.
drop function if exists public.aplicar_invitacion(uuid, uuid, bigint, bigint, text, text);
drop function if exists public.canjear_por_telefono(text, uuid, bigint, bigint, text);
drop function if exists public.canjear_invitacion(text, uuid, bigint, bigint, text);
drop function if exists public.contexto_telegram(bigint);
drop function if exists public.cambiar_organizacion_activa(bigint, uuid);
drop function if exists public.desvincular_telegram(bigint);
drop function if exists public.registrar_organizacion(text, text, text, text, text);

drop table public.vinculos_telegram;

create type public.canal_chat as enum ('whatsapp');

create table public.vinculos_chat (
  id                     uuid primary key default gen_random_uuid(),
  usuario_id             uuid not null references auth.users (id) on delete cascade,
  canal                  public.canal_chat not null,
  identificador_externo  text not null,
  jid_crudo              text,
  nombre_mostrado        text,
  telefono               text,
  telefono_clave         text generated always as (public.clave_telefono(telefono)) stored,
  organizacion_activa_id uuid references public.organizaciones (id) on delete set null,
  vinculado_en           timestamptz not null default now(),
  ultimo_uso_en          timestamptz,
  unique (canal, identificador_externo),
  unique (canal, usuario_id)
);

comment on table public.vinculos_chat is
  'Que usuario esta detras de cada chat, en cualquier canal. NO se expone por '
  'PostgREST: la maneja el bot con service_role y punto.';

comment on column public.vinculos_chat.identificador_externo is
  'Identificador canonico derivado por el canal. En WhatsApp es '
  '<clave_telefono>@whatsapp, no el JID crudo.';

comment on column public.vinculos_chat.jid_crudo is
  'Identificador recibido del proveedor, usado para responder. Puede cambiar de '
  'forma sin que cambie la identidad canonica.';

create index vinculos_chat_usuario_idx on public.vinculos_chat (usuario_id);

-- Evita que dos usuarios queden vinculados al mismo telefono. Es parcial
-- porque un vinculo creado por codigo puede no tener telefono todavia.
create unique index vinculos_chat_telefono_uk on public.vinculos_chat (telefono_clave)
  where telefono_clave is not null;

alter table public.vinculos_chat enable row level security;
-- Sin politicas ni grants de tabla: solo service_role y conexiones directas.

-- ---------------------------------------------------------------------------
-- Aplicar una invitacion: parte comun de los dos caminos de canje
-- ---------------------------------------------------------------------------

create or replace function public.aplicar_invitacion(
  p_invitacion_id uuid,
  p_usuario_id uuid,
  p_canal public.canal_chat,
  p_identificador_externo text,
  p_nombre_mostrado text,
  p_telefono_verificado text
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
    raise exception 'aplicar_invitacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.* into v_inv
  from public.invitaciones i
  where i.id = p_invitacion_id
  for update;

  if not found then
    raise exception 'Invitacion inexistente' using errcode = 'no_data_found';
  end if;

  insert into public.miembros (organizacion_id, usuario_id, rol)
  values (v_inv.organizacion_id, p_usuario_id, v_inv.rol)
  on conflict (organizacion_id, usuario_id) do nothing;

  insert into public.vinculos_chat as v (
    usuario_id, canal, identificador_externo, jid_crudo, nombre_mostrado,
    telefono, organizacion_activa_id, ultimo_uso_en
  )
  values (
    p_usuario_id, p_canal, p_identificador_externo, p_identificador_externo,
    p_nombre_mostrado, p_telefono_verificado, v_inv.organizacion_id, now()
  )
  on conflict (canal, identificador_externo) do update set
    jid_crudo              = excluded.jid_crudo,
    nombre_mostrado        = coalesce(excluded.nombre_mostrado, v.nombre_mostrado),
    telefono               = coalesce(excluded.telefono, v.telefono),
    organizacion_activa_id = excluded.organizacion_activa_id,
    ultimo_uso_en          = now();

  update public.invitaciones
  set usada_en = now(), usada_por = p_usuario_id
  where id = v_inv.id;

  select o.nombre into v_nombre
  from public.organizaciones o
  where o.id = v_inv.organizacion_id;

  return jsonb_build_object(
    'organizacion_id', v_inv.organizacion_id,
    'organizacion',    v_nombre,
    'rol',             v_inv.rol,
    'usuario_id',      p_usuario_id
  );

exception
  when unique_violation then
    raise exception 'Ese usuario ya esta vinculado a otro chat'
      using errcode = 'invalid_parameter_value';
end;
$fn$;

comment on function public.aplicar_invitacion(uuid, uuid, public.canal_chat, text, text, text) is
  'Parte comun del canje: membresia, vinculo y marcado de la invitacion. Interna.';

-- ---------------------------------------------------------------------------
-- Canje por telefono verificado
-- ---------------------------------------------------------------------------

create or replace function public.canjear_por_telefono(
  p_telefono_verificado text,
  p_usuario_id uuid,
  p_canal public.canal_chat,
  p_identificador_externo text,
  p_nombre_mostrado text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_clave text := public.clave_telefono(p_telefono_verificado);
  v_id    uuid;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'canjear_por_telefono solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if v_clave is null or length(v_clave) < 8 then
    raise exception 'Telefono invalido' using errcode = 'invalid_parameter_value';
  end if;

  select i.id into v_id
  from public.invitaciones i
  where i.telefono_clave = v_clave
    and not i.anulada
    and i.usada_en is null
    and i.expira_en >= now()
  order by i.creado_en
  limit 1;

  if v_id is null then
    raise exception 'No hay ninguna invitacion pendiente para ese numero'
      using errcode = 'invalid_parameter_value';
  end if;

  return public.aplicar_invitacion(
    v_id, p_usuario_id, p_canal, p_identificador_externo,
    p_nombre_mostrado, p_telefono_verificado
  );
end;
$fn$;

comment on function public.canjear_por_telefono(text, uuid, public.canal_chat, text, text) is
  'Alta con un numero verificado por el canal. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Canje por codigo
-- ---------------------------------------------------------------------------

create or replace function public.canjear_invitacion(
  p_codigo text,
  p_usuario_id uuid,
  p_canal public.canal_chat,
  p_identificador_externo text,
  p_nombre_mostrado text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'canjear_invitacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.id into v_id
  from public.invitaciones i
  where i.codigo = upper(btrim(p_codigo))
    and not i.anulada
    and i.usada_en is null
    and i.expira_en >= now();

  if v_id is null then
    raise exception 'Codigo de invitacion invalido, vencido o ya utilizado'
      using errcode = 'invalid_parameter_value';
  end if;

  return public.aplicar_invitacion(
    v_id, p_usuario_id, p_canal, p_identificador_externo, p_nombre_mostrado, null
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Contexto del chat
-- ---------------------------------------------------------------------------

create or replace function public.contexto_chat(
  p_canal public.canal_chat,
  p_identificador_externo text
)
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
    raise exception 'contexto_chat solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_vinculo
  from public.vinculos_chat v
  where v.canal = p_canal
    and v.identificador_externo = p_identificador_externo;

  if not found then
    return jsonb_build_object('vinculado', false);
  end if;

  update public.vinculos_chat
  set ultimo_uso_en = now()
  where canal = p_canal
    and identificador_externo = p_identificador_externo;

  select jsonb_build_object(
    'vinculado',              true,
    'usuario_id',             v_vinculo.usuario_id,
    'canal',                  v_vinculo.canal,
    'identificador_externo',  v_vinculo.identificador_externo,
    'organizacion_activa', (
      select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'rol', m.rol)
      from public.organizaciones o
      join public.miembros m
        on m.organizacion_id = o.id
       and m.usuario_id = v_vinculo.usuario_id
      where o.id = v_vinculo.organizacion_activa_id
    ),
    'organizaciones', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', o.id, 'nombre', o.nombre, 'rol', m.rol)
        order by o.nombre
      )
      from public.miembros m
      join public.organizaciones o on o.id = m.organizacion_id
      where m.usuario_id = v_vinculo.usuario_id
    ), '[]'::jsonb)
  ) into v_salida;

  return v_salida;
end;
$fn$;

comment on function public.contexto_chat(public.canal_chat, text) is
  'Quien es este chat, sobre que organizacion opera y a cuales pertenece. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Cambiar de organizacion activa y desvincular
-- ---------------------------------------------------------------------------

create or replace function public.cambiar_organizacion_activa(
  p_canal public.canal_chat,
  p_identificador_externo text,
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
  from public.vinculos_chat v
  where v.canal = p_canal
    and v.identificador_externo = p_identificador_externo;

  if not found then
    raise exception 'Ese chat no esta vinculado' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.miembros m
    where m.usuario_id = v_usuario
      and m.organizacion_id = p_organizacion_id
  ) then
    raise exception 'El usuario no pertenece a esa organizacion'
      using errcode = 'insufficient_privilege';
  end if;

  update public.vinculos_chat
  set organizacion_activa_id = p_organizacion_id,
      ultimo_uso_en = now()
  where canal = p_canal
    and identificador_externo = p_identificador_externo;

  select o.nombre into v_nombre
  from public.organizaciones o
  where o.id = p_organizacion_id;

  return jsonb_build_object('organizacion_id', p_organizacion_id, 'organizacion', v_nombre);
end;
$fn$;

create or replace function public.desvincular_chat(
  p_canal public.canal_chat,
  p_identificador_externo text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_borrados integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'desvincular_chat solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.vinculos_chat
  where canal = p_canal
    and identificador_externo = p_identificador_externo;
  get diagnostics v_borrados = row_count;

  return v_borrados > 0;
end;
$fn$;

comment on function public.desvincular_chat(public.canal_chat, text) is
  'Suelta el chat, NO quita la membresia. Sacar a alguien es borrar su fila de miembros.';

-- ---------------------------------------------------------------------------
-- Alta completa de una organizacion, ahora con flota inicial
-- ---------------------------------------------------------------------------

create or replace function public.registrar_organizacion(
  p_nombre text,
  p_telefono_admin text,
  p_email_admin text default null,
  p_cuit text default null,
  p_zona_horaria text default 'America/Argentina/Cordoba',
  p_nombre_flota text default 'Principal'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org   uuid;
  v_flota uuid;
  v_inv   jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'registrar_organizacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizaciones (nombre, cuit, zona_horaria)
  values (
    left(btrim(p_nombre), 120),
    nullif(btrim(coalesce(p_cuit, '')), ''),
    p_zona_horaria
  )
  returning id into v_org;

  perform public.sembrar_catalogo_cordoba(v_org);

  insert into public.flotas (organizacion_id, nombre)
  values (v_org, left(btrim(p_nombre_flota), 120))
  returning id into v_flota;

  v_inv := public.crear_invitacion(
    v_org, 'propietario', p_telefono_admin, p_email_admin, 30
  );

  return jsonb_build_object(
    'organizacion_id', v_org,
    'nombre',          left(btrim(p_nombre), 120),
    'flota_id',        v_flota,
    'invitacion',      v_inv
  );
end;
$fn$;

comment on function public.registrar_organizacion(text, text, text, text, text, text) is
  'Crea la organizacion, el catalogo, la flota inicial y la invitacion de propietario. Solo service_role.';

-- ---------------------------------------------------------------------------
-- La forma de la patente pasa a ser una regla de la base
-- ---------------------------------------------------------------------------

create or replace function public.fn_normalizar_dominio()
returns trigger
language plpgsql
as $fn$
begin
  new.dominio := upper(regexp_replace(coalesce(new.dominio, ''), '[^A-Za-z0-9]', '', 'g'));

  if new.dominio !~ '^[A-Z]{3}[0-9]{3}$'
     and new.dominio !~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$'
     and new.dominio !~ '^[A-Z][0-9]{3}[A-Z]{3}$' then
    raise exception
      'Dominio invalido: "%". Formatos validos: AAA123, AB123CD o A123BCD.',
      new.dominio
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- 0011 revoco las funciones que ya existian, pero cada migracion nueva deja
-- explicita su superficie. Ninguna de estas funciones es publica para clientes.
revoke execute on function public.aplicar_invitacion(uuid, uuid, public.canal_chat, text, text, text) from public, anon, authenticated;
revoke execute on function public.canjear_por_telefono(text, uuid, public.canal_chat, text, text) from public, anon, authenticated;
revoke execute on function public.canjear_invitacion(text, uuid, public.canal_chat, text, text) from public, anon, authenticated;
revoke execute on function public.contexto_chat(public.canal_chat, text) from public, anon, authenticated;
revoke execute on function public.cambiar_organizacion_activa(public.canal_chat, text, uuid) from public, anon, authenticated;
revoke execute on function public.desvincular_chat(public.canal_chat, text) from public, anon, authenticated;
revoke execute on function public.registrar_organizacion(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.fn_normalizar_dominio() from public, anon, authenticated;
