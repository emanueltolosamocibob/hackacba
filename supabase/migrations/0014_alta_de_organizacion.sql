-- =============================================================================
-- 0014 - Alta de una organizacion nueva desde el servidor
--
-- CONTEXTO: el unico usuario del sistema es la persona administrativa que paga.
-- No hay choferes ni perfiles de consulta. Eso deja un hueco de arranque: hoy
-- solo un usuario ya autenticado puede crear una organizacion, pero si esa
-- persona entra por Telegram, la organizacion tiene que existir antes que ella.
--
-- El CHECK de 0012 que prohibia invitar como propietario bloqueaba justamente
-- ese caso. Estaba bien para una invitacion que circula por ahi, pero el alta
-- inicial no es una invitacion: es aprovisionamiento. La regla correcta no es
-- "nadie puede crear un propietario" sino "solo el servidor puede".
--
-- Se mueve la restriccion de la tabla a la funcion, donde si puede mirar el
-- contexto. Insertar en invitaciones sin pasar por crear_invitacion() sigue
-- siendo imposible: no hay politica de INSERT para authenticated.
-- =============================================================================

alter table public.invitaciones
  drop constraint invitaciones_no_crean_propietarios;

comment on column public.invitaciones.rol is
  'Rol que recibe quien canjea. Solo una tarea de sistema puede emitir propietario; '
  'un administrador desde el bot no puede (ver crear_invitacion).';

-- ---------------------------------------------------------------------------
-- crear_invitacion: el rol propietario queda reservado al servidor
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
  v_sistema  boolean := public.es_tarea_de_sistema();
  v_tel      text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_email    text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if not (public.puede_administrar(p_organizacion_id) or v_sistema) then
    raise exception 'Sin permisos para invitar a la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Ceder la propiedad de una flota no puede ser el efecto lateral de un codigo
  -- que se reenvia. Aprovisionar la primera cuenta, en cambio, es legitimo.
  if p_rol = 'propietario' and not v_sistema then
    raise exception 'Solo el servidor puede emitir una invitacion de propietario'
      using errcode = 'insufficient_privilege';
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
  'Invitacion de un solo uso. Por defecto administrador, que es el unico perfil real '
  'del producto: la persona que gestiona los pagos.';

-- ---------------------------------------------------------------------------
-- Alta completa de una organizacion
--
-- Un solo llamado deja todo listo para que la persona administrativa abra el
-- bot, comparta su numero y entre. El bot despues solo tiene que crear la
-- cuenta de auth y llamar a canjear_por_telefono().
-- ---------------------------------------------------------------------------

create or replace function public.registrar_organizacion(
  p_nombre text,
  p_telefono_admin text,
  p_email_admin text default null,
  p_cuit text default null,
  p_zona_horaria text default 'America/Argentina/Cordoba'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_inv jsonb;
begin
  if not public.es_tarea_de_sistema() then
    raise exception 'registrar_organizacion solo se llama desde el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizaciones (nombre, cuit, zona_horaria)
  values (btrim(p_nombre), nullif(btrim(coalesce(p_cuit, '')), ''), p_zona_horaria)
  returning id into v_org;

  -- El trigger de propietario no hace nada aca (auth.uid() es NULL): la
  -- propiedad la va a tomar quien canjee la invitacion. El de reglas de aviso
  -- si corre, asi que la organizacion nace avisando.

  perform public.sembrar_catalogo_cordoba(v_org);

  v_inv := public.crear_invitacion(v_org, 'propietario', p_telefono_admin, p_email_admin, 30);

  return jsonb_build_object(
    'organizacion_id', v_org,
    'nombre',          btrim(p_nombre),
    'invitacion',      v_inv
  );
end;
$fn$;

comment on function public.registrar_organizacion(text, text, text, text, text) is
  'Crea la organizacion, le siembra el catalogo de Cordoba y deja lista la invitacion '
  'de propietario para el telefono del administrativo. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

grant execute on function
  public.crear_invitacion(uuid, public.rol_miembro, text, text, integer)
  to authenticated;

-- registrar_organizacion queda sin GRANT: solo service_role.
