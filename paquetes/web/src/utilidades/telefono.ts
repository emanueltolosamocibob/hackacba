/**
 * Ayudas de presentacion para el telefono, y nada mas.
 *
 * La normalizacion de verdad vive en `clave_telefono()` en la base (migracion
 * 0015), que sabe que el 15 de celular va en el medio, despues del codigo de
 * area. Reimplementar esa regla aca seria tener dos verdades: el cliente
 * agrupa para la vista, el servidor decide.
 */

/**
 * Digitos nacionales significativos: codigo de area + numero, sin el 0 y sin
 * el 15. Siempre diez. El "9" de movil internacional no lo escribe la
 * persona: el campo lo fija en el prefijo y `aE164` lo antepone al armar el
 * numero completo.
 */
const DIGITOS_NACIONALES = 10;

/** Deja solo los digitos del texto, acotados a lo que puede medir un numero. */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, DIGITOS_NACIONALES);
}

/** Agrupa los digitos para que se puedan leer: `351 2345 678`. */
export function agruparTelefono(digitos: string): string {
  const d = soloDigitos(digitos);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}

/**
 * Arma el E.164 completo de un movil argentino: "+54" + "9" (fijo, todo
 * WhatsApp de flota es movil) + los diez digitos nacionales. Mismo formato
 * que acepta el hook de Auth (ver `supabase/functions/_compartido/alta/telefono.ts`
 * en la branch `feat/alta-otp-edge`). Devuelve `null` si no hay exactamente
 * diez digitos.
 */
export function aE164(digitos: string): string | null {
  const d = soloDigitos(digitos);
  if (d.length !== DIGITOS_NACIONALES) return null;
  return `+549${d}`;
}
