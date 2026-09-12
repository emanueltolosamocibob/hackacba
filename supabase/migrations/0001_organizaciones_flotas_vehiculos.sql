-- =============================================================================
-- 0001 - Organizaciones, miembros, flotas y vehiculos
--
-- Base de la multi-tenencia. Toda tabla de datos lleva organizacion_id y RLS.
-- Las claves foraneas hacia otras tablas del tenant son COMPUESTAS
-- (id, organizacion_id) para que Postgres impida referenciar filas de otra
-- organizacion, incluso si RLS fallara.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tipos enumerados (todos los del sistema; algunos se usan recien en 0002+)
-- ---------------------------------------------------------------------------

create type public.rol_miembro as enum (
  'propietario', 'administrador', 'operador', 'lector'
);

create type public.estado_vehiculo as enum (
  'activo', 'inactivo', 'vendido', 'baja'
);

create type public.tipo_vehiculo as enum (
  'auto', 'camioneta', 'moto', 'camion', 'acoplado', 'utilitario', 'otro'
);

create type public.jurisdiccion as enum (
  'provincial', 'municipal', 'nacional', 'privado'
);

create type public.frecuencia as enum (
  'mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual', 'unica'
);

create type public.estado_vencimiento as enum (
  'pendiente', 'parcial', 'pagado', 'condonado', 'anulado'
);

create type public.medio_pago as enum (
  'transferencia', 'debito_automatico', 'efectivo', 'tarjeta',
  'homebanking', 'pago_facil', 'rapipago', 'otro'
);

create type public.accion_auditoria as enum ('alta', 'modificacion', 'baja');

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.organizaciones (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) between 1 and 120),
  cuit           text check (cuit ~ '^[0-9]{11}$'),
  zona_horaria   text not null default 'America/Argentina/Cordoba',
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.organizaciones is
  'Tenant raiz. El aislamiento de datos se define a este nivel.';

comment on column public.organizaciones.zona_horaria is
  'Zona IANA usada para calcular fechas de vencimiento. Sin CHECK porque pg_timezone_names no es inmutable.';

create table public.miembros (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  usuario_id      uuid not null references auth.users (id) on delete cascade,
  rol             public.rol_miembro not null default 'lector',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (organizacion_id, usuario_id)
);

comment on table public.miembros is
  'Que usuario pertenece a que organizacion y con que rol.';

create table public.flotas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre          text not null check (length(btrim(nombre)) between 1 and 120),
  descripcion     text,
  activa          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (organizacion_id, nombre),
  -- Destino de la clave foranea compuesta de vehiculos.
  unique (id, organizacion_id)
);

comment on table public.flotas is
  'Agrupacion de vehiculos. Una organizacion puede tener varias.';

create table public.vehiculos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  flota_id        uuid not null,
  dominio         text not null,
  marca           text,
  modelo          text,
  anio            smallint check (anio between 1900 and 2100),
  tipo            public.tipo_vehiculo not null default 'auto',
  estado          public.estado_vehiculo not null default 'activo',
  numero_motor    text,
  numero_chasis   text,
  fecha_alta      date not null default current_date,
  fecha_baja      date,
  notas           text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (organizacion_id, dominio),
  -- Destino de las claves foraneas compuestas de 0002 y 0003.
  unique (id, organizacion_id),
  constraint vehiculos_flota_misma_organizacion
    foreign key (flota_id, organizacion_id)
    references public.flotas (id, organizacion_id) on delete restrict,
  constraint vehiculos_baja_posterior_al_alta
    check (fecha_baja is null or fecha_baja >= fecha_alta)
);

comment on table public.vehiculos is
  'La unidad que se controla. El dominio se normaliza a mayusculas sin separadores.';

comment on constraint vehiculos_flota_misma_organizacion on public.vehiculos is
  'Impide asignar un vehiculo a una flota de otra organizacion.';

create table public.auditoria (
  id              bigint generated always as identity primary key,
  organizacion_id uuid,
  usuario_id      uuid,
  tabla           text not null,
  registro_id     uuid,
  accion          public.accion_auditoria not null,
  datos_antes     jsonb,
  datos_despues   jsonb,
  ocurrido_en     timestamptz not null default now()
);

comment on table public.auditoria is
  'Bitacora de cambios. Solo la escribe el trigger fn_auditar (security definer).';

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

create index miembros_usuario_idx     on public.miembros (usuario_id);
create index flotas_organizacion_idx  on public.flotas (organizacion_id);
create index vehiculos_flota_idx      on public.vehiculos (flota_id);
create index vehiculos_org_estado_idx on public.vehiculos (organizacion_id, estado);
create index auditoria_org_fecha_idx  on public.auditoria (organizacion_id, ocurrido_en desc);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares de autorizacion
--
-- SECURITY DEFINER a proposito: leen public.miembros salteando RLS, que es lo
-- que evita la recursion infinita al usarlas dentro de las politicas de esa
-- misma tabla. search_path = '' obliga a calificar todo y cierra el vector de
-- secuestro de search_path.
-- ---------------------------------------------------------------------------

create or replace function public.organizaciones_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.organizacion_id
  from public.miembros m
  where m.usuario_id = (select auth.uid());
$fn$;

comment on function public.organizaciones_del_usuario() is
  'Organizaciones del usuario autenticado. Base de todas las politicas de lectura.';

create or replace function public.tiene_rol(
  p_organizacion_id uuid,
  p_roles public.rol_miembro[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.miembros m
    where m.organizacion_id = p_organizacion_id
      and m.usuario_id = (select auth.uid())
      and m.rol = any (p_roles)
  );
$fn$;

create or replace function public.es_miembro(p_organizacion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.miembros m
    where m.organizacion_id = p_organizacion_id
      and m.usuario_id = (select auth.uid())
  );
$fn$;

create or replace function public.puede_administrar(p_organizacion_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select public.tiene_rol(
    p_organizacion_id,
    array['propietario', 'administrador']::public.rol_miembro[]
  );
$fn$;

create or replace function public.puede_operar(p_organizacion_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select public.tiene_rol(
    p_organizacion_id,
    array['propietario', 'administrador', 'operador']::public.rol_miembro[]
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Triggers de infraestructura
-- ---------------------------------------------------------------------------

create or replace function public.fn_marcar_actualizacion()
returns trigger
language plpgsql
as $fn$
begin
  new.actualizado_en := now();
  return new;
end;
$fn$;

create or replace function public.fn_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_antes    jsonb;
  v_despues  jsonb;
  v_vigente  jsonb;
  v_accion   public.accion_auditoria;
  v_registro uuid;
  v_org      uuid;
begin
  if tg_op = 'DELETE' then
    v_accion  := 'baja';
    v_antes   := to_jsonb(old);
    v_despues := null;
    v_vigente := v_antes;
  elsif tg_op = 'UPDATE' then
    v_accion  := 'modificacion';
    v_antes   := to_jsonb(old);
    v_despues := to_jsonb(new);
    v_vigente := v_despues;
  else
    v_accion  := 'alta';
    v_antes   := null;
    v_despues := to_jsonb(new);
    v_vigente := v_despues;
  end if;

  v_registro := (v_vigente ->> 'id')::uuid;

  -- En organizaciones el propio id ES la organizacion.
  v_org := case
             when tg_table_name = 'organizaciones' then v_registro
             else (v_vigente ->> 'organizacion_id')::uuid
           end;

  insert into public.auditoria (
    organizacion_id, usuario_id, tabla, registro_id, accion, datos_antes, datos_despues
  )
  values (
    v_org, (select auth.uid()), tg_table_name, v_registro, v_accion, v_antes, v_despues
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

create or replace function public.fn_normalizar_dominio()
returns trigger
language plpgsql
as $fn$
begin
  new.dominio := upper(regexp_replace(coalesce(new.dominio, ''), '[^A-Za-z0-9]', '', 'g'));

  if length(new.dominio) not between 6 and 8 then
    raise exception
      'Dominio invalido: "%". Se esperan 6 a 8 caracteres alfanumericos (AAA123 o AB123CD).',
      new.dominio
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- El usuario que crea una organizacion queda como propietario.
create or replace function public.fn_alta_propietario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is not null then
    insert into public.miembros (organizacion_id, usuario_id, rol)
    values (new.id, (select auth.uid()), 'propietario')
    on conflict (organizacion_id, usuario_id) do nothing;
  end if;
  return new;
end;
$fn$;

comment on function public.fn_alta_propietario() is
  'Si auth.uid() es nulo (seed o tarea de sistema) no crea membresia: esos casos asignan miembros explicitamente.';

-- Marcas de tiempo
create trigger trg_organizaciones_actualizacion before update on public.organizaciones
  for each row execute function public.fn_marcar_actualizacion();
create trigger trg_miembros_actualizacion before update on public.miembros
  for each row execute function public.fn_marcar_actualizacion();
create trigger trg_flotas_actualizacion before update on public.flotas
  for each row execute function public.fn_marcar_actualizacion();
create trigger trg_vehiculos_actualizacion before update on public.vehiculos
  for each row execute function public.fn_marcar_actualizacion();

-- Normalizacion y alta de propietario
create trigger trg_vehiculos_normalizar_dominio before insert or update of dominio
  on public.vehiculos
  for each row execute function public.fn_normalizar_dominio();

create trigger trg_organizaciones_alta_propietario after insert on public.organizaciones
  for each row execute function public.fn_alta_propietario();

-- Auditoria
create trigger trg_organizaciones_auditoria after insert or update or delete on public.organizaciones
  for each row execute function public.fn_auditar();
create trigger trg_miembros_auditoria after insert or update or delete on public.miembros
  for each row execute function public.fn_auditar();
create trigger trg_flotas_auditoria after insert or update or delete on public.flotas
  for each row execute function public.fn_auditar();
create trigger trg_vehiculos_auditoria after insert or update or delete on public.vehiculos
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizaciones enable row level security;
alter table public.miembros       enable row level security;
alter table public.flotas         enable row level security;
alter table public.vehiculos      enable row level security;
alter table public.auditoria      enable row level security;

-- organizaciones ------------------------------------------------------------
create policy organizaciones_lectura on public.organizaciones
  for select to authenticated
  using (id in (select public.organizaciones_del_usuario()));

create policy organizaciones_alta on public.organizaciones
  for insert to authenticated
  with check (true);

create policy organizaciones_modificacion on public.organizaciones
  for update to authenticated
  using (public.puede_administrar(id))
  with check (public.puede_administrar(id));

create policy organizaciones_baja on public.organizaciones
  for delete to authenticated
  using (public.tiene_rol(id, array['propietario']::public.rol_miembro[]));

-- miembros ------------------------------------------------------------------
create policy miembros_lectura on public.miembros
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy miembros_alta on public.miembros
  for insert to authenticated
  with check (public.puede_administrar(organizacion_id));

create policy miembros_modificacion on public.miembros
  for update to authenticated
  using (public.puede_administrar(organizacion_id))
  with check (public.puede_administrar(organizacion_id));

create policy miembros_baja on public.miembros
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- flotas --------------------------------------------------------------------
create policy flotas_lectura on public.flotas
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy flotas_alta on public.flotas
  for insert to authenticated
  with check (public.puede_administrar(organizacion_id));

create policy flotas_modificacion on public.flotas
  for update to authenticated
  using (public.puede_administrar(organizacion_id))
  with check (public.puede_administrar(organizacion_id));

create policy flotas_baja on public.flotas
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- vehiculos -----------------------------------------------------------------
create policy vehiculos_lectura on public.vehiculos
  for select to authenticated
  using (organizacion_id in (select public.organizaciones_del_usuario()));

create policy vehiculos_alta on public.vehiculos
  for insert to authenticated
  with check (public.puede_operar(organizacion_id));

create policy vehiculos_modificacion on public.vehiculos
  for update to authenticated
  using (public.puede_operar(organizacion_id))
  with check (public.puede_operar(organizacion_id));

create policy vehiculos_baja on public.vehiculos
  for delete to authenticated
  using (public.puede_administrar(organizacion_id));

-- auditoria -----------------------------------------------------------------
-- Solo lectura, y solo para administradores. La escritura la hace fn_auditar.
create policy auditoria_lectura on public.auditoria
  for select to authenticated
  using (
    organizacion_id in (select public.organizaciones_del_usuario())
    and public.puede_administrar(organizacion_id)
  );

-- ---------------------------------------------------------------------------
-- Permisos (capa gruesa; RLS decide fila por fila)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on public.organizaciones, public.miembros, public.flotas, public.vehiculos
  to authenticated;

grant select on public.auditoria to authenticated;

grant execute on function
  public.organizaciones_del_usuario(),
  public.tiene_rol(uuid, public.rol_miembro[]),
  public.es_miembro(uuid),
  public.puede_administrar(uuid),
  public.puede_operar(uuid)
  to authenticated;
