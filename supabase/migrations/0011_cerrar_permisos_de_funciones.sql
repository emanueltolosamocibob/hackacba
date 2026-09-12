-- =============================================================================
-- 0011 - Cerrar los permisos de ejecucion de las funciones
--
-- AGUJERO QUE TAPA: Supabase concede EXECUTE a anon y authenticated por
-- defecto sobre toda funcion nueva del esquema public. El `revoke ... from
-- public` de 0006 no sirvio de nada, porque anon tiene una concesion DIRECTA,
-- no heredada de PUBLIC.
--
-- Resultado: una peticion sin autenticar podia llamar a tarea_diaria(), que es
-- SECURITY DEFINER y recorre TODAS las organizaciones generando cuotas y
-- encolando avisos. Tambien a recalcular_resumen_flota() sobre cualquier flota.
--
-- Se detecto probando explicitamente con la clave anon en vez de confiar en que
-- el revoke habia funcionado.
--
-- Estrategia: revocar todo de anon/authenticated/PUBLIC sobre TODAS las
-- funciones de public, y volver a conceder una por una solo las que el usuario
-- final necesita. Lo que no aparece en la lista de abajo queda para
-- service_role y para las conexiones directas (cron, migraciones).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reconocer tambien la conexion directa como contexto de sistema
--
-- pg_cron no pasa por PostgREST: no hay JWT. Sin esto, tarea_diaria() no puede
-- llamar a las funciones que exigen contexto de sistema.
-- ---------------------------------------------------------------------------

create or replace function public.es_tarea_de_sistema()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select
    -- Peticion HTTP con la clave service_role.
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) = 'service_role'
    -- O conexion directa a la base: pg_cron, migraciones, psql. PostgREST
    -- siempre se conecta como 'authenticator', nunca como estos roles, asi que
    -- ninguna peticion web puede satisfacer esta condicion.
    or session_user in ('postgres', 'supabase_admin');
$fn$;

comment on function public.es_tarea_de_sistema() is
  'Verdadero solo en contexto de servidor: clave service_role, o conexion directa (cron/migraciones). '
  'Nunca para un usuario final ni para una peticion anonima.';

-- ---------------------------------------------------------------------------
-- 2. programar_avisos escribia en cualquier organizacion sin verificar nada
-- ---------------------------------------------------------------------------

create or replace function public.programar_avisos(
  p_organizacion_id uuid,
  p_ventana_dias integer default 7
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hoy       date;
  v_encolados integer := 0;
  v_afectadas integer;
  v_venc      record;
  v_regla     record;
  v_dia       smallint;
  v_fecha     date;
begin
  if not (public.puede_operar(p_organizacion_id) or public.es_tarea_de_sistema()) then
    raise exception 'Sin permisos para programar avisos en la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  select (now() at time zone o.zona_horaria)::date
    into v_hoy
  from public.organizaciones o
  where o.id = p_organizacion_id;

  if not found then
    return 0;
  end if;

  for v_venc in
    select v.id, v.tipo_obligacion_id, v.fecha_vencimiento
    from public.vencimientos v
    where v.organizacion_id = p_organizacion_id
      and v.estado in ('pendiente', 'parcial')
      and v.fecha_vencimiento between (v_hoy - 120) and (v_hoy + 120)
  loop
    select ra.dias_antes, ra.avisar_el_dia, ra.dias_despues
      into v_regla
    from public.reglas_aviso ra
    where ra.organizacion_id = p_organizacion_id
      and ra.activa
      and (ra.tipo_obligacion_id = v_venc.tipo_obligacion_id
           or ra.tipo_obligacion_id is null)
    order by ra.tipo_obligacion_id nulls last
    limit 1;

    if not found then
      continue;
    end if;

    foreach v_dia in array v_regla.dias_antes loop
      v_fecha := v_venc.fecha_vencimiento - v_dia;
      if v_fecha between (v_hoy - p_ventana_dias) and v_hoy then
        insert into public.avisos (organizacion_id, vencimiento_id, clave_regla, programado_para)
        values (p_organizacion_id, v_venc.id, 'd-' || v_dia, v_fecha)
        on conflict (vencimiento_id, clave_regla) do nothing;
        get diagnostics v_afectadas = row_count;
        v_encolados := v_encolados + v_afectadas;
      end if;
    end loop;

    if v_regla.avisar_el_dia then
      v_fecha := v_venc.fecha_vencimiento;
      if v_fecha between (v_hoy - p_ventana_dias) and v_hoy then
        insert into public.avisos (organizacion_id, vencimiento_id, clave_regla, programado_para)
        values (p_organizacion_id, v_venc.id, 'd-0', v_fecha)
        on conflict (vencimiento_id, clave_regla) do nothing;
        get diagnostics v_afectadas = row_count;
        v_encolados := v_encolados + v_afectadas;
      end if;
    end if;

    foreach v_dia in array v_regla.dias_despues loop
      v_fecha := v_venc.fecha_vencimiento + v_dia;
      if v_fecha between (v_hoy - p_ventana_dias) and v_hoy then
        insert into public.avisos (organizacion_id, vencimiento_id, clave_regla, programado_para)
        values (p_organizacion_id, v_venc.id, 'd+' || v_dia, v_fecha)
        on conflict (vencimiento_id, clave_regla) do nothing;
        get diagnostics v_afectadas = row_count;
        v_encolados := v_encolados + v_afectadas;
      end if;
    end loop;
  end loop;

  return v_encolados;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Revocar EXECUTE de todo el esquema public
-- ---------------------------------------------------------------------------

do $revocar$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.firma);
  end loop;
end;
$revocar$;

-- ---------------------------------------------------------------------------
-- 4. Reconceder, una por una, solo lo que el usuario final necesita
--
-- Lo que NO esta aca queda reservado para service_role y conexiones directas:
--   tarea_diaria             -- corre sobre todas las organizaciones
--   recalcular_resumen_flota -- escribe rollups, la llaman los triggers
--   estado_segun_pagos       -- helper interno del calculo de estado
--   fn_*                     -- funciones de trigger
-- ---------------------------------------------------------------------------

-- Autorizacion: hablan del propio usuario, no filtran nada ajeno.
grant execute on function public.organizaciones_del_usuario()                   to authenticated;
grant execute on function public.tiene_rol(uuid, public.rol_miembro[])          to authenticated;
grant execute on function public.es_miembro(uuid)                               to authenticated;
grant execute on function public.puede_administrar(uuid)                        to authenticated;
grant execute on function public.puede_operar(uuid)                             to authenticated;
grant execute on function public.es_tarea_de_sistema()                          to authenticated;

-- Utilidades puras.
grant execute on function public.hoy_en_organizacion(uuid)                      to authenticated;
grant execute on function public.fecha_de_cuota(integer, integer, integer)      to authenticated;
grant execute on function public.meses_por_frecuencia(public.frecuencia)        to authenticated;

-- Operaciones de negocio. Todas verifican permisos por dentro, o son SECURITY
-- INVOKER y quedan sujetas a RLS.
grant execute on function public.generar_vencimientos(uuid, integer)            to authenticated;
grant execute on function public.generar_vencimientos_organizacion(uuid, integer) to authenticated;
grant execute on function public.programar_avisos(uuid, integer)                to authenticated;
grant execute on function public.sembrar_catalogo_cordoba(uuid)                 to authenticated;
grant execute on function public.importar_vehiculos(uuid, uuid, jsonb)          to authenticated;

-- Consultas: la superficie que va a usar el bot.
grant execute on function public.link_de_pago(uuid)                             to authenticated;
grant execute on function public.resumen_flota(uuid)                            to authenticated;
grant execute on function public.detalle_vehiculo(uuid)                         to authenticated;
grant execute on function public.reporte_gastos(uuid, date, date, text)         to authenticated;
grant execute on function public.estado_tarea_diaria()                          to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Que las funciones futuras NO queden expuestas solas
--
-- OJO PARA MIGRACIONES FUTURAS: a partir de aca, una funcion nueva nace sin
-- permisos para anon ni authenticated. Si el cliente tiene que llamarla, hay
-- que escribir el GRANT explicito. Es a proposito: preferimos que algo no
-- funcione a que algo quede abierto sin querer.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
