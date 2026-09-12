-- =============================================================================
-- 0010 - Toda organizacion nace con reglas de aviso
--
-- PROBLEMA: programar_avisos() busca la regla aplicable en reglas_aviso y, si
-- no hay ninguna, sigue de largo. Como una organizacion recien creada no tiene
-- reglas, el sistema encolaba CERO avisos: silenciosamente no avisaba nada.
--
-- Se detecto sembrando el dataset de demostracion: 650 vencimientos, 82
-- vencidos, y "0 avisos encolados".
--
-- Un sistema cuyo unico trabajo es no perderse un vencimiento no puede depender
-- de que alguien se acuerde de configurar los avisos. Los defaults se crean
-- solos y despues se editan.
-- =============================================================================

create or replace function public.fn_alta_reglas_aviso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- tipo_obligacion_id NULL = regla general de la organizacion, la que aplica
  -- a todo tipo que no tenga una propia.
  insert into public.reglas_aviso (organizacion_id, tipo_obligacion_id)
  values (new.id, null)
  on conflict do nothing;

  return new;
end;
$fn$;

comment on function public.fn_alta_reglas_aviso() is
  'Crea la regla de aviso general (D-30/15/7/3/1, el dia, y D+1/7/15) de una organizacion nueva.';

create trigger trg_organizaciones_reglas_aviso
  after insert on public.organizaciones
  for each row execute function public.fn_alta_reglas_aviso();

-- ---------------------------------------------------------------------------
-- Backfill: las organizaciones que ya existen tambien tienen que avisar
-- ---------------------------------------------------------------------------

insert into public.reglas_aviso (organizacion_id, tipo_obligacion_id)
select o.id, null
from public.organizaciones o
where not exists (
  select 1
  from public.reglas_aviso ra
  where ra.organizacion_id = o.id
    and ra.tipo_obligacion_id is null
);
