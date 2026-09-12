-- =============================================================================
-- 0009 - Permitir que las tareas de sistema usen las funciones de negocio
--
-- PROBLEMA: sembrar_catalogo_cordoba() e importar_vehiculos() validan con
-- puede_administrar() / puede_operar(), que dependen de auth.uid(). Una tarea
-- que corre con service_role no tiene usuario, asi que auth.uid() es NULL y la
-- funcion la rechaza. Eso rompe la siembra de datos, la importacion masiva y
-- cualquier automatizacion futura.
--
-- No alcanza con aceptar "auth.uid() es NULL": una peticion anonima de la web
-- tambien tiene auth.uid() NULL. Hay que exigir explicitamente que el rol del
-- JWT sea service_role, que es una clave que solo vive del lado del servidor.
-- =============================================================================

create or replace function public.es_tarea_de_sistema()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$fn$;

comment on function public.es_tarea_de_sistema() is
  'Verdadero solo si la peticion viene con la clave service_role (cron, importadores, backend). '
  'Nunca es verdadero para un usuario final ni para una peticion anonima.';

-- ---------------------------------------------------------------------------
-- Recrear las dos funciones afectadas con la excepcion de sistema
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
  if not (public.puede_administrar(p_organizacion_id) or public.es_tarea_de_sistema()) then
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
  if not (public.puede_operar(p_organizacion_id) or public.es_tarea_de_sistema()) then
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

grant execute on function public.es_tarea_de_sistema() to authenticated;
