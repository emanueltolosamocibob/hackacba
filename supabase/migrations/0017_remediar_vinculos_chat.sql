-- =============================================================================
-- 0017 - Remediar canjes y vinculos de chat
--
-- 0016 ya fue aplicada y es historia inmutable. Su guarda antes de eliminar
-- vinculos_telegram no tomo ACCESS EXCLUSIVE LOCK, por lo que un escritor
-- concurrente podria haber aparecido entre el chequeo y el DROP. Ese incidente
-- no puede corregirse retroactivamente: toda eliminacion futura debe bloquear
-- la tabla antes de comprobarla y eliminarla dentro de la misma transaccion.
--
-- Esta migracion corrige hacia adelante los canjes no atomicos, separa la
-- identidad canonica del JID crudo y retira el alta basada en invitaciones de
-- propietario. No reescribe 0016 ni intenta ejecutarla otra vez.
-- =============================================================================

-- 0016 copio el identificador canonico en jid_crudo. No era un JID recibido del
-- proveedor, asi que se limpia antes de imponer la separacion como invariante.
update public.vinculos_chat
set jid_crudo = null
where jid_crudo = identificador_externo;

alter table public.vinculos_chat
  add constraint vinculos_chat_identificador_canonico
    check (
      canal <> 'whatsapp'::public.canal_chat
      or identificador_externo ~ '^[0-9]{10}@whatsapp$'
    ),
  add constraint vinculos_chat_jid_crudo_distinto
    check (jid_crudo is null or jid_crudo <> identificador_externo);

-- Las invitaciones de propietario que dejo el aprovisionamiento anterior ya no
-- son un camino valido. Se anulan sin tocar las que ya fueron auditadas como
-- usadas y se agrega una defensa tambien para inserciones directas.
update public.invitaciones
set anulada = true
where rol = 'propietario'
  and not anulada
  and usada_en is null;

alter table public.invitaciones
  add constraint invitaciones_pendientes_no_crean_propietarios
    check (rol <> 'propietario' or anulada or usada_en is not null);

-- El alta inicial por invitacion queda reemplazada por el finalizador de
-- landing de la migracion siguiente. Mantener esta firma permitiria volver a
-- crear propietarios por el camino obsoleto.
drop function if exists public.registrar_organizacion(text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- Identidad confirmada por Auth
-- ---------------------------------------------------------------------------

create or replace function public.validar_identidad_chat(
  p_usuario_id uuid,
  p_canal public.canal_chat,
  p_identificador_externo text,
  p_telefono_afirmado text default null,
  p_nombre_mostrado text default null
)
returns table (
  telefono_e164 text,
  telefono_clave text,
  identificador_canonico text,
  nombre_validado text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_telefono_confirmado_en timestamptz;
  v_telefono               text;
  v_clave                  text;
  v_identificador          text;
  v_nombre                 text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'La identidad de chat solo se valida desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select u.phone, u.phone_confirmed_at
  into v_telefono, v_telefono_confirmado_en
  from auth.users u
  where u.id = p_usuario_id;

  if not found or v_telefono_confirmado_en is null then
    raise exception 'El usuario no tiene un telefono confirmado en Auth'
      using errcode = 'invalid_parameter_value', detail = 'telefono_auth_no_confirmado';
  end if;

  v_telefono := btrim(v_telefono);
  if v_telefono !~ '^\+54(9)?[0-9]{10}$' then
    raise exception 'El telefono confirmado no es un E.164 argentino valido'
      using errcode = 'invalid_parameter_value', detail = 'telefono_auth_invalido';
  end if;

  if p_telefono_afirmado is not null and p_telefono_afirmado <> v_telefono then
    raise exception 'El telefono informado no coincide con Auth'
      using errcode = 'invalid_parameter_value', detail = 'telefono_no_coincide_con_auth';
  end if;

  v_clave := public.clave_telefono(v_telefono);
  if v_clave is null or char_length(v_clave) <> 10 then
    raise exception 'No se pudo derivar la identidad del telefono confirmado'
      using errcode = 'invalid_parameter_value', detail = 'telefono_auth_invalido';
  end if;

  v_identificador := v_clave || '@whatsapp';
  if p_canal <> 'whatsapp'::public.canal_chat
     or p_identificador_externo is distinct from v_identificador then
    raise exception 'El identificador externo no es el canonico del usuario'
      using errcode = 'invalid_parameter_value', detail = 'identificador_no_canonico';
  end if;

  if p_nombre_mostrado is not null then
    v_nombre := btrim(p_nombre_mostrado);
    if char_length(v_nombre) not between 1 and 120 then
      raise exception 'El nombre mostrado debe tener entre 1 y 120 caracteres'
        using errcode = 'invalid_parameter_value', detail = 'nombre_fuera_de_rango';
    end if;
  end if;

  return query select v_telefono, v_clave, v_identificador, v_nombre;
end;
$fn$;

comment on function public.validar_identidad_chat(uuid, public.canal_chat, text, text, text) is
  'Deriva la identidad canonica desde el telefono confirmado de Auth. Interna.';

-- ---------------------------------------------------------------------------
-- Aplicar una invitacion bajo bloqueo y revalidacion
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
  v_inv           record;
  v_nombre_org    text;
  v_telefono      text;
  v_clave         text;
  v_identificador text;
  v_nombre_chat   text;
  v_vinculo_id    uuid;
  v_actualizadas  integer;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'aplicar_invitacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.telefono_e164, i.telefono_clave, i.identificador_canonico, i.nombre_validado
  into v_telefono, v_clave, v_identificador, v_nombre_chat
  from public.validar_identidad_chat(
    p_usuario_id, p_canal, p_identificador_externo,
    p_telefono_verificado, p_nombre_mostrado
  ) i;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('identidad:' || p_canal::text || ':' || v_identificador, 0)
  );

  select i.* into v_inv
  from public.invitaciones i
  where i.id = p_invitacion_id
    and not i.anulada
    and i.usada_en is null
    and i.expira_en >= now()
  for update;

  if not found then
    raise exception 'La invitacion ya no esta disponible'
      using errcode = 'invalid_parameter_value', detail = 'invitacion_no_disponible';
  end if;

  -- Se bloquean todos los candidatos antes de escribir. La identidad y el
  -- telefono pueden coincidir con filas distintas si hay datos heredados.
  perform 1
  from public.vinculos_chat v
  where (v.canal = p_canal and v.identificador_externo = v_identificador)
     or v.telefono_clave = v_clave
     or (v.canal = p_canal and v.usuario_id = p_usuario_id)
  for update;

  if exists (
    select 1
    from public.vinculos_chat v
    where (
      (v.canal = p_canal and v.identificador_externo = v_identificador)
      or v.telefono_clave = v_clave
    )
      and v.usuario_id <> p_usuario_id
  ) then
    raise exception 'La identidad verificada ya pertenece a otro usuario'
      using errcode = 'invalid_parameter_value', detail = 'identidad_en_uso';
  end if;

  insert into public.miembros (organizacion_id, usuario_id, rol)
  values (v_inv.organizacion_id, p_usuario_id, v_inv.rol)
  on conflict (organizacion_id, usuario_id) do nothing;

  update public.vinculos_chat
  set identificador_externo  = v_identificador,
      nombre_mostrado        = coalesce(v_nombre_chat, nombre_mostrado),
      telefono               = v_telefono,
      organizacion_activa_id = v_inv.organizacion_id,
      ultimo_uso_en          = now()
  where canal = p_canal
    and usuario_id = p_usuario_id
  returning id into v_vinculo_id;

  if v_vinculo_id is null then
    insert into public.vinculos_chat (
      usuario_id, canal, identificador_externo, jid_crudo, nombre_mostrado,
      telefono, organizacion_activa_id, ultimo_uso_en
    )
    values (
      p_usuario_id, p_canal, v_identificador, null, v_nombre_chat,
      v_telefono, v_inv.organizacion_id, now()
    )
    returning id into v_vinculo_id;
  end if;

  update public.invitaciones
  set usada_en = now(), usada_por = p_usuario_id
  where id = v_inv.id
    and not anulada
    and usada_en is null
    and expira_en >= now();
  get diagnostics v_actualizadas = row_count;

  if v_actualizadas <> 1 then
    raise exception 'La invitacion cambio durante el canje'
      using errcode = 'invalid_parameter_value', detail = 'invitacion_no_disponible';
  end if;

  select o.nombre into v_nombre_org
  from public.organizaciones o
  where o.id = v_inv.organizacion_id;

  return jsonb_build_object(
    'organizacion_id', v_inv.organizacion_id,
    'organizacion',    v_nombre_org,
    'rol',             v_inv.rol,
    'usuario_id',      p_usuario_id
  );
end;
$fn$;

comment on function public.aplicar_invitacion(uuid, uuid, public.canal_chat, text, text, text) is
  'Aplica una invitacion disponible de forma atomica. Interna y solo para el servidor.';

-- ---------------------------------------------------------------------------
-- Canje por telefono confirmado
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
  v_id            uuid;
  v_telefono      text;
  v_clave         text;
  v_identificador text;
  v_nombre        text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'canjear_por_telefono solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.telefono_e164, i.telefono_clave, i.identificador_canonico, i.nombre_validado
  into v_telefono, v_clave, v_identificador, v_nombre
  from public.validar_identidad_chat(
    p_usuario_id, p_canal, p_identificador_externo,
    p_telefono_verificado, p_nombre_mostrado
  ) i;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('identidad:' || p_canal::text || ':' || v_identificador, 0)
  );

  select i.id into v_id
  from public.invitaciones i
  where i.telefono_clave = v_clave
    and not i.anulada
    and i.usada_en is null
    and i.expira_en >= now()
  order by i.creado_en, i.id
  limit 1
  for update;

  if v_id is null then
    raise exception 'No hay ninguna invitacion pendiente para ese numero'
      using errcode = 'invalid_parameter_value', detail = 'invitacion_no_disponible';
  end if;

  return public.aplicar_invitacion(
    v_id, p_usuario_id, p_canal, v_identificador, v_nombre, v_telefono
  );
end;
$fn$;

comment on function public.canjear_por_telefono(text, uuid, public.canal_chat, text, text) is
  'Canjea usando el telefono confirmado de Auth; el argumento solo afirma el mismo valor. Solo servidor.';

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
  v_id            uuid;
  v_telefono      text;
  v_clave         text;
  v_identificador text;
  v_nombre        text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'canjear_invitacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select i.telefono_e164, i.telefono_clave, i.identificador_canonico, i.nombre_validado
  into v_telefono, v_clave, v_identificador, v_nombre
  from public.validar_identidad_chat(
    p_usuario_id, p_canal, p_identificador_externo, null, p_nombre_mostrado
  ) i;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('identidad:' || p_canal::text || ':' || v_identificador, 0)
  );

  select i.id into v_id
  from public.invitaciones i
  where i.codigo = upper(btrim(p_codigo))
    and not i.anulada
    and i.usada_en is null
    and i.expira_en >= now()
  for update;

  if v_id is null then
    raise exception 'Codigo de invitacion invalido, vencido o ya utilizado'
      using errcode = 'invalid_parameter_value', detail = 'invitacion_no_disponible';
  end if;

  return public.aplicar_invitacion(
    v_id, p_usuario_id, p_canal, v_identificador, v_nombre, v_telefono
  );
end;
$fn$;

comment on function public.canjear_invitacion(text, uuid, public.canal_chat, text, text) is
  'Canjea un codigo bajo bloqueo y deriva telefono e identidad desde Auth. Solo servidor.';

-- ---------------------------------------------------------------------------
-- Crear invitaciones solo para miembros, nunca propietarios
-- ---------------------------------------------------------------------------

create or replace function public.crear_invitacion(
  p_organizacion_id uuid,
  p_rol public.rol_miembro default 'administrador',
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
    raise exception 'Las invitaciones no pueden crear propietarios'
      using errcode = 'invalid_parameter_value', detail = 'rol_invitacion_invalido';
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
  'Genera una invitacion de miembro. Propietario nunca es un rol invitado.';

-- Cada funcion nueva nace con permisos implicitos para PUBLIC en PostgreSQL.
-- La superficie queda explicita: solo crear_invitacion es para authenticated.
revoke execute on function public.validar_identidad_chat(uuid, public.canal_chat, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.aplicar_invitacion(uuid, uuid, public.canal_chat, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.canjear_por_telefono(text, uuid, public.canal_chat, text, text)
  from public, anon, authenticated;
revoke execute on function public.canjear_invitacion(text, uuid, public.canal_chat, text, text)
  from public, anon, authenticated;
revoke execute on function public.crear_invitacion(uuid, public.rol_miembro, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.crear_invitacion(uuid, public.rol_miembro, text, text, integer)
  to authenticated;
