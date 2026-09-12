-- =============================================================================
-- 0020 - Bot de WhatsApp: contexto de chat, alta de dominio y deduplicacion
--
-- CONTEXTO: el bot recibe mensajes por el webhook de WAHA con service_role.
-- Nunca consulta tablas de negocio directamente (regla del proyecto): expone
-- tres RPC angostas que derivan la organizacion desde el vinculo de chat ya
-- finalizado (0016/0019), y una cuarta para deduplicar mensajes entrantes.
--
-- Nacen sin permisos (0011 revoca EXECUTE por defecto). Las cuatro son de uso
-- interno del bot: GRANT solo a service_role, nunca a authenticated/anon.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Deduplicacion de mensajes entrantes de WAHA
-- ---------------------------------------------------------------------------

create table public.mensajes_whatsapp_procesados (
  id_mensaje  text primary key,
  recibido_en timestamptz not null default now()
);

comment on table public.mensajes_whatsapp_procesados is
  'Ids de mensaje de WAHA ya procesados por el webhook, para no responder dos '
  'veces ante un reintento del proveedor. Sin texto ni telefono.';

alter table public.mensajes_whatsapp_procesados enable row level security;
-- Sin politicas ni GRANT de tabla: solo la toca marcar_mensaje_procesado.

create or replace function public.marcar_mensaje_procesado(p_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'marcar_mensaje_procesado solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id is null or btrim(p_id) = '' then
    raise exception 'Falta el id del mensaje' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.mensajes_whatsapp_procesados (id_mensaje)
  values (p_id)
  on conflict (id_mensaje) do nothing;

  return found;
end;
$fn$;

comment on function public.marcar_mensaje_procesado(text) is
  'Registra un id de mensaje de WAHA. Devuelve true la primera vez, false si ya '
  'estaba (reintento del proveedor). Interna, solo service_role.';

-- ---------------------------------------------------------------------------
-- contexto_chat_whatsapp: quien escribe y a que organizacion pertenece
-- ---------------------------------------------------------------------------

-- vinculos_chat.ultimo_dominio: la ultima patente consultada desde ese chat.
-- Vive en la tabla del vinculo (no en una tabla aparte) porque es 1:1 con el
-- chat y necesita sobrevivir entre invocaciones de la Edge Function (cada
-- isolate arranca en blanco); asi el comando "link de pago" puede referirse a
-- "la ultima patente" sin que el cliente la repita.
alter table public.vinculos_chat add column ultimo_dominio text;

create or replace function public.contexto_chat_whatsapp(p_telefono text)
returns table (
  usuario_id          uuid,
  organizacion_id     uuid,
  nombre_organizacion text,
  ultimo_dominio      text
)
language plpgsql
security definer
set search_path = ''
stable
as $fn$
declare
  v_clave text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'contexto_chat_whatsapp solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  v_clave := public.clave_telefono(p_telefono);
  if v_clave is null or char_length(v_clave) <> 10 then
    return;
  end if;

  return query
  select v.usuario_id, v.organizacion_activa_id, o.nombre, v.ultimo_dominio
  from public.vinculos_chat v
  join public.organizaciones o on o.id = v.organizacion_activa_id
  where v.canal = 'whatsapp'
    and v.telefono_clave = v_clave
    and v.organizacion_activa_id is not null;
end;
$fn$;

comment on function public.contexto_chat_whatsapp(text) is
  'Usuario, organizacion y ultima patente consultada de un numero de WhatsApp, '
  'solo para vinculos ya finalizados (con organizacion activa). Vacio si el '
  'numero no esta dado de alta o el alta quedo a mitad de camino. Interna, '
  'solo service_role.';

-- ---------------------------------------------------------------------------
-- registrar_dominio_chat: alta o reactivacion de un dominio en la flota
-- ---------------------------------------------------------------------------

create or replace function public.registrar_dominio_chat(
  p_organizacion_id uuid,
  p_dominio text,
  p_telefono text default null
)
returns table (vehiculo_id uuid, es_nuevo boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_dominio text;
  v_flota_id uuid;
  v_vehiculo record;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'registrar_dominio_chat solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  v_dominio := upper(regexp_replace(coalesce(p_dominio, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_dominio !~ '^[A-Z]{3}[0-9]{3}$' and v_dominio !~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' then
    raise exception 'Dominio invalido: %', p_dominio
      using errcode = 'invalid_parameter_value', detail = 'dominio_invalido';
  end if;

  if p_telefono is not null then
    update public.vinculos_chat
    set ultimo_dominio = v_dominio
    where canal = 'whatsapp'
      and telefono_clave = public.clave_telefono(p_telefono)
      and organizacion_activa_id = p_organizacion_id;
  end if;

  select f.id into v_flota_id
  from public.flotas f
  where f.organizacion_id = p_organizacion_id and f.activa
  order by f.creado_en
  limit 1;

  if v_flota_id is null then
    insert into public.flotas (organizacion_id, nombre)
    values (p_organizacion_id, 'Flota principal')
    returning id into v_flota_id;
  end if;

  select v.id, v.estado into v_vehiculo
  from public.vehiculos v
  where v.organizacion_id = p_organizacion_id and v.dominio = v_dominio
  for update;

  if not found then
    insert into public.vehiculos (organizacion_id, flota_id, dominio)
    values (p_organizacion_id, v_flota_id, v_dominio)
    returning id into vehiculo_id;
    es_nuevo := true;
    return next;
    return;
  end if;

  vehiculo_id := v_vehiculo.id;
  es_nuevo := false;

  if v_vehiculo.estado <> 'activo' then
    update public.vehiculos
    set estado = 'activo', fecha_baja = null, actualizado_en = now()
    where id = v_vehiculo.id;
  end if;

  return next;
end;
$fn$;

comment on function public.registrar_dominio_chat(uuid, text, text) is
  'Alta o reactivacion de un dominio en la flota del chat. Crea "Flota '
  'principal" si la organizacion todavia no tiene ninguna activa. Reactiva sin '
  'reescribir fecha_alta. Si viene p_telefono, actualiza ultimo_dominio de ese '
  'chat (usado por el comando "link de pago"). Interna, solo service_role.';

-- ---------------------------------------------------------------------------
-- dominios_de_chat: listado para el comando "flota"
-- ---------------------------------------------------------------------------

create or replace function public.dominios_de_chat(p_organizacion_id uuid)
returns table (dominio text)
language sql
security definer
set search_path = ''
stable
as $fn$
  select v.dominio
  from public.vehiculos v
  where v.organizacion_id = p_organizacion_id and v.estado = 'activo'
  order by v.dominio;
$fn$;

comment on function public.dominios_de_chat(uuid) is
  'Dominios activos de la organizacion del chat, para el comando "flota". '
  'Interna, solo service_role.';

-- ---------------------------------------------------------------------------
-- Permisos: nacen sin GRANT (0011); solo service_role las usa
-- ---------------------------------------------------------------------------

revoke execute on function public.marcar_mensaje_procesado(text) from public, anon, authenticated;
revoke execute on function public.contexto_chat_whatsapp(text) from public, anon, authenticated;
revoke execute on function public.registrar_dominio_chat(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.dominios_de_chat(uuid) from public, anon, authenticated;
