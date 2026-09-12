// =============================================================================
// Validacion de sintaxis E.164 argentina.
//
// Sintaxis solamente: la canonicalizacion real (el "15" de celular va en el
// medio, etc.) vive en la base (clave_telefono / canonicalizar_telefono_argentino,
// migraciones 0015 y 0018). Aca no se reimplementa esa logica; esto solo
// descarta lo que ni siquiera tiene la forma correcta antes de tocar un
// proveedor externo o de armar un chatId de WhatsApp.
// =============================================================================

const PATRON_E164_AR = /^\+?54(9)?(\d{10})$/;

export interface TelefonoValidado {
  /** Siempre con "+" y, si el numero lo traia, con el "9" de movil internacional. */
  e164: string;
  /** Los diez digitos significativos, sin codigo de pais ni "9". */
  digitosNacionales: string;
}

/**
 * Acepta "+54" (el "+" es opcional) mas un "9" opcional de movil
 * internacional, mas exactamente diez digitos. Cualquier otra forma es
 * invalida.
 */
export function validarTelefonoArgentino(valor: string): TelefonoValidado | null {
  const recortado = valor.trim();
  const coincidencia = PATRON_E164_AR.exec(recortado);
  if (!coincidencia) return null;

  const nueve = coincidencia[1] ?? '';
  const digitosNacionales = coincidencia[2];
  return { e164: `+54${nueve}${digitosNacionales}`, digitosNacionales };
}

/**
 * El identificador que espera WAHA para armar un chatId (`<digitos>@c.us`).
 *
 * Nota de riesgo: no se verifico contra la instancia WAHA real con un numero
 * de prueba (no se proveyo ninguno). Se preserva el prefijo tal cual vino
 * (con o sin "9"); si en la practica WAHA/WhatsApp Web necesita otra forma
 * para moviles argentinos, ajustar aca, no en cada llamador.
 */
export function telefonoParaWaha(valor: string): string | null {
  const validado = validarTelefonoArgentino(valor);
  if (!validado) return null;
  return validado.e164.slice(1); // sin el "+"
}
