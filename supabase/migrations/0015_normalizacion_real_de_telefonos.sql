-- =============================================================================
-- 0015 - Normalizar telefonos argentinos de verdad
--
-- BUG QUE CORRIGE: 0013 comparaba los ultimos 10 digitos. Eso NO alcanza,
-- porque el prefijo 15 de celular va en el medio, despues del codigo de area:
--
--   +54 9 351 123-4567  ->  5493511234567  ->  ultimos 10: 3511234567
--   0351 15 123 4567    ->  0351151234567  ->  ultimos 10: 1151234567   <-- otro
--
-- Es la misma linea y daban claves distintas. Consecuencia: se podian crear dos
-- invitaciones pendientes para la misma persona, y el canje quedaba ambiguo.
-- Lo detecto el test que probaba justamente ese caso.
--
-- La numeracion argentina se reduce a 10 digitos significativos (codigo de area
-- + abonado). El codigo de area tiene 2, 3 o 4 digitos, asi que el 15 aparece
-- en la posicion 3, 4 o 5. Se lo saca buscando el largo total de 12.
-- =============================================================================

-- Las columnas generadas hay que soltarlas para poder cambiar la funcion:
-- redefinirla sola dejaria los valores ya guardados con el calculo viejo.
-- Al volver a crearlas, Postgres las recalcula para todas las filas.
alter table public.invitaciones      drop column telefono_clave;
alter table public.vinculos_telegram drop column telefono_clave;

create or replace function public.normalizar_telefono(p_telefono text)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  d text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  k integer;
begin
  if d = '' then
    return null;
  end if;

  -- Prefijo de salida internacional.
  if left(d, 2) = '00' then
    d := substr(d, 3);
  end if;

  -- Codigo de pais.
  if left(d, 2) = '54' then
    d := substr(d, 3);
  end if;

  -- El 9 que Argentina antepone a los moviles en formato internacional.
  if left(d, 1) = '9' and length(d) = 11 then
    d := substr(d, 2);
  end if;

  -- Prefijo de larga distancia nacional.
  if left(d, 1) = '0' then
    d := substr(d, 2);
  end if;

  -- El 15 de movil, que va despues del codigo de area (2 a 4 digitos).
  -- Solo se saca si el largo da 12, que es el unico caso donde sobra.
  if length(d) = 12 then
    for k in 2..4 loop
      if substr(d, k + 1, 2) = '15' then
        d := substr(d, 1, k) || substr(d, k + 3);
        exit;
      end if;
    end loop;
  end if;

  return nullif(d, '');
end;
$fn$;

comment on function public.normalizar_telefono(text) is
  'Lleva un telefono argentino a sus 10 digitos significativos, saque como se escriba: '
  '+54 9 351 123-4567, 0351 15 123 4567 y 3511234567 dan todos 3511234567.';

create or replace function public.clave_telefono(p_telefono text)
returns text
language sql
immutable
parallel safe
as $fn$
  -- right() como red por si entra un numero que no es argentino y queda mas
  -- largo: igual se compara por la cola.
  select right(public.normalizar_telefono(p_telefono), 10);
$fn$;

-- Recrear las columnas generadas (se recalculan solas) y su indice.
alter table public.invitaciones
  add column telefono_clave text generated always as (public.clave_telefono(telefono)) stored;

alter table public.vinculos_telegram
  add column telefono_clave text generated always as (public.clave_telefono(telefono)) stored;

create unique index invitaciones_telefono_pendiente_idx
  on public.invitaciones (organizacion_id, telefono_clave)
  where telefono_clave is not null and not anulada and usada_en is null;
