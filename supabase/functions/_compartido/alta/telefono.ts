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
 * Los JID de WhatsApp para moviles argentinos son siempre "549" + los diez
 * digitos nacionales, sin importar si quien escribio el numero incluyo el
 * "9" o no: es una convencion del protocolo, no del formato E.164 de origen.
 * Un chatId "54351...' (sin el "9") no entrega. Por eso aca se fuerza el
 * "549" siempre, independiente de lo que haya matcheado `validarTelefonoArgentino`.
 */
export function telefonoParaWaha(valor: string): string | null {
  const validado = validarTelefonoArgentino(valor);
  if (!validado) return null;
  return `549${validado.digitosNacionales}`;
}
