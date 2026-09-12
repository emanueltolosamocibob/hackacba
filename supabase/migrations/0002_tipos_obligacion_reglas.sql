-- =============================================================================
-- 0002 - Catalogo de obligaciones y reglas de vencimiento
--
-- tipos_obligacion  = QUE se paga (impuesto automotor, seguro, VTV...)
-- reglas_vencimiento = CADA CUANTO lo paga un vehiculo concreto
--
-- La regla es lo que evita cargar cuotas a mano todos los meses: el motor de
-- 0003 las materializa a partir de aca.
-- =============================================================================

-- Necesaria para la restriccion de exclusion por solapamiento de vigencias.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Catalogo de tipos de obligacion (por organizacion)
-- ---------------------------------------------------------------------------

create table public.tipos_obligacion (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones (id) on delete cascade,
  codigo             text not null check (codigo ~ '^[a-z0-9_]{3,50}$'),
  nombre             text not null check (length(btrim(nombre)) between 1 and 120),
  jurisdiccion       public.jurisdiccion not null,
  organismo          text,
  moneda             char(3) not null default 'ARS',
  url_pago_plantilla text,
  instrucciones      text,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  unique (organizacion_id, codigo),
  -- Destino de las claves foraneas compuestas de reglas_vencimiento y vencimientos.
  unique (id, organizacion_id)
);

comment on table public.tipos_obligacion is
  'Catalogo de conceptos a pagar. Cada organizacion tiene el suyo.';

comment on column public.tipos_obligacion.url_pago_plantilla is
  'URL oficial de pago. Admite los marcadores {dominio}, {periodo} y {cuenta}, '
  'que se reemplazan al pedir el link. Sin marcadores, lleva a la pagina generica.';

-- ---------------------------------------------------------------------------
-- Reglas de vencimiento (por vehiculo y tipo)
-- ---------------------------------------------------------------------------

create table public.reglas_vencimiento (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones (id) on delete cascade,
  vehiculo_id        uuid not null,
  tipo_obligacion_id uuid not null,
  frecuencia         public.frecuencia not null,
  dia_vencimiento    smallint not null check (dia_vencimiento between 1 and 31),
  mes_inicio         smallint not null default 1 check (mes_inicio between 1 and 12),
  meses_cuotas       smallint[],
  monto_estimado     numeric(14, 2) check (monto_estimado >= 0),
  moneda             char(3) not null default 'ARS',
  vigente_desde      date not null default current_date,
  vigente_hasta      date,
  activa             boolean not null default true,
  notas              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint reglas_vehiculo_misma_organizacion
    foreign key (vehiculo_id, organizacion_id)
    references public.vehiculos (id, organizacion_id) on delete cascade,

  constraint reglas_tipo_misma_organizacion
    foreign key (tipo_obligacion_id, organizacion_id)
    references public.tipos_obligacion (id, organizacion_id) on delete restrict,

  constraint reglas_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta > vigente_desde),

  constraint reglas_meses_cuotas_validos
    check (
      meses_cuotas is null
      or (
        array_length(meses_cuotas, 1) between 1 and 12
        and meses_cuotas <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
      )
    ),

  -- Dos reglas activas para el mismo vehiculo y tipo con vigencias que se
  -- pisan generarian la misma cuota dos veces. Se corta aca, no en el motor.
  constraint reglas_sin_solapamiento
    exclude using gist (
      vehiculo_id        with =,
      tipo_obligacion_id with =,
      daterange(vigente_desde, vigente_hasta, '[)') with &&
    ) where (activa)
);

comment on table public.reglas_vencimiento is
  'Regla de recurrencia: genera las cuotas de un vehiculo para un tipo de obligacion.';

comment on column public.reglas_vencimiento.mes_inicio is
  'Mes ancla del ciclo (1-12). Para frecuencias mas gruesas que la mensual define '
  'en que meses caen las cuotas: bimestral con mes_inicio=1 cae en ene, mar, may...';

comment on column public.reglas_vencimiento.dia_vencimiento is
  'Dia del mes. Si el mes no lo tiene (31 en abril), el motor usa el ultimo dia del mes.';

comment on column public.reglas_vencimiento.meses_cuotas is
  'Calendario explicito: meses (1-12) en que cae una cuota. Si esta cargado, MANDA sobre '
  'frecuencia y mes_inicio. Existe porque los calendarios reales no siempre son regulares: '
  'el impuesto automotor de Rentas Cordoba son 5 cuotas al anio y 5 no divide 12, asi que '
  'ninguna frecuencia periodica lo expresa. Ejemplo: ARRAY[2,4,6,8,10].';

comment on constraint reglas_sin_solapamiento on public.reglas_vencimiento is
  'Impide dos reglas activas simultaneas para el mismo vehiculo y tipo.';

create index tipos_obligacion_org_idx on public.tipos_obligacion (organizacion_id) where activo;
create index reglas_vehiculo_idx      on public.reglas_vencimiento (vehiculo_id);
create index reglas_org_activa_idx    on public.reglas_vencimiento (organizacion_id) where activa;

-- ---------------------------------------------------------------------------
-- Cuantos meses avanza cada frecuencia
-- ---------------------------------------------------------------------------

create or replace function public.meses_por_frecuencia(p_frecuencia public.frecuencia)
returns integer
language sql
immutable
parallel safe
as $fn$
  select case p_frecuencia
           when 'mensual'       then 1
           when 'bimestral'     then 2
           when 'trimestral'    then 3
           when 'cuatrimestral' then 4
           when 'semestral'     then 6
           when 'anual'         then 12
           when 'unica'         then null
         end;
$fn$;

comment on function public.meses_por_frecuencia(public.frecuencia) is
  'Paso en meses de cada frecuencia. NULL para unica (genera una sola cuota).';

-- ---------------------------------------------------------------------------
-- Siembra del catalogo de Cordoba para una organizacion
--
-- Se expone como funcion en vez de filas fijas en seed.sql para que toda
-- organizacion nueva arranque con el catalogo cargado.
-- ---------------------------------------------------------------------------

create or replace function public.sembrar_catalogo_cordoba(p_organizacion_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_insertados integer;
begin
  if not public.puede_administrar(p_organizacion_id) then
    raise exception 'Sin permisos para sembrar el catalogo de la organizacion %', p_organizacion_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.tipos_obligacion
    (organizacion_id, codigo, nombre, jurisdiccion, organismo, url_pago_plantilla, instrucciones)
  values
    (p_organizacion_id, 'impuesto_automotor_pcial', 'Impuesto Automotor (Provincial)',
     'provincial', 'Rentas Cordoba',
     'https://www.rentascordoba.gob.ar/emisiontributaria/ver-y-pagar/automotor',
     'Consultar por dominio en "Ver y pagar". El calendario de cuotas lo publica la DGR cada anio.'),

    (p_organizacion_id, 'tasa_municipal_automotor', 'Tasa Municipal Automotor',
     'municipal', 'Municipalidad de Cordoba',
     'https://tributariomuni.cordoba.gob.ar/automotor',
     'Solo para vehiculos radicados en la ciudad de Cordoba.'),

    (p_organizacion_id, 'multas', 'Multas e Infracciones',
     'provincial', 'Rentas Cordoba',
     'https://www.rentascordoba.gob.ar/emisiontributaria/ver-y-pagar',
     'No es recurrente: cargar como vencimiento suelto cuando aparece.'),

    (p_organizacion_id, 'seguro', 'Seguro del Vehiculo',
     'privado', null, null,
     'La URL de pago depende de la aseguradora: completarla por vehiculo si difiere.'),

    (p_organizacion_id, 'vtv', 'Revision Tecnica Obligatoria (RTO/VTV)',
     'provincial', 'Gobierno de Cordoba', null,
     'Vencimiento por oblea. Periodicidad segun antiguedad del vehiculo.'),

    (p_organizacion_id, 'gnc', 'Oblea GNC',
     'nacional', 'ENARGAS', null,
     'Solo vehiculos con equipo de GNC. Revision periodica del cilindro.')
  on conflict (organizacion_id, codigo) do nothing;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$fn$;

comment on function public.sembrar_catalogo_cordoba(uuid) is
  'Carga el catalogo base de obligaciones de Cordoba. Idempotente.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger trg_tipos_obligacion_actualizacion before update on public.tipos_obligacion
  for each row execute function public.fn_marcar_actualizacion();
create trigger trg_reglas_actualizacion before update on public.reglas_vencimiento
  for each row execute function public.fn_marcar_actualizacion();

create trigger trg_tipos_obligacion_auditoria after insert or update or delete on public.tipos_obligacion
  for each row execute function public.fn_auditar();
create trigger trg_reglas_auditoria after insert or update or delete on public.reglas_vencimiento
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tipos_obligacion   enable row level security;
alter table public.reglas_vencimiento enable row level security;

-- tipos_obligacion: lo lee cualquier miembro, lo edita un administrador.
create policy tipos_obligacion_lectura on public.tipos_obligacion
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy tipos_obligacion_alta on public.tipos_obligacion
  for insert to authenticated
  with check (public.puede_administrar(organizacion_id));

create policy tipos_obligacion_modificacion on public.tipos_obligacion
  for update to authenticated
  using (public.puede_administrar(organizacion_id))
  with check (public.puede_administrar(organizacion_id));

create policy tipos_obligacion_baja on public.tipos_obligacion
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- reglas_vencimiento: las maneja el operador, que es quien carga la flota.
create policy reglas_lectura on public.reglas_vencimiento
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy reglas_alta on public.reglas_vencimiento
  for insert to authenticated
  with check (public.puede_operar(organizacion_id));

create policy reglas_modificacion on public.reglas_vencimiento
  for update to authenticated
  using (public.puede_operar(organizacion_id))
  with check (public.puede_operar(organizacion_id));

create policy reglas_baja on public.reglas_vencimiento
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

grant select, insert, update, delete
  on public.tipos_obligacion, public.reglas_vencimiento
  to authenticated;

grant execute on function
  public.meses_por_frecuencia(public.frecuencia),
  public.sembrar_catalogo_cordoba(uuid)
  to authenticated;
