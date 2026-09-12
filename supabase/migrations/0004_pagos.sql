-- =============================================================================
-- 0004 - Pagos y comprobantes
--
-- Un vencimiento se salda con uno o mas pagos. El estado del vencimiento no se
-- toca a mano: lo recalcula un trigger a partir de la suma de pagos vigentes.
--
-- Los pagos no se borran, se anulan: la trazabilidad importa mas que la
-- prolijidad de la tabla.
-- =============================================================================

create table public.pagos (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  vencimiento_id   uuid not null,
  monto            numeric(14, 2) not null check (monto > 0),
  moneda           char(3) not null default 'ARS',
  fecha_pago       date not null default current_date,
  medio_pago       public.medio_pago not null default 'transferencia',
  referencia       text,
  comprobante_url  text,
  anulado          boolean not null default false,
  motivo_anulacion text,
  registrado_por   uuid references auth.users (id) on delete set null,
  notas            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint pagos_vencimiento_misma_organizacion
    foreign key (vencimiento_id, organizacion_id)
    references public.vencimientos (id, organizacion_id) on delete cascade,

  constraint pagos_anulacion_con_motivo
    check (not anulado or motivo_anulacion is not null)
);

comment on table public.pagos is
  'Pagos aplicados a un vencimiento. Admite parciales: varios pagos por vencimiento.';

comment on column public.pagos.anulado is
  'Baja logica. Un pago anulado no cuenta para el saldo pero queda en la bitacora.';

comment on column public.pagos.comprobante_url is
  'Ruta dentro del bucket "comprobantes": <organizacion_id>/<vencimiento_id>/<archivo>.';

create index pagos_vencimiento_idx on public.pagos (vencimiento_id) where not anulado;
create index pagos_org_fecha_idx   on public.pagos (organizacion_id, fecha_pago desc);

-- ---------------------------------------------------------------------------
-- Recalculo del estado del vencimiento
--
-- Se dispara desde pagos (alta, cambio, anulacion, baja) y tambien cuando
-- cambia el importe del propio vencimiento, porque el umbral se mueve.
-- ---------------------------------------------------------------------------

create or replace function public.estado_segun_pagos(
  p_vencimiento_id uuid,
  p_total numeric,
  p_estado_actual public.estado_vencimiento
)
returns public.estado_vencimiento
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_pagado numeric(14, 2);
begin
  -- condonado y anulado son decisiones humanas: los pagos no las revierten.
  if p_estado_actual in ('condonado', 'anulado') then
    return p_estado_actual;
  end if;

  select coalesce(sum(p.monto), 0)
    into v_pagado
  from public.pagos p
  where p.vencimiento_id = p_vencimiento_id
    and not p.anulado;

  if v_pagado <= 0 then
    return 'pendiente';
  end if;

  -- Sin importe conocido no hay contra que comparar. Se toma el pago como
  -- cancelatorio: dejarlo en 'parcial' para siempre generaria una alarma
  -- permanente, que es peor en un sistema cuyo trabajo es avisar.
  if p_total is null then
    return 'pagado';
  end if;

  if v_pagado < p_total then
    return 'parcial';
  end if;

  return 'pagado';
end;
$fn$;

comment on function public.estado_segun_pagos(uuid, numeric, public.estado_vencimiento) is
  'Estado de liquidacion que corresponde a un vencimiento segun la suma de sus pagos vigentes.';

-- Desde pagos: hay que ir a buscar el vencimiento y actualizarlo.
create or replace function public.fn_recalcular_estado_desde_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vencimiento_id uuid;
  v_total          numeric(14, 2);
  v_estado_actual  public.estado_vencimiento;
  v_nuevo          public.estado_vencimiento;
begin
  v_vencimiento_id := coalesce(new.vencimiento_id, old.vencimiento_id);

  select coalesce(v.monto_real, v.monto_estimado), v.estado
    into v_total, v_estado_actual
  from public.vencimientos v
  where v.id = v_vencimiento_id;

  if not found then
    return coalesce(new, old);
  end if;

  v_nuevo := public.estado_segun_pagos(v_vencimiento_id, v_total, v_estado_actual);

  if v_nuevo is distinct from v_estado_actual then
    update public.vencimientos set estado = v_nuevo where id = v_vencimiento_id;
  end if;

  return coalesce(new, old);
end;
$fn$;

-- Desde el propio vencimiento: BEFORE, para fijar el estado sin re-disparar.
create or replace function public.fn_recalcular_estado_por_importe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.estado := public.estado_segun_pagos(
    new.id,
    coalesce(new.monto_real, new.monto_estimado),
    new.estado
  );
  return new;
end;
$fn$;

create trigger trg_pagos_recalcular_estado
  after insert or update or delete on public.pagos
  for each row execute function public.fn_recalcular_estado_desde_pago();

-- Solo cuando el UPDATE menciona los importes. El trigger de pagos actualiza
-- unicamente la columna estado, asi que no entra por aca y no hay recursion.
create trigger trg_vencimientos_recalcular_por_importe
  before update of monto_real, monto_estimado on public.vencimientos
  for each row execute function public.fn_recalcular_estado_por_importe();

-- ---------------------------------------------------------------------------
-- Triggers de infraestructura
-- ---------------------------------------------------------------------------

create trigger trg_pagos_actualizacion before update on public.pagos
  for each row execute function public.fn_marcar_actualizacion();

create trigger trg_pagos_auditoria after insert or update or delete on public.pagos
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.pagos enable row level security;

create policy pagos_lectura on public.pagos
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy pagos_alta on public.pagos
  for insert to authenticated
  with check (public.puede_operar(organizacion_id));

create policy pagos_modificacion on public.pagos
  for update to authenticated
  using (public.puede_operar(organizacion_id))
  with check (public.puede_operar(organizacion_id));

-- Los pagos se anulan, no se borran. El DELETE queda para administradores.
create policy pagos_baja on public.pagos
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

grant select, insert, update, delete on public.pagos to authenticated;

grant execute on function
  public.estado_segun_pagos(uuid, numeric, public.estado_vencimiento)
  to authenticated;

-- =============================================================================
-- Storage: bucket de comprobantes
--
-- Convencion de rutas: <organizacion_id>/<vencimiento_id>/<archivo>
-- El primer segmento es el que gobierna el acceso.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy comprobantes_lectura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] in (
      select org::text from public.organizaciones_del_usuario() as org
    )
  );

create policy comprobantes_alta on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] in (
      select org::text from public.organizaciones_del_usuario() as org
    )
  );

create policy comprobantes_modificacion on storage.objects
  for update to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] in (
      select org::text from public.organizaciones_del_usuario() as org
    )
  );

create policy comprobantes_baja on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] in (
      select org::text from public.organizaciones_del_usuario() as org
    )
  );
