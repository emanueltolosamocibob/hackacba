-- =============================================================================
-- 0006 - Avisos, tarea diaria e importacion
--
-- La tabla `avisos` es una COLA, no una bitacora: una fila con enviado_en nulo
-- es un aviso programado y todavia sin despachar. La interfaz (bot) solo tiene
-- que leer las pendientes, mandarlas y marcarlas. Toda la decision de "a quien
-- hay que avisarle y cuando" vive aca, en la base.
-- =============================================================================

create table public.reglas_aviso (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones (id) on delete cascade,
  tipo_obligacion_id uuid,
  dias_antes         smallint[] not null default array[30, 15, 7, 3, 1]::smallint[],
  avisar_el_dia      boolean not null default true,
  dias_despues       smallint[] not null default array[1, 7, 15]::smallint[],
  activa             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- Una regla por tipo, mas una general (tipo nulo) por organizacion.
  -- NULLS NOT DISTINCT hace que la general tambien sea unica.
  constraint reglas_aviso_unicas
    unique nulls not distinct (organizacion_id, tipo_obligacion_id),

  -- MATCH SIMPLE: con tipo_obligacion_id nulo la FK no se exige.
  constraint reglas_aviso_tipo_misma_organizacion
    foreign key (tipo_obligacion_id, organizacion_id)
    references public.tipos_obligacion (id, organizacion_id) on delete cascade,

  constraint reglas_aviso_dias_validos
    check (
      dias_antes  <@ array[1,2,3,5,7,10,15,20,30,45,60,90]::smallint[]
      and dias_despues <@ array[1,2,3,5,7,10,15,20,30,45,60,90]::smallint[]
    )
);

comment on table public.reglas_aviso is
  'Cuando avisar. La regla con tipo_obligacion_id nulo es el default de la organizacion.';

create table public.avisos (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  vencimiento_id  uuid not null references public.vencimientos (id) on delete cascade,
  clave_regla     text not null,
  programado_para date not null,
  canal           text not null default 'telegram',
  destinatario    text,
  enviado_en      timestamptz,
  exito           boolean,
  error           text,
  creado_en       timestamptz not null default now(),

  -- La idempotencia del sistema de avisos: un vencimiento no recibe dos veces
  -- el mismo aviso, por mas veces que corra la tarea diaria.
  constraint avisos_unicos unique (vencimiento_id, clave_regla)
);

comment on table public.avisos is
  'Cola de avisos. enviado_en nulo = pendiente de despacho.';

comment on column public.avisos.clave_regla is
  'Que aviso es: d-30, d-7, d-0 (el dia), d+1, d+15. Junto al vencimiento forma la clave de idempotencia.';

create index avisos_pendientes_idx
  on public.avisos (organizacion_id, programado_para)
  where enviado_en is null;

create index reglas_aviso_org_idx on public.reglas_aviso (organizacion_id) where activa;

-- ---------------------------------------------------------------------------
-- Programacion de avisos
--
-- Encola los avisos que corresponden a hoy. La ventana hacia atras evita que
-- cargar un vencimiento historico dispare de golpe veinte avisos viejos.
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
    -- Regla del tipo si existe; si no, la general de la organizacion.
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

comment on function public.programar_avisos(uuid, integer) is
  'Encola los avisos que vencen hoy segun reglas_aviso. Idempotente.';

-- ---------------------------------------------------------------------------
-- Link de pago: rellena la plantilla del tipo de obligacion
-- ---------------------------------------------------------------------------

create or replace function public.link_de_pago(p_vencimiento_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'vencimiento_id',    ven.id,
    'dominio',           ve.dominio,
    'tipo',              t.nombre,
    'organismo',         t.organismo,
    'periodo',           ven.periodo,
    'numero_cuota',      ven.numero_cuota,
    'fecha_vencimiento', ven.fecha_vencimiento,
    'monto',             coalesce(ven.monto_real, ven.monto_estimado),
    'monto_confirmado',  (ven.monto_real is not null),
    'moneda',            ven.moneda,
    'numero_boleta',     ven.numero_boleta,
    'instrucciones',     t.instrucciones,
    'url', coalesce(
      ven.url_pago,
      replace(
        replace(
          replace(t.url_pago_plantilla, '{dominio}', ve.dominio),
          '{periodo}', ven.periodo
        ),
        '{cuenta}', coalesce(ven.numero_boleta, '')
      )
    )
  )
  into v
  from public.vencimientos ven
  join public.vehiculos ve       on ve.id = ven.vehiculo_id
  join public.tipos_obligacion t on t.id  = ven.tipo_obligacion_id
  where ven.id = p_vencimiento_id;

  return v;
end;
$fn$;

comment on function public.link_de_pago(uuid) is
  'Datos para pagar un vencimiento: URL oficial con los marcadores resueltos, dominio, periodo e importe. '
  'El pago siempre lo ejecuta una persona; el sistema no mueve dinero.';

-- ---------------------------------------------------------------------------
-- Importacion de vehiculos
--
-- Recibe jsonb, no CSV: parsear CSV en PL/pgSQL es fragil con comillas y
-- separadores. El cliente convierte CSV a JSON, que es trivial en cualquier
-- lenguaje, y aca se hace la validacion fila por fila.
-- ---------------------------------------------------------------------------

create or replace function public.importar_vehiculos(
  p_organizacion_id uuid,
  p_flota_id uuid,
  p_filas jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_fila       jsonb;
  v_indice     integer := 0;
  v_importados integer := 0;
  v_errores    jsonb := '[]'::jsonb;
begin
  if not public.puede_operar(p_organizacion_id) then
    raise exception 'Sin permisos para importar en la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'p_filas debe ser un arreglo JSON' using errcode = 'invalid_parameter_value';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    v_indice := v_indice + 1;

    begin
      insert into public.vehiculos (
        organizacion_id, flota_id, dominio, marca, modelo, anio, tipo, numero_motor, numero_chasis
      )
      values (
        p_organizacion_id,
        p_flota_id,
        v_fila ->> 'dominio',
        nullif(v_fila ->> 'marca', ''),
        nullif(v_fila ->> 'modelo', ''),
        nullif(v_fila ->> 'anio', '')::smallint,
        coalesce(nullif(v_fila ->> 'tipo', '')::public.tipo_vehiculo, 'auto'),
        nullif(v_fila ->> 'numero_motor', ''),
        nullif(v_fila ->> 'numero_chasis', '')
      )
      on conflict (organizacion_id, dominio) do nothing;

      if found then
        v_importados := v_importados + 1;
      else
        v_errores := v_errores || jsonb_build_object(
          'fila', v_indice,
          'dominio', v_fila ->> 'dominio',
          'error', 'El dominio ya existe en la organizacion'
        );
      end if;

    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', v_indice,
        'dominio', v_fila ->> 'dominio',
        'error', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'procesadas',  v_indice,
    'importados',  v_importados,
    'con_errores', jsonb_array_length(v_errores),
    'errores',     v_errores
  );
end;
$fn$;

comment on function public.importar_vehiculos(uuid, uuid, jsonb) is
  'Alta masiva de vehiculos. Nunca aborta por una fila mala: devuelve el detalle de errores.';

-- ---------------------------------------------------------------------------
-- Tarea diaria
-- ---------------------------------------------------------------------------

create or replace function public.tarea_diaria(p_horizonte_meses integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org        record;
  v_generados  integer := 0;
  v_encolados  integer := 0;
begin
  for v_org in
    select o.id from public.organizaciones o where o.activa order by o.id
  loop
    v_generados := v_generados
      + public.generar_vencimientos_organizacion(v_org.id, p_horizonte_meses);
    v_encolados := v_encolados
      + public.programar_avisos(v_org.id);
  end loop;

  return jsonb_build_object(
    'corrida_en', now(),
    'vencimientos_generados', v_generados,
    'avisos_encolados', v_encolados
  );
end;
$fn$;

comment on function public.tarea_diaria(integer) is
  'Genera cuotas futuras y encola los avisos del dia para todas las organizaciones activas.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger trg_reglas_aviso_actualizacion before update on public.reglas_aviso
  for each row execute function public.fn_marcar_actualizacion();

create trigger trg_reglas_aviso_auditoria after insert or update or delete on public.reglas_aviso
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.reglas_aviso enable row level security;
alter table public.avisos       enable row level security;

create policy reglas_aviso_lectura on public.reglas_aviso
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy reglas_aviso_escritura on public.reglas_aviso
  for all to authenticated
  using (public.puede_administrar(organizacion_id))
  with check (public.puede_administrar(organizacion_id));

create policy avisos_lectura on public.avisos
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

-- El despachador marca enviado_en / exito / error. Encolar lo hace el sistema.
create policy avisos_marcado on public.avisos
  for update to authenticated
  using (public.puede_operar(organizacion_id))
  with check (public.puede_operar(organizacion_id));

grant select, insert, update, delete on public.reglas_aviso to authenticated;
grant select, update on public.avisos to authenticated;

grant execute on function
  public.programar_avisos(uuid, integer),
  public.link_de_pago(uuid),
  public.importar_vehiculos(uuid, uuid, jsonb)
  to authenticated;

-- tarea_diaria la corre el cron, no un usuario final.
revoke execute on function public.tarea_diaria(integer) from public;

-- ---------------------------------------------------------------------------
-- Programacion del cron
--
-- Supabase corre pg_cron en UTC: 11:00 UTC = 08:00 en America/Argentina/Cordoba.
-- Va en bloque guardado porque pg_cron puede no estar habilitado todavia; en
-- ese caso la migracion aplica igual y se habilita desde el panel
-- (Database > Extensions > pg_cron) corriendo despues solo este bloque.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.unschedule('flota-tarea-diaria')
    where exists (select 1 from cron.job where jobname = 'flota-tarea-diaria');

    perform cron.schedule(
      'flota-tarea-diaria',
      '0 11 * * *',
      'select public.tarea_diaria();'
    );

    raise notice 'pg_cron: tarea diaria programada a las 11:00 UTC (08:00 ART).';
  else
    raise notice 'pg_cron no disponible: habilitarlo en Database > Extensions y reejecutar este bloque.';
  end if;
exception when others then
  raise notice 'No se pudo programar el cron (%). Habilitar pg_cron y reejecutar.', sqlerrm;
end;
$cron$;
