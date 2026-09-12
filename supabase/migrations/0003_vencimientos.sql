-- =============================================================================
-- 0003 - Vencimientos y motor de generacion
--
-- Un vencimiento es una cuota concreta con fecha e importe. Existe ANTES de que
-- exista el pago: es justamente el estado que hay que vigilar.
--
-- "Vencido" NO se guarda. Se deriva en v_vencimientos_estado comparando contra
-- la fecha de hoy EN LA ZONA HORARIA DE LA ORGANIZACION. Guardarlo como campo
-- mutable garantizaria que quede desactualizado.
-- =============================================================================

create type public.estado_efectivo as enum (
  'pendiente', 'parcial', 'vencido', 'pagado', 'condonado', 'anulado'
);

comment on type public.estado_efectivo is
  'Estado de liquidacion mas la condicion derivada "vencido". Solo aparece en vistas.';

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------

create table public.vencimientos (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones (id) on delete cascade,
  vehiculo_id        uuid not null,
  tipo_obligacion_id uuid not null,
  regla_id           uuid references public.reglas_vencimiento (id) on delete set null,
  periodo            text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  numero_cuota       smallint check (numero_cuota between 1 and 12),
  fecha_vencimiento  date not null,
  monto_estimado     numeric(14, 2) check (monto_estimado >= 0),
  monto_real         numeric(14, 2) check (monto_real >= 0),
  moneda             char(3) not null default 'ARS',
  estado             public.estado_vencimiento not null default 'pendiente',
  numero_boleta      text,
  url_pago           text,
  notas              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- Hace idempotente al generador: se puede re-correr sin duplicar una cuota.
  constraint vencimientos_periodo_unico
    unique (vehiculo_id, tipo_obligacion_id, periodo),

  -- Destino de la clave foranea compuesta de pagos (0004).
  unique (id, organizacion_id),

  constraint vencimientos_vehiculo_misma_organizacion
    foreign key (vehiculo_id, organizacion_id)
    references public.vehiculos (id, organizacion_id) on delete cascade,

  constraint vencimientos_tipo_misma_organizacion
    foreign key (tipo_obligacion_id, organizacion_id)
    references public.tipos_obligacion (id, organizacion_id) on delete restrict
);

comment on table public.vencimientos is
  'Cuotas a pagar. Las genera el motor desde reglas_vencimiento, o se cargan sueltas (regla_id nulo).';

comment on column public.vencimientos.estado is
  'Estado de LIQUIDACION unicamente. La condicion "vencido" se deriva, ver v_vencimientos_estado.';

comment on column public.vencimientos.monto_real is
  'Importe confirmado de la boleta. Mientras sea nulo, el vigente es monto_estimado.';

comment on constraint vencimientos_periodo_unico on public.vencimientos is
  'Un vehiculo no puede tener dos cuotas del mismo tipo para el mismo periodo.';

create index vencimientos_org_fecha_estado_idx
  on public.vencimientos (organizacion_id, fecha_vencimiento, estado);

create index vencimientos_vehiculo_idx
  on public.vencimientos (vehiculo_id, fecha_vencimiento desc);

-- La consulta caliente: que esta impago. Indice parcial para que sea barata.
create index vencimientos_impagos_idx
  on public.vencimientos (organizacion_id, fecha_vencimiento)
  where estado in ('pendiente', 'parcial');

create index vencimientos_regla_idx on public.vencimientos (regla_id);

-- ---------------------------------------------------------------------------
-- Vista de estado efectivo
--
-- security_invoker = true es OBLIGATORIO: sin eso la vista correria con los
-- permisos de su dueno y saltearia el RLS de las tablas base, filtrando datos
-- entre organizaciones.
-- ---------------------------------------------------------------------------

create view public.v_vencimientos_estado
with (security_invoker = true) as
select
  v.id,
  v.organizacion_id,
  v.vehiculo_id,
  ve.dominio,
  ve.flota_id,
  v.tipo_obligacion_id,
  t.codigo   as tipo_codigo,
  t.nombre   as tipo_nombre,
  v.regla_id,
  v.periodo,
  v.numero_cuota,
  v.fecha_vencimiento,
  v.monto_estimado,
  v.monto_real,
  coalesce(v.monto_real, v.monto_estimado) as monto_vigente,
  v.moneda,
  v.estado,
  case
    when v.estado in ('pagado', 'condonado', 'anulado')
      then v.estado::text::public.estado_efectivo
    when v.fecha_vencimiento < (now() at time zone o.zona_horaria)::date
      then 'vencido'::public.estado_efectivo
    else v.estado::text::public.estado_efectivo
  end as estado_efectivo,
  (v.fecha_vencimiento - (now() at time zone o.zona_horaria)::date) as dias_para_vencer,
  v.numero_boleta,
  v.url_pago,
  v.notas,
  v.creado_en,
  v.actualizado_en
from public.vencimientos v
join public.vehiculos ve       on ve.id = v.vehiculo_id
join public.tipos_obligacion t on t.id  = v.tipo_obligacion_id
join public.organizaciones o   on o.id  = v.organizacion_id;

comment on view public.v_vencimientos_estado is
  'Vencimientos con estado_efectivo y dias_para_vencer calculados en la zona horaria de la organizacion.';

-- ---------------------------------------------------------------------------
-- Helper de fechas: arma la fecha de una cuota recortando al ultimo dia del mes
-- ---------------------------------------------------------------------------

create or replace function public.fecha_de_cuota(
  p_anio integer,
  p_mes integer,
  p_dia integer
)
returns date
language sql
immutable
parallel safe
as $fn$
  select make_date(
    p_anio,
    p_mes,
    least(
      p_dia,
      extract(
        day from (make_date(p_anio, p_mes, 1) + interval '1 month' - interval '1 day')
      )::integer
    )
  );
$fn$;

comment on function public.fecha_de_cuota(integer, integer, integer) is
  'Fecha de vencimiento del mes indicado. Dia 31 en abril da 30; en febrero da 28 o 29.';

-- ---------------------------------------------------------------------------
-- Motor: materializa las cuotas de una regla
--
-- SECURITY INVOKER (el default): corre con los permisos de quien llama, asi que
-- RLS decide sobre que filas puede insertar.
-- ---------------------------------------------------------------------------

create or replace function public.generar_vencimientos(
  p_regla_id uuid,
  p_horizonte_meses integer default 12
)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  r            record;
  v_meses      smallint[];
  v_hoy        date;
  v_desde      date;
  v_hasta      date;
  v_paso       integer;
  v_m0         integer;
  v_anio       integer;
  v_mes        integer;
  v_fecha      date;
  v_cuota      integer;
  v_idx        integer;
  v_insertados integer := 0;
  v_afectadas  integer;
  v_guarda     integer := 0;
begin
  if p_horizonte_meses is null or p_horizonte_meses not between 1 and 60 then
    raise exception 'p_horizonte_meses debe estar entre 1 y 60 (recibido %)', p_horizonte_meses
      using errcode = 'invalid_parameter_value';
  end if;

  select re.id, re.organizacion_id, re.vehiculo_id, re.tipo_obligacion_id,
         re.frecuencia, re.dia_vencimiento, re.mes_inicio, re.meses_cuotas,
         re.monto_estimado, re.moneda, re.vigente_desde, re.vigente_hasta, re.activa,
         ve.estado as estado_vehiculo,
         o.zona_horaria
    into r
  from public.reglas_vencimiento re
  join public.vehiculos ve     on ve.id = re.vehiculo_id
  join public.organizaciones o on o.id  = re.organizacion_id
  where re.id = p_regla_id;

  -- RLS puede ocultarla; no distinguimos "no existe" de "no visible".
  if not found then
    raise exception 'Regla % inexistente o sin acceso', p_regla_id
      using errcode = 'no_data_found';
  end if;

  if not r.activa then
    return 0;
  end if;

  if r.estado_vehiculo in ('vendido', 'baja') then
    return 0;
  end if;

  v_hoy   := (now() at time zone r.zona_horaria)::date;
  v_desde := r.vigente_desde;
  v_hasta := least(
    coalesce(r.vigente_hasta, 'infinity'::date),
    (v_hoy + make_interval(months => p_horizonte_meses))::date
  );

  if v_hasta < v_desde then
    return 0;
  end if;

  -- ---- Calendario explicito (manda sobre frecuencia) -----------------------
  if r.meses_cuotas is not null then
    select array_agg(distinct m order by m) into v_meses
    from unnest(r.meses_cuotas) as m;

    v_anio := extract(year from v_desde)::integer;

    while make_date(v_anio, 1, 1) <= v_hasta loop
      v_idx := 0;
      foreach v_mes in array v_meses loop
        v_idx  := v_idx + 1;
        v_fecha := public.fecha_de_cuota(v_anio, v_mes, r.dia_vencimiento);

        if v_fecha between v_desde and v_hasta then
          insert into public.vencimientos (
            organizacion_id, vehiculo_id, tipo_obligacion_id, regla_id,
            periodo, numero_cuota, fecha_vencimiento, monto_estimado, moneda
          )
          values (
            r.organizacion_id, r.vehiculo_id, r.tipo_obligacion_id, r.id,
            to_char(v_fecha, 'YYYY-MM'), v_idx, v_fecha, r.monto_estimado, r.moneda
          )
          on conflict (vehiculo_id, tipo_obligacion_id, periodo) do nothing;

          get diagnostics v_afectadas = row_count;
          v_insertados := v_insertados + v_afectadas;
        end if;
      end loop;

      v_anio := v_anio + 1;
    end loop;

    return v_insertados;
  end if;

  -- ---- Frecuencia periodica ------------------------------------------------
  v_paso := public.meses_por_frecuencia(r.frecuencia);

  -- 'unica': una sola cuota, en el mes de vigente_desde o el siguiente.
  if v_paso is null then
    v_fecha := public.fecha_de_cuota(
      extract(year from v_desde)::integer,
      extract(month from v_desde)::integer,
      r.dia_vencimiento
    );

    if v_fecha < v_desde then
      v_fecha := public.fecha_de_cuota(
        extract(year from (v_desde + interval '1 month'))::integer,
        extract(month from (v_desde + interval '1 month'))::integer,
        r.dia_vencimiento
      );
    end if;

    if v_fecha <= v_hasta then
      insert into public.vencimientos (
        organizacion_id, vehiculo_id, tipo_obligacion_id, regla_id,
        periodo, numero_cuota, fecha_vencimiento, monto_estimado, moneda
      )
      values (
        r.organizacion_id, r.vehiculo_id, r.tipo_obligacion_id, r.id,
        to_char(v_fecha, 'YYYY-MM'), 1, v_fecha, r.monto_estimado, r.moneda
      )
      on conflict (vehiculo_id, tipo_obligacion_id, periodo) do nothing;

      get diagnostics v_afectadas = row_count;
      v_insertados := v_insertados + v_afectadas;
    end if;

    return v_insertados;
  end if;

  -- Primer mes del ciclo dentro de cualquier anio. Todos los pasos posibles
  -- (1,2,3,4,6,12) dividen a 12, asi que la congruencia se mantiene al cambiar
  -- de anio y numero_cuota queda estable.
  v_m0   := ((r.mes_inicio - 1) % v_paso) + 1;
  v_anio := extract(year from v_desde)::integer;
  v_mes  := v_m0;

  -- Avanzar hasta la primera cuota que cae dentro de la vigencia.
  loop
    v_fecha := public.fecha_de_cuota(v_anio, v_mes, r.dia_vencimiento);
    exit when v_fecha >= v_desde;

    v_mes := v_mes + v_paso;
    if v_mes > 12 then
      v_mes  := v_mes - 12;
      v_anio := v_anio + 1;
    end if;

    v_guarda := v_guarda + 1;
    if v_guarda > 24 then
      raise exception 'No se encontro la primera cuota de la regla %', p_regla_id
        using errcode = 'internal_error';
    end if;
  end loop;

  while v_fecha <= v_hasta loop
    v_cuota := ((v_mes - v_m0) / v_paso) + 1;

    insert into public.vencimientos (
      organizacion_id, vehiculo_id, tipo_obligacion_id, regla_id,
      periodo, numero_cuota, fecha_vencimiento, monto_estimado, moneda
    )
    values (
      r.organizacion_id, r.vehiculo_id, r.tipo_obligacion_id, r.id,
      to_char(v_fecha, 'YYYY-MM'), v_cuota, v_fecha, r.monto_estimado, r.moneda
    )
    on conflict (vehiculo_id, tipo_obligacion_id, periodo) do nothing;

    get diagnostics v_afectadas = row_count;
    v_insertados := v_insertados + v_afectadas;

    v_mes := v_mes + v_paso;
    if v_mes > 12 then
      v_mes  := v_mes - 12;
      v_anio := v_anio + 1;
    end if;
    v_fecha := public.fecha_de_cuota(v_anio, v_mes, r.dia_vencimiento);
  end loop;

  return v_insertados;
end;
$fn$;

comment on function public.generar_vencimientos(uuid, integer) is
  'Materializa las cuotas de una regla hasta el horizonte. Idempotente: re-correrla no duplica.';

-- ---------------------------------------------------------------------------
-- Motor para toda una organizacion
-- ---------------------------------------------------------------------------

create or replace function public.generar_vencimientos_organizacion(
  p_organizacion_id uuid,
  p_horizonte_meses integer default 12
)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  v_regla      record;
  v_insertados integer := 0;
begin
  for v_regla in
    select re.id
    from public.reglas_vencimiento re
    join public.vehiculos ve on ve.id = re.vehiculo_id
    where re.organizacion_id = p_organizacion_id
      and re.activa
      and ve.estado not in ('vendido', 'baja')
    order by re.id
  loop
    v_insertados := v_insertados
      + public.generar_vencimientos(v_regla.id, p_horizonte_meses);
  end loop;

  return v_insertados;
end;
$fn$;

comment on function public.generar_vencimientos_organizacion(uuid, integer) is
  'Corre el motor sobre todas las reglas activas de la organizacion. Lo llama el cron de 0006.';

-- ---------------------------------------------------------------------------
-- Baja de vehiculo: anular cuotas FUTURAS y desactivar sus reglas
--
-- Las cuotas ya vencidas NO se tocan: si vendiste el auto, la deuda anterior
-- sigue siendo tuya.
-- ---------------------------------------------------------------------------

create or replace function public.fn_anular_vencimientos_futuros()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_corte date;
begin
  if new.estado in ('vendido', 'baja') and old.estado not in ('vendido', 'baja') then
    v_corte := coalesce(
      new.fecha_baja,
      (now() at time zone (
        select o.zona_horaria from public.organizaciones o where o.id = new.organizacion_id
      ))::date
    );

    update public.vencimientos v
    set estado = 'anulado',
        notas  = concat_ws(' | ', v.notas, 'Anulado automaticamente: vehiculo ' || new.estado)
    where v.vehiculo_id = new.id
      and v.estado in ('pendiente', 'parcial')
      and v.fecha_vencimiento > v_corte;

    update public.reglas_vencimiento re
    set activa = false
    where re.vehiculo_id = new.id
      and re.activa;
  end if;

  return new;
end;
$fn$;

create trigger trg_vehiculos_anular_futuros
  after update of estado on public.vehiculos
  for each row execute function public.fn_anular_vencimientos_futuros();

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger trg_vencimientos_actualizacion before update on public.vencimientos
  for each row execute function public.fn_marcar_actualizacion();

create trigger trg_vencimientos_auditoria after insert or update or delete on public.vencimientos
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.vencimientos enable row level security;

create policy vencimientos_lectura on public.vencimientos
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy vencimientos_alta on public.vencimientos
  for insert to authenticated
  with check (public.puede_operar(organizacion_id));

create policy vencimientos_modificacion on public.vencimientos
  for update to authenticated
  using (public.puede_operar(organizacion_id))
  with check (public.puede_operar(organizacion_id));

create policy vencimientos_baja on public.vencimientos
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.vencimientos to authenticated;
grant select on public.v_vencimientos_estado to authenticated;

grant execute on function
  public.fecha_de_cuota(integer, integer, integer),
  public.generar_vencimientos(uuid, integer),
  public.generar_vencimientos_organizacion(uuid, integer)
  to authenticated;
