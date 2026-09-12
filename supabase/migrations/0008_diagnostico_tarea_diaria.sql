-- =============================================================================
-- 0008 - Diagnostico de la tarea diaria
--
-- El bloque que programa pg_cron en 0006 esta guardado con EXCEPTION, asi que
-- si falla no rompe la migracion... pero tampoco avisa. En un sistema cuyo
-- trabajo es no perderse un vencimiento, "creo que el cron esta andando" no
-- alcanza: esto lo hace consultable.
-- =============================================================================

create or replace function public.estado_tarea_diaria()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_instalado boolean;
  v_job       jsonb;
  v_ultima    jsonb;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron')
    into v_instalado;

  if not v_instalado then
    return jsonb_build_object(
      'pg_cron_instalado', false,
      'programado', false,
      'sugerencia', 'Habilitar pg_cron en Database > Extensions y reejecutar el bloque final de 0006.'
    );
  end if;

  select jsonb_build_object(
    'jobid',    j.jobid,
    'schedule', j.schedule,
    'activo',   j.active,
    'comando',  j.command
  )
    into v_job
  from cron.job j
  where j.jobname = 'flota-tarea-diaria';

  begin
    select jsonb_build_object(
      'inicio', d.start_time,
      'fin',    d.end_time,
      'estado', d.status,
      'mensaje', d.return_message
    )
      into v_ultima
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'flota-tarea-diaria'
    order by d.start_time desc
    limit 1;
  exception when others then
    v_ultima := null;
  end;

  return jsonb_build_object(
    'pg_cron_instalado', true,
    'programado', v_job is not null,
    'job', v_job,
    'ultima_corrida', v_ultima,
    'nota', 'El schedule esta en UTC: 0 11 * * * equivale a las 08:00 de America/Argentina/Cordoba.'
  );
end;
$fn$;

comment on function public.estado_tarea_diaria() is
  'Dice si pg_cron esta habilitado, si la tarea diaria quedo programada y como le fue la ultima vez.';

grant execute on function public.estado_tarea_diaria() to authenticated;
