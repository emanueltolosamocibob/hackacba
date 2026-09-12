/**
 * Ayudas de presentacion para el telefono, y nada mas.
 *
 * La normalizacion de verdad vive en `clave_telefono()` en la base (migracion
 * 0015), que sabe que el 15 de celular va en el medio, despues del codigo de
 * area. Reimplementar esa regla aca seria tener dos verdades: el cliente
 * agrupa para la vista, el servidor decide.
 */

/** Largo maximo de un numero nacional con el 9 internacional. */
const MAXIMO_DIGITOS = 11;

/** Deja solo los digitos del texto, acotados a lo que puede medir un numero. */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, MAXIMO_DIGITOS);
}

/** Agrupa los digitos para que se puedan leer: `351 2345 678`. */
export function agruparTelefono(digitos: string): string {
  const d = soloDigitos(digitos);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}
