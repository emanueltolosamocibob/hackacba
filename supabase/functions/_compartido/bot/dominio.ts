// =============================================================================
// Parseo de dominios (patentes) desde texto libre de WhatsApp: con o sin
// espacios/guiones, mayusculas o minusculas. Mismo criterio que el trigger
// fn_normalizar_dominio (migracion 0001) y registrar_dominio_chat (0020):
// Mercosur AAA000 viejo o AA000AA nuevo.
// =============================================================================

const PATRON_VIEJO = /\b([A-Za-z]{3}[\s-]?\d{3})\b/;
const PATRON_MERCOSUR = /\b([A-Za-z]{2}[\s-]?\d{3}[\s-]?[A-Za-z]{2})\b/;

function limpiar(valor: string): string {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Busca un dominio valido dentro de un mensaje libre. null si no hay ninguno. */
export function extraerDominio(texto: string): string | null {
  const mercosur = PATRON_MERCOSUR.exec(texto);
  if (mercosur) {
    const limpio = limpiar(mercosur[1]);
    if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(limpio)) return limpio;
  }
  const viejo = PATRON_VIEJO.exec(texto);
  if (viejo) {
    const limpio = limpiar(viejo[1]);
    if (/^[A-Z]{3}\d{3}$/.test(limpio)) return limpio;
  }
  return null;
}

function sinAcentos(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Las intenciones se detectan por palabras clave, no por frase exacta: la
// gente escribe "quiero pagar la municipal" o "mostrame mi flota", no comandos.
const PALABRAS_FLOTA = /\b(flota|mis (vehiculos|autos|dominios|patentes|camiones))\b/;
const PALABRAS_LINK_PAGO = /\b(link|links|enlace|pagar|pago|pagos|boleta|abonar)\b/;
const PALABRAS_DEUDA_FLOTA = /\b(deuda|deudas|debo|deben|vencid\w*)\b/;

/** Insensible a mayusculas y acentos: "Flóta", "FLOTA" y "flota" matchean igual. */
export function esComandoFlota(texto: string): boolean {
  return PALABRAS_FLOTA.test(sinAcentos(texto.trim().toLowerCase()));
}

/** Insensible a mayusculas y acentos: "Pagár", "PAGAR" y "pagar" matchean igual. */
export function esComandoLinkPago(texto: string): boolean {
  return PALABRAS_LINK_PAGO.test(sinAcentos(texto.trim().toLowerCase()));
}

/**
 * "Pasame todos los vehiculos de mi flota con deuda", "cuánto debo", etc: pide
 * el estado de TODA la flota, no de una patente puntual. Si el texto trae una
 * patente reconocible, no es esta intencion (es consultar_dominio de esa
 * patente puntual, aunque tambien mencione la palabra "deuda").
 */
export function esConsultaDeudaFlota(texto: string): boolean {
  if (extraerDominio(texto)) return false;
  return PALABRAS_DEUDA_FLOTA.test(sinAcentos(texto.trim().toLowerCase()));
}
