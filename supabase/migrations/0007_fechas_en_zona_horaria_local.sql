-- =============================================================================
-- 0007 - Los defaults de fecha respetan la zona horaria de la organizacion
--
-- BUG QUE CORRIGE: `default current_date` toma la fecha del SERVIDOR, que en
-- Supabase corre en UTC. Entre las 21:00 y las 24:00 de Argentina (UTC-3) el
-- servidor ya esta en el dia siguiente, asi que un vehiculo dado de alta un
-- 11 de septiembre a las 23:35 quedaba con fecha_alta = 12 de septiembre.
--
-- Se detecto porque dar de baja ese vehiculo "hoy" violaba el check
-- fecha_baja >= fecha_alta. En un sistema cuyo trabajo es vigilar fechas de
-- vencimiento, tres horas de corrimiento por dia no es un detalle.
--
-- Solucion: sacar el default y llenarlo en un trigger BEFORE INSERT usando la
-- zona horaria de la organizacion. El default no puede consultar otra tabla;
-- el trigger si. NOT NULL se sigue verificando despues del trigger, asi que la
-- columna nunca queda vacia.
-- =============================================================================

create or replace function public.hoy_en_organizacion(p_organizacion_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $fn$
  select (now() at time zone coalesce(o.zona_horaria, 'America/Argentina/Cordoba'))::date
  from public.organizaciones o
  where o.id = p_organizacion_id;
$fn$;

comment on function public.hoy_en_organizacion(uuid) is
  'Fecha de hoy en la zona horaria de la organizacion. Nunca usar current_date para fechas de negocio.';

-- Trigger generico: recibe el nombre de la columna como argumento.
create or replace function public.fn_fecha_local_por_defecto()
returns trigger
language plpgsql
as $fn$
declare
  v_columna text := tg_argv[0];
  v_fila    jsonb := to_jsonb(new);
begin
  if v_fila ->> v_columna is null then
    v_fila := jsonb_set(
      v_fila,
      array[v_columna],
      to_jsonb(public.hoy_en_organizacion(new.organizacion_id))
    );
    new := jsonb_populate_record(new, v_fila);
  end if;

  return new;
end;
$fn$;

comment on function public.fn_fecha_local_por_defecto() is
  'Completa una columna date con el hoy de la organizacion si viene nula. El nombre de la columna va en TG_ARGV[0].';

-- ---------------------------------------------------------------------------
-- Sacar los defaults en UTC y enchufar los triggers
-- ---------------------------------------------------------------------------

alter table public.vehiculos           alter column fecha_alta    drop default;
alter table public.pagos               alter column fecha_pago    drop default;
alter table public.reglas_vencimiento  alter column vigente_desde drop default;

create trigger trg_vehiculos_fecha_alta_local
  before insert on public.vehiculos
  for each row execute function public.fn_fecha_local_por_defecto('fecha_alta');

create trigger trg_pagos_fecha_pago_local
  before insert on public.pagos
  for each row execute function public.fn_fecha_local_por_defecto('fecha_pago');

create trigger trg_reglas_vigente_desde_local
  before insert on public.reglas_vencimiento
  for each row execute function public.fn_fecha_local_por_defecto('vigente_desde');

-- El trigger de normalizacion de dominio es BEFORE INSERT tambien; el orden
-- entre ambos es alfabetico y no se pisan (tocan columnas distintas).

grant execute on function public.hoy_en_organizacion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Corregir las filas ya cargadas con la fecha corrida
--
-- Solo toca lo que se creo hoy o ayer en UTC y quedo adelantado respecto de la
-- fecha local de su organizacion. No reescribe historia real.
-- ---------------------------------------------------------------------------

update public.vehiculos v
set fecha_alta = public.hoy_en_organizacion(v.organizacion_id)
where v.fecha_alta > public.hoy_en_organizacion(v.organizacion_id)
  and v.creado_en > now() - interval '2 days';

update public.pagos p
set fecha_pago = public.hoy_en_organizacion(p.organizacion_id)
where p.fecha_pago > public.hoy_en_organizacion(p.organizacion_id)
  and p.creado_en > now() - interval '2 days';

update public.reglas_vencimiento r
set vigente_desde = public.hoy_en_organizacion(r.organizacion_id)
where r.vigente_desde > public.hoy_en_organizacion(r.organizacion_id)
  and r.creado_en > now() - interval '2 days';
