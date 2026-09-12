-- =============================================================================
-- 0018 - Remediar el formato de telefono confirmado de Auth
--
-- 0017 fue aplicada y esperaba que auth.users.phone conservara el signo mas.
-- Supabase Auth persiste telefonos confirmados como 549... aun cuando recibe
-- +549.... Esta correccion hacia adelante acepta solamente las dos
-- representaciones argentinas previstas, las lleva a +54 + diez digitos y
-- deriva la clave canonica despues de validar la gramatica estricta.
-- =============================================================================

create or replace function public.canonicalizar_telefono_argentino(
  p_telefono text,
  p_permitir_formato_local boolean default false
)
returns text
language plpgsql
set search_path = ''
as $fn$
declare
  v_entrada   text := btrim(p_telefono);
  v_compacto  text;
  v_nacional  text;
  v_clave     text;
begin
  if p_telefono is null or v_entrada = '' then
    return null;
  end if;

  -- Auth y la afirmacion compatible admiten exactamente un + inicial opcional,
  -- 54, un 9 internacional opcional y diez digitos nacionales.
  if not p_permitir_formato_local then
    if v_entrada !~ '^\+?54(9)?[0-9]{10}$' then
      return null;
    end if;
    v_compacto := v_entrada;
  else
    -- Las invitaciones conservan los formatos argentinos de carga humana, pero
    -- solo permiten separadores conocidos. Nunca se eliminan caracteres libres.
    if v_entrada ~ '^\+54[0-9 ()-]+$' then
      v_compacto := regexp_replace(v_entrada, '[ ()-]', '', 'g');
      if v_compacto !~ '^\+54(9)?[0-9]{10}$' then
        return null;
      end if;
    elsif v_entrada ~ '^[0-9 ()-]+$' then
      v_compacto := regexp_replace(v_entrada, '[ ()-]', '', 'g');
      if v_compacto ~ '^54(9)?[0-9]{10}$' then
        null;
      else
        v_nacional := regexp_replace(v_compacto, '^0', '');
        if v_nacional ~ '^[0-9]{10}$' then
          null;
        elsif char_length(v_nacional) = 12
              and v_nacional ~ '^[0-9]{2,4}15[0-9]{6,8}$' then
          null;
        else
          return null;
        end if;
      end if;
    else
      return null;
    end if;
  end if;

  -- clave_telefono es deliberadamente posterior a la validacion estricta.
  v_clave := public.clave_telefono(v_compacto);
  if v_clave is null or char_length(v_clave) <> 10 then
    return null;
  end if;

  return '+54' || v_clave;
end;
$fn$;

comment on function public.canonicalizar_telefono_argentino(text, boolean) is
  'Valida un telefono argentino antes de derivar su clave; interna y sin permisos de cliente.';

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
  v_telefono_auth          text;
  v_telefono_canonico     text;
  v_afirmado_canonico     text;
  v_clave                  text;
  v_identificador          text;
  v_nombre                 text;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'La identidad de chat solo se valida desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  select u.phone, u.phone_confirmed_at
  into v_telefono_auth, v_telefono_confirmado_en
  from auth.users u
  where u.id = p_usuario_id;

  if not found or v_telefono_confirmado_en is null then
    raise exception 'El usuario no tiene un telefono confirmado en Auth'
      using errcode = 'invalid_parameter_value', detail = 'telefono_auth_no_confirmado';
  end if;

  v_telefono_canonico := public.canonicalizar_telefono_argentino(v_telefono_auth, false);
  if v_telefono_canonico is null then
    raise exception 'El telefono confirmado no tiene un formato argentino admitido'
      using errcode = 'invalid_parameter_value', detail = 'telefono_auth_invalido';
  end if;

  if p_telefono_afirmado is not null then
    v_afirmado_canonico := public.canonicalizar_telefono_argentino(p_telefono_afirmado, false);
    if v_afirmado_canonico is null then
      raise exception 'El telefono informado no tiene un formato argentino admitido'
        using errcode = 'invalid_parameter_value', detail = 'telefono_afirmado_invalido';
    end if;
    if v_afirmado_canonico <> v_telefono_canonico then
      raise exception 'El telefono informado no coincide con Auth'
        using errcode = 'invalid_parameter_value', detail = 'telefono_no_coincide_con_auth';
    end if;
  end if;

  -- Auth es la autoridad. La clave y el identificador nacen recien despues de
  -- validar y canonicalizar su telefono confirmado.
  v_clave := public.clave_telefono(v_telefono_canonico);
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

  return query select v_telefono_canonico, v_clave, v_identificador, v_nombre;
end;
$fn$;

comment on function public.validar_identidad_chat(uuid, public.canal_chat, text, text, text) is
  'Deriva la identidad canonica desde un telefono argentino confirmado de Auth. Interna.';

-- Se reemplaza crear_invitacion porque 0017 aceptaba alias extranjeros o texto
-- libre cuyos ultimos digitos podian compartir telefono_clave con Argentina.
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
  v_tel      text;
  v_entrada  text := nullif(btrim(coalesce(p_telefono, '')), '');
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

  if v_entrada is null and v_email is null then
    raise exception 'Hace falta un telefono o un email para invitar'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_entrada is not null then
    v_tel := public.canonicalizar_telefono_argentino(v_entrada, true);
    if v_tel is null then
      raise exception 'El telefono de la invitacion no tiene un formato argentino admitido'
        using errcode = 'invalid_parameter_value', detail = 'telefono_invitacion_invalido';
    end if;
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
  'Genera una invitacion de miembro con telefono argentino canonico. Authenticated solamente.';

-- Se reemplazan ambos selectores para que una fila heredada extranjera o
-- malformada tampoco pueda canjearse por compartir los ultimos diez digitos.
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
    and public.canonicalizar_telefono_argentino(i.telefono, true) = v_telefono
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
    and (i.telefono is null
         or public.canonicalizar_telefono_argentino(i.telefono, true) is not null)
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

-- Repetir los REVOKE es obligatorio: CREATE OR REPLACE no debe dejar una
-- superficie dependiente del estado previo de ACL. Solo crear_invitacion queda
-- disponible para authenticated; validacion y canje siguen siendo servidor.
revoke execute on function public.canonicalizar_telefono_argentino(text, boolean)
  from public, anon, authenticated;
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

-- La migracion falla si el catalogo conserva EXECUTE cliente en una funcion
-- interna o si crear_invitacion pierde su unica concesion autenticada.
do $acl$
declare
  v_firma text;
  v_oid oid;
begin
  foreach v_firma in array array[
    'public.canonicalizar_telefono_argentino(text,boolean)',
    'public.validar_identidad_chat(uuid,public.canal_chat,text,text,text)',
    'public.aplicar_invitacion(uuid,uuid,public.canal_chat,text,text,text)',
    'public.canjear_por_telefono(text,uuid,public.canal_chat,text,text)',
    'public.canjear_invitacion(text,uuid,public.canal_chat,text,text)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_firma);
    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) permiso
      left join pg_catalog.pg_roles rol on rol.oid = permiso.grantee
      where p.oid = v_oid
        and permiso.privilege_type = 'EXECUTE'
        and (permiso.grantee = 0 or rol.rolname in ('anon', 'authenticated'))
    ) then
      raise exception 'ACL insegura para %', v_firma;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
      'authenticated',
      'public.crear_invitacion(uuid,public.rol_miembro,text,text,integer)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.crear_invitacion(uuid,public.rol_miembro,text,text,integer)',
      'EXECUTE'
    ) then
    raise exception 'ACL insegura para crear_invitacion';
  end if;
end;
$acl$;
