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

const COMANDOS_FLOTA = ['flota', 'mis vehiculos', 'mis vehículos', 'mis autos', 'mis dominios'];

function sinAcentos(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function esComandoFlota(texto: string): boolean {
  const normalizado = texto.trim().toLowerCase();
  return COMANDOS_FLOTA.includes(normalizado);
}

const COMANDOS_LINK_PAGO = ['link de pago', 'pagar', 'pagar muni', 'link'];

/** Insensible a mayusculas y acentos: "Pagár", "PAGAR" y "pagar" matchean igual. */
export function esComandoLinkPago(texto: string): boolean {
  const normalizado = sinAcentos(texto.trim().toLowerCase());
  return COMANDOS_LINK_PAGO.includes(normalizado);
}
