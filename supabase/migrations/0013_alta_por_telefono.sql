-- =============================================================================
-- 0013 - Alta por numero de telefono verificado
--
-- POR QUE: el codigo de invitacion de 0012 funciona pero no es como piensa un
-- dueno de flota. El no tiene codigos, tiene los telefonos de sus choferes.
--
-- Y Telegram da algo mejor que un codigo: con el boton request_contact, el
-- usuario comparte el numero con el que se registro y Telegram lo garantiza.
-- No es un campo que se tipea. Un codigo se puede reenviar a quien no era; un
-- numero verificado, no.
--
-- OJO DEL LADO DEL BOT: el objeto `contact` trae `user_id` SOLO si el contacto
-- es el del propio remitente. Hay que verificar
--     message.contact.user_id === message.from.id
-- o cualquiera reenvia la tarjeta de otra persona y entra como ella.
--
-- Los dos caminos conviven: por telefono cuando el admin lo tiene, por codigo
-- cuando no (o para mandar un enlace y listo).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Normalizacion de telefonos
--
-- En Argentina el mismo numero se escribe de muchas formas: +54 9 351 1234567,
-- 0351 15 1234567, 3511234567. Comparar los ultimos 10 digitos (codigo de area
-- + numero) resuelve el caso real sin meterse a parsear prefijos de movil.
--
-- Sin SET search_path: se usan en una columna generada, y ahi conviene que sean
-- inlineables. Todo lo que llaman es de pg_catalog, que siempre esta en scope.
-- ---------------------------------------------------------------------------

create or replace function public.normalizar_telefono(p_telefono text)
returns text
language sql
immutable
parallel safe
as $fn$
  select nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g'), '');
$fn$;

create or replace function public.clave_telefono(p_telefono text)
returns text
language sql
immutable
parallel safe
as $fn$
  select right(public.normalizar_telefono(p_telefono), 10);
$fn$;

comment on function public.clave_telefono(text) is
  'Ultimos 10 digitos: con lo que se comparan dos telefonos. Supone numeracion argentina.';

-- ---------------------------------------------------------------------------
-- La invitacion ahora puede ir por email, por telefono, o por los dos
-- ---------------------------------------------------------------------------

alter table public.invitaciones
  add column telefono text,
  add column telefono_clave text generated always as (public.clave_telefono(telefono)) stored;

alter table public.invitaciones
  alter column email drop not null;

alter table public.invitaciones
  add constraint invitaciones_con_algun_contacto
    check (email is not null or telefono is not null);

comment on column public.invitaciones.telefono is
  'Telefono al que se espera vincular. Se compara contra el que Telegram verifica.';

-- Una sola invitacion pendiente por telefono y organizacion: si no, dos
-- invitaciones vivas para la misma persona hacen ambiguo el canje.
create unique index invitaciones_telefono_pendiente_idx
  on public.invitaciones (organizacion_id, telefono_clave)
  where telefono_clave is not null and not anulada and usada_en is null;

-- ---------------------------------------------------------------------------
-- El vinculo guarda el telefono que Telegram verifico
-- ---------------------------------------------------------------------------

alter table public.vinculos_telegram
  add column telefono text,
  add column telefono_clave text generated always as (public.clave_telefono(telefono)) stored;

comment on column public.vinculos_telegram.telefono is
  'Numero verificado por Telegram al compartir el contacto. No lo tipea el usuario.';

-- ---------------------------------------------------------------------------
-- crear_invitacion: cambia la firma, hay que reemplazarla
-- ---------------------------------------------------------------------------

drop function if exists public.crear_invitacion(uuid, text, public.rol_miembro, integer);

create or replace function public.crear_invitacion(
  p_organizacion_id uuid,
  p_rol public.rol_miembro default 'operador',
  p_telefono text default null,
  p_email text default null,
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
  v_tel      text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_email    text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if not (public.puede_administrar(p_organizacion_id) or public.es_tarea_de_sistema()) then
    raise exception 'Sin permisos para invitar a la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_rol = 'propietario' then
    raise exception 'No se puede invitar como propietario: la propiedad se transfiere aparte'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_tel is null and v_email is null then
    raise exception 'Hace falta un telefono o un email para invitar'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_tel is not null and length(public.normalizar_telefono(v_tel)) < 8 then
    raise exception 'El telefono "%" no parece valido', p_telefono
      using errcode = 'invalid_parameter_value';
  end if;

  if p_dias_validez not between 1 and 90 then
    raise exception 'La validez debe estar entre 1 y 90 dias (recibido %)', p_dias_validez
      using errcode = 'invalid_parameter_value';
  end if;

  v_expira := now() + make_interval(days => p_dias_validez);

  loop
    v_intentos := v_intentos + 1;
    v_codigo := public.generar_codigo_invitacion();

    begin
      insert into public.invitaciones
        (organizacion_id, codigo, email, telefono, rol, creada_por, expira_en)
      values
        (p_organizacion_id, v_codigo, v_email, v_tel, p_rol, (select auth.uid()), v_expira)
      returning id into v_id;
      exit;
    exception
      when unique_violation then
        -- Puede ser colision de codigo (reintentable) o invitacion pendiente
        -- duplicada para el mismo telefono (no lo es).
        if v_intentos >= 5 then
          raise exception 'Ya hay una invitacion pendiente para ese contacto'
            using errcode = 'unique_violation';
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'invitacion_id', v_id,
    'codigo',        v_codigo,
    'telefono',      v_tel,
    'email',         v_email,
    'rol',           p_rol,
    'expira_en',     v_expira
  );
end;
$fn$;

comment on function public.crear_invitacion(uuid, public.rol_miembro, text, text, integer) is
  'Genera una invitacion de un solo uso. Con telefono, el alta es tocando un boton; '
  'el codigo sirve igual como enlace t.me/<bot>?start=<codigo>.';

-- ---------------------------------------------------------------------------
-- Aplicar una invitacion: la parte comun de los dos caminos de canje
-- ---------------------------------------------------------------------------

create or replace function public.aplicar_invitacion(
  p_invitacion_id uuid,
  p_usuario_id uuid,
  p_telegram_user_id bigint,
  p_chat_id bigint,
  p_nombre_telegram text,
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

  insert into public.vinculos_telegram as v (
    usuario_id, telegram_user_id, chat_id, nombre_telegram,
    telefono, organizacion_activa_id, ultimo_uso_en
  )
  values (
    p_usuario_id, p_telegram_user_id, p_chat_id, p_nombre_telegram,
    p_telefono_verificado, v_inv.organizacion_id, now()
  )
  on conflict (telegram_user_id) do update set
    chat_id                = excluded.chat_id,
    nombre_telegram        = coalesce(excluded.nombre_telegram, v.nombre_telegram),
    telefono               = coalesce(excluded.telefono, v.telefono),
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
  when unique_violation then
    raise exception 'Ese usuario ya esta vinculado a otra cuenta de Telegram'
      using errcode = 'invalid_parameter_value';
end;
$fn$;

comment on function public.aplicar_invitacion(uuid, uuid, bigint, bigint, text, text) is
  'Parte comun del canje: membresia, vinculo y marcado de la invitacion. Interna.';

-- ---------------------------------------------------------------------------
-- Canje por telefono verificado
-- ---------------------------------------------------------------------------

create or replace function public.canjear_por_telefono(
  p_telefono_verificado text,
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
    v_id, p_usuario_id, p_telegram_user_id, p_chat_id,
    p_nombre_telegram, p_telefono_verificado
  );
end;
$fn$;

comment on function public.canjear_por_telefono(text, uuid, bigint, bigint, text) is
  'Alta con el numero que Telegram verifico. El bot DEBE haber comprobado antes que '
  'contact.user_id == message.from.id, o el numero es el de otra persona.';

-- ---------------------------------------------------------------------------
-- Canje por codigo: ahora delega en aplicar_invitacion
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

  -- Un unico mensaje para todos los fallos: distinguir "no existe" de "ya se
  -- uso" le confirmaria a quien prueba codigos que acerto uno.
  if v_id is null then
    raise exception 'Codigo de invitacion invalido, vencido o ya utilizado'
      using errcode = 'invalid_parameter_value';
  end if;

  return public.aplicar_invitacion(
    v_id, p_usuario_id, p_telegram_user_id, p_chat_id, p_nombre_telegram, null
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Permisos: solo crear_invitacion es para el usuario final
-- ---------------------------------------------------------------------------

grant execute on function
  public.crear_invitacion(uuid, public.rol_miembro, text, text, integer)
  to authenticated;

grant execute on function
  public.normalizar_telefono(text),
  public.clave_telefono(text)
  to authenticated;

-- Sin GRANT (solo service_role): aplicar_invitacion, canjear_por_telefono,
-- canjear_invitacion.
