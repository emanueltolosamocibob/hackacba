-- =============================================================================
-- 0005 - Resumenes por flota, reportes y Realtime
--
-- resumenes_flota es un rollup precalculado: responder "estado de la flota"
-- pasa a ser leer UNA fila en vez de agregar cientos. Se mantiene con triggers
-- a nivel de SENTENCIA (no de fila) para que generar 12 cuotas de una regla
-- dispare un recalculo, no doce.
--
-- La notificacion sale por Broadcast from Database (realtime.send) en un canal
-- por flota, con el resumen compacto como payload: no la fila cruda. Postgres
-- Changes haria una verificacion de autorizacion por cada suscriptor en cada
-- cambio, y corre en un solo hilo.
-- =============================================================================

create table public.resumenes_flota (
  flota_id             uuid primary key,
  organizacion_id      uuid not null,
  total_vehiculos      integer not null default 0,
  vehiculos_activos    integer not null default 0,
  cantidad_pendientes  integer not null default 0,
  cantidad_vencidos    integer not null default 0,
  monto_vencido        numeric(14, 2) not null default 0,
  monto_por_vencer_30d numeric(14, 2) not null default 0,
  proximo_vencimiento  date,
  actualizado_en       timestamptz not null default now(),

  constraint resumenes_flota_misma_organizacion
    foreign key (flota_id, organizacion_id)
    references public.flotas (id, organizacion_id) on delete cascade
);

comment on table public.resumenes_flota is
  'Rollup por flota. Lo mantienen triggers; no se escribe a mano.';

create index resumenes_flota_org_idx on public.resumenes_flota (organizacion_id);

-- ---------------------------------------------------------------------------
-- Recalculo del rollup de una flota
-- ---------------------------------------------------------------------------

create or replace function public.recalcular_resumen_flota(p_flota_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org           uuid;
  v_hoy           date;
  v_total         integer := 0;
  v_activos       integer := 0;
  v_pendientes    integer := 0;
  v_vencidos      integer := 0;
  v_monto_vencido numeric(14, 2) := 0;
  v_monto_30      numeric(14, 2) := 0;
  v_proximo       date;
begin
  select f.organizacion_id, (now() at time zone o.zona_horaria)::date
    into v_org, v_hoy
  from public.flotas f
  join public.organizaciones o on o.id = f.organizacion_id
  where f.id = p_flota_id;

  if not found then
    return;  -- la flota se borro en la misma transaccion
  end if;

  select count(*), count(*) filter (where ve.estado = 'activo')
    into v_total, v_activos
  from public.vehiculos ve
  where ve.flota_id = p_flota_id;

  select
    coalesce(count(*) filter (
      where v.estado in ('pendiente', 'parcial') and v.fecha_vencimiento >= v_hoy), 0),
    coalesce(count(*) filter (
      where v.estado in ('pendiente', 'parcial') and v.fecha_vencimiento < v_hoy), 0),
    coalesce(sum(coalesce(v.monto_real, v.monto_estimado)) filter (
      where v.estado in ('pendiente', 'parcial') and v.fecha_vencimiento < v_hoy), 0),
    coalesce(sum(coalesce(v.monto_real, v.monto_estimado)) filter (
      where v.estado in ('pendiente', 'parcial')
        and v.fecha_vencimiento between v_hoy and (v_hoy + 30)), 0),
    min(v.fecha_vencimiento) filter (
      where v.estado in ('pendiente', 'parcial') and v.fecha_vencimiento >= v_hoy)
    into v_pendientes, v_vencidos, v_monto_vencido, v_monto_30, v_proximo
  from public.vencimientos v
  join public.vehiculos ve on ve.id = v.vehiculo_id
  where ve.flota_id = p_flota_id;

  insert into public.resumenes_flota as rf (
    flota_id, organizacion_id, total_vehiculos, vehiculos_activos,
    cantidad_pendientes, cantidad_vencidos, monto_vencido,
    monto_por_vencer_30d, proximo_vencimiento, actualizado_en
  )
  values (
    p_flota_id, v_org, v_total, v_activos,
    v_pendientes, v_vencidos, v_monto_vencido,
    v_monto_30, v_proximo, now()
  )
  on conflict (flota_id) do update set
    total_vehiculos      = excluded.total_vehiculos,
    vehiculos_activos    = excluded.vehiculos_activos,
    cantidad_pendientes  = excluded.cantidad_pendientes,
    cantidad_vencidos    = excluded.cantidad_vencidos,
    monto_vencido        = excluded.monto_vencido,
    monto_por_vencer_30d = excluded.monto_por_vencer_30d,
    proximo_vencimiento  = excluded.proximo_vencimiento,
    actualizado_en       = now();

  -- Broadcast best-effort: el rollup ya quedo guardado. Si Realtime no esta
  -- disponible en esta instancia, no se rompe la transaccion de negocio.
  begin
    perform realtime.send(
      jsonb_build_object(
        'flota_id',             p_flota_id,
        'total_vehiculos',      v_total,
        'vehiculos_activos',    v_activos,
        'cantidad_pendientes',  v_pendientes,
        'cantidad_vencidos',    v_vencidos,
        'monto_vencido',        v_monto_vencido,
        'monto_por_vencer_30d', v_monto_30,
        'proximo_vencimiento',  v_proximo
      ),
      'resumen_actualizado',
      'flota:' || p_flota_id::text,
      true
    );
  exception
    when undefined_function or undefined_table or invalid_schema_name
       or insufficient_privilege then
      null;
  end;
end;
$fn$;

comment on function public.recalcular_resumen_flota(uuid) is
  'Recalcula el rollup de una flota y emite el broadcast. Lo llaman los triggers.';

-- ---------------------------------------------------------------------------
-- Triggers de refresco (a nivel de sentencia, con tablas de transicion)
-- ---------------------------------------------------------------------------

create or replace function public.fn_resumen_desde_vencimientos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_flota uuid;
begin
  for v_flota in
    select distinct ve.flota_id
    from public.vehiculos ve
    where ve.id in (select a.vehiculo_id from afectadas a)
  loop
    perform public.recalcular_resumen_flota(v_flota);
  end loop;
  return null;
end;
$fn$;

create or replace function public.fn_resumen_desde_pagos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_flota uuid;
begin
  for v_flota in
    select distinct ve.flota_id
    from public.vencimientos v
    join public.vehiculos ve on ve.id = v.vehiculo_id
    where v.id in (select a.vencimiento_id from afectadas a)
  loop
    perform public.recalcular_resumen_flota(v_flota);
  end loop;
  return null;
end;
$fn$;

-- Vehiculos: a nivel de fila. Los cambios de vehiculo son raros y hay que
-- refrescar las DOS flotas si el vehiculo cambia de flota.
create or replace function public.fn_resumen_desde_vehiculos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.flota_id is not null then
    perform public.recalcular_resumen_flota(old.flota_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.flota_id is not null
     and (tg_op = 'INSERT' or new.flota_id is distinct from old.flota_id
          or new.estado is distinct from old.estado) then
    perform public.recalcular_resumen_flota(new.flota_id);
  end if;

  return null;
end;
$fn$;

create trigger trg_vencimientos_resumen_alta
  after insert on public.vencimientos
  referencing new table as afectadas
  for each statement execute function public.fn_resumen_desde_vencimientos();

create trigger trg_vencimientos_resumen_cambio
  after update on public.vencimientos
  referencing new table as afectadas
  for each statement execute function public.fn_resumen_desde_vencimientos();

create trigger trg_vencimientos_resumen_baja
  after delete on public.vencimientos
  referencing old table as afectadas
  for each statement execute function public.fn_resumen_desde_vencimientos();

create trigger trg_pagos_resumen_alta
  after insert on public.pagos
  referencing new table as afectadas
  for each statement execute function public.fn_resumen_desde_pagos();

create trigger trg_pagos_resumen_cambio
  after update on public.pagos
  referencing new table as afectadas
  for each statement execute function public.fn_resumen_desde_pagos();

create trigger trg_pagos_resumen_baja
  after delete on public.pagos
  referencing old table as afectadas
  for each statement execute function public.fn_resumen_desde_pagos();

create trigger trg_vehiculos_resumen
  after insert or update or delete on public.vehiculos
  for each row execute function public.fn_resumen_desde_vehiculos();

-- ---------------------------------------------------------------------------
-- Reportes (SECURITY INVOKER: RLS filtra por organizacion aunque se pase otro id)
-- ---------------------------------------------------------------------------

create or replace function public.reporte_gastos(
  p_organizacion_id uuid,
  p_desde date,
  p_hasta date,
  p_agrupar_por text default 'tipo'
)
returns table (
  clave    text,
  etiqueta text,
  cantidad bigint,
  monto    numeric
)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_agrupar_por not in ('tipo', 'vehiculo', 'flota', 'mes') then
    raise exception 'p_agrupar_por debe ser tipo, vehiculo, flota o mes (recibido %)', p_agrupar_por
      using errcode = 'invalid_parameter_value';
  end if;

  if p_hasta < p_desde then
    raise exception 'p_hasta (%) no puede ser anterior a p_desde (%)', p_hasta, p_desde
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  select
    case p_agrupar_por
      when 'tipo'     then t.codigo
      when 'vehiculo' then ve.dominio
      when 'flota'    then f.nombre
      when 'mes'      then to_char(p.fecha_pago, 'YYYY-MM')
    end,
    case p_agrupar_por
      when 'tipo'     then t.nombre
      when 'vehiculo' then btrim(concat_ws(' ', ve.marca, ve.modelo) || ' (' || ve.dominio || ')')
      when 'flota'    then f.nombre
      when 'mes'      then to_char(p.fecha_pago, 'YYYY-MM')
    end,
    count(*)::bigint,
    sum(p.monto)
  from public.pagos p
  join public.vencimientos v     on v.id  = p.vencimiento_id
  join public.vehiculos ve       on ve.id = v.vehiculo_id
  join public.flotas f           on f.id  = ve.flota_id
  join public.tipos_obligacion t on t.id  = v.tipo_obligacion_id
  where p.organizacion_id = p_organizacion_id
    and not p.anulado
    and p.fecha_pago between p_desde and p_hasta
  group by 1, 2
  order by 4 desc, 1;
end;
$fn$;

comment on function public.reporte_gastos(uuid, date, date, text) is
  'Gasto real (pagos no anulados) del periodo, agrupado por tipo, vehiculo, flota o mes.';

create or replace function public.resumen_flota(p_flota_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_resultado jsonb;
begin
  select jsonb_build_object(
    'flota', jsonb_build_object(
      'id', f.id,
      'nombre', f.nombre,
      'activa', f.activa
    ),
    'resumen', to_jsonb(rf) - 'flota_id' - 'organizacion_id',
    'proximos', coalesce((
      select jsonb_agg(x order by x->>'fecha_vencimiento')
      from (
        select jsonb_build_object(
          'vencimiento_id',    e.id,
          'dominio',           e.dominio,
          'tipo',              e.tipo_nombre,
          'periodo',           e.periodo,
          'fecha_vencimiento', e.fecha_vencimiento,
          'dias_para_vencer',  e.dias_para_vencer,
          'monto',             e.monto_vigente,
          'estado_efectivo',   e.estado_efectivo
        ) as x
        from public.v_vencimientos_estado e
        where e.flota_id = p_flota_id
          and e.estado_efectivo in ('pendiente', 'parcial', 'vencido')
        order by e.fecha_vencimiento
        limit 10
      ) s
    ), '[]'::jsonb)
  )
  into v_resultado
  from public.flotas f
  left join public.resumenes_flota rf on rf.flota_id = f.id
  where f.id = p_flota_id;

  return v_resultado;
end;
$fn$;

comment on function public.resumen_flota(uuid) is
  'Estado de una flota: rollup mas los 10 vencimientos impagos mas proximos.';

create or replace function public.detalle_vehiculo(p_vehiculo_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_resultado jsonb;
begin
  select jsonb_build_object(
    'vehiculo', jsonb_build_object(
      'id', ve.id,
      'dominio', ve.dominio,
      'marca', ve.marca,
      'modelo', ve.modelo,
      'anio', ve.anio,
      'tipo', ve.tipo,
      'estado', ve.estado,
      'flota', f.nombre,
      'fecha_alta', ve.fecha_alta,
      'fecha_baja', ve.fecha_baja
    ),
    'vencimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                e.id,
        'tipo',              e.tipo_nombre,
        'periodo',           e.periodo,
        'numero_cuota',      e.numero_cuota,
        'fecha_vencimiento', e.fecha_vencimiento,
        'monto',             e.monto_vigente,
        'estado_efectivo',   e.estado_efectivo
      ) order by e.fecha_vencimiento desc)
      from public.v_vencimientos_estado e
      where e.vehiculo_id = p_vehiculo_id
    ), '[]'::jsonb),
    'total_pagado', coalesce((
      select sum(p.monto)
      from public.pagos p
      join public.vencimientos v on v.id = p.vencimiento_id
      where v.vehiculo_id = p_vehiculo_id and not p.anulado
    ), 0)
  )
  into v_resultado
  from public.vehiculos ve
  join public.flotas f on f.id = ve.flota_id
  where ve.id = p_vehiculo_id;

  return v_resultado;
end;
$fn$;

comment on function public.detalle_vehiculo(uuid) is
  'Ficha del vehiculo con su historial de vencimientos y el total pagado.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.resumenes_flota enable row level security;

-- Solo lectura: lo escribe recalcular_resumen_flota (security definer).
create policy resumenes_flota_lectura on public.resumenes_flota
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

grant select on public.resumenes_flota to authenticated;

grant execute on function
  public.recalcular_resumen_flota(uuid),
  public.reporte_gastos(uuid, date, date, text),
  public.resumen_flota(uuid),
  public.detalle_vehiculo(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Autorizacion de los canales Realtime privados
--
-- Topico: 'flota:<flota_id>'. Solo lo lee quien pertenece a la organizacion
-- duena de esa flota.
-- ---------------------------------------------------------------------------

create policy realtime_flotas_lectura on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'flota:%'
    and exists (
      select 1
      from public.flotas f
      where f.id::text = split_part(realtime.topic(), ':', 2)
        and f.organizacion_id in (select public.organizaciones_del_usuario())
    )
  );
