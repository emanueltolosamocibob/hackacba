// =============================================================================
// Logica pura del webhook de WAHA: separada de Deno.serve para poder probarla
// sin red (design-2, "Chat webhook remains secret-validated, fast-acknowledged,
// text-only, fromMe/receipts ignored, and deduplicated before reply").
// =============================================================================

import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts';
import { extraerDominio, esComandoFlota, esComandoLinkPago } from './dominio.ts';

/** Comparacion en tiempo constante del secreto compartido con WAHA (SPEC parr. 10). */
export function secretoValido(recibido: string | null, esperado: string): boolean {
  if (!recibido) return false;
  const a = new TextEncoder().encode(recibido);
  const b = new TextEncoder().encode(esperado);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

export interface EventoWaha {
  event?: string;
  session?: string;
  payload?: {
    id?: string;
    from?: string;
    fromMe?: boolean;
    body?: string;
    type?: string;
    // grupos de WhatsApp terminan en "@g.us"
  };
}

export type MensajeEntrante =
  | { tipo: 'ignorar'; razon: 'no_es_mensaje' | 'from_me' | 'no_texto' | 'grupo' }
  | { tipo: 'procesar'; idMensaje: string; telefono: string; texto: string };

/** Deriva el telefono E.164 a partir del chatId de WAHA (`<digitos>@c.us` o `@s.whatsapp.net`). */
export function telefonoDesdeChatId(from: string): string | null {
  const digitos = from.split('@')[0]?.replace(/\D/g, '');
  if (!digitos || digitos.length < 10) return null;
  return `+${digitos}`;
}

export function clasificarEvento(evento: EventoWaha): MensajeEntrante {
  if (evento.event !== 'message') return { tipo: 'ignorar', razon: 'no_es_mensaje' };

  const payload = evento.payload;
  if (!payload?.id || !payload.from) return { tipo: 'ignorar', razon: 'no_es_mensaje' };
  if (payload.fromMe) return { tipo: 'ignorar', razon: 'from_me' };
  if (payload.from.endsWith('@g.us')) return { tipo: 'ignorar', razon: 'grupo' };
  if (payload.type && payload.type !== 'chat' && payload.type !== 'text') {
    return { tipo: 'ignorar', razon: 'no_texto' };
  }
  const texto = (payload.body ?? '').trim();
  if (!texto) return { tipo: 'ignorar', razon: 'no_texto' };

  const telefono = telefonoDesdeChatId(payload.from);
  if (!telefono) return { tipo: 'ignorar', razon: 'no_es_mensaje' };

  return { tipo: 'procesar', idMensaje: payload.id, telefono, texto };
}

export const URL_ALTA = 'https://hackacba.vercel.app/agregar';

export type Intencion =
  | { accion: 'sin_registrar' }
  | { accion: 'listar_flota' }
  | { accion: 'consultar_dominio'; dominio: string }
  | { accion: 'link_pago' }
  | { accion: 'ayuda' };

/** Que hacer con un texto ya sabiendo si el numero esta registrado. */
export function interpretarTexto(texto: string, registrado: boolean): Intencion {
  if (!registrado) return { accion: 'sin_registrar' };
  if (esComandoLinkPago(texto)) return { accion: 'link_pago' };
  if (esComandoFlota(texto)) return { accion: 'listar_flota' };
  const dominio = extraerDominio(texto);
  if (dominio) return { accion: 'consultar_dominio', dominio };
  return { accion: 'ayuda' };
}

export const MENSAJE_SIN_REGISTRAR =
  `Todavía no encontré tu número registrado. Dado de alta en ${URL_ALTA} y volvé a escribirme.`;

export const MENSAJE_AYUDA =
  'Mandame la patente del vehículo (ej: AB123CD) para consultar su situación, o escribí "flota" para ver tus vehículos.';

export function mensajeFlotaVacia(): string {
  return 'Todavía no tenés vehículos cargados. Mandame una patente para agregar el primero.';
}

export function mensajeFlota(dominios: string[]): string {
  if (dominios.length === 0) return mensajeFlotaVacia();
  return `Tu flota:\n${dominios.map(d => `• ${d}`).join('\n')}`;
}

// El portal municipal no acepta la patente por query string (SPEC parr. 2.3):
// el mensaje siempre la repite en su propia linea para poder copiarla.
export const URL_PAGO_MUNI = 'https://tributariomuni.cordoba.gob.ar/automotor';
export const URL_PORTAL_MUNI = 'https://tributariomuni.cordoba.gob.ar';

export const MENSAJE_SIN_ULTIMO_DOMINIO =
  'Todavía no tengo una patente tuya para armar el link. Mandame primero la patente (ej: AB123CD).';

export function mensajeLinkPago(dominio: string): string {
  return [
    'Pagá en el portal municipal:',
    URL_PAGO_MUNI,
    URL_PORTAL_MUNI,
    'Patente:',
    dominio,
  ].join('\n');
}
