// =============================================================================
// Logica pura del webhook de WAHA: separada de Deno.serve para poder probarla
// sin red (design-2, "Chat webhook remains secret-validated, fast-acknowledged,
// text-only, fromMe/receipts ignored, and deduplicated before reply").
// =============================================================================

import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts';
import { extraerDominio, esComandoFlota, esComandoLinkPago, esConsultaDeudaFlota } from './dominio.ts';

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
  | {
    tipo: 'procesar';
    idMensaje: string;
    /** Telefono E.164, o null cuando el remitente llega como LID y hay que resolverlo. */
    telefono: string | null;
    /** Identificador interno de WhatsApp (`<digitos>@lid`); WAHA lo traduce a telefono. */
    lid: string | null;
    texto: string;
  };

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

  // WhatsApp identifica a muchos remitentes con un LID (`<digitos>@lid`) en vez
  // del telefono. Esos digitos no son un numero: hay que pedirle a WAHA la
  // traduccion antes de buscar el vinculo.
  if (payload.from.endsWith('@lid')) {
    return { tipo: 'procesar', idMensaje: payload.id, telefono: null, lid: payload.from, texto };
  }

  const telefono = telefonoDesdeChatId(payload.from);
  if (!telefono) return { tipo: 'ignorar', razon: 'no_es_mensaje' };

  return { tipo: 'procesar', idMensaje: payload.id, telefono, lid: null, texto };
}

export const URL_ALTA = 'https://hackacba.vercel.app/agregar';

export type Intencion =
  | { accion: 'sin_registrar' }
  | { accion: 'listar_flota' }
  | { accion: 'deuda_flota' }
  | { accion: 'consultar_dominio'; dominio: string }
  | { accion: 'link_pago' }
  | { accion: 'ayuda' };

/** Que hacer con un texto ya sabiendo si el numero esta registrado. */
export function interpretarTexto(texto: string, registrado: boolean): Intencion {
  if (!registrado) return { accion: 'sin_registrar' };
  if (esComandoLinkPago(texto)) return { accion: 'link_pago' };
  // Va antes de listar_flota/consultar_dominio: "deudas de mi flota" tambien
  // matchea la palabra "flota", y "cuánto debo" no trae ninguna patente.
  if (esConsultaDeudaFlota(texto)) return { accion: 'deuda_flota' };
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

// El portal municipal no acepta la patente por query string, y no hay nombre de
// parametro que la haga andar: no es que `?identificador=` este mal escrito, es
// que la pagina NUNCA lee la URL. Verificado sobre el bundle (chunk del
// buscador, 14/09/2026): cero `location.search`, cero `router.query`, cero
// `useSearchParams`; el unico `URLSearchParams` arma el request saliente a
// `/deuda/consultar` desde el estado del input. Es una SPA y la patente solo
// entra tecleada. No volver a probar nombres de parametro.
//
// El unico punto del portal que si toma parametro es
// `/pasarelladepago/detalle?pag_id=`, y ese `pag_id` existe recien despues de
// la intencion de pago, del otro lado del reCAPTCHA. No sirve como entrada.
//
// Lo que si existe es una pantalla de carga por rubro: `/multas` (elegir
// "Rodado" y cargar la patente) y `/automotor` (tasa automotor). El mensaje
// manda esas pantallas, no la raiz, y repite la patente en su propia linea:
// WhatsApp la deja copiar de un toque, que es lo mas cerca del prellenado que
// se puede llegar.
export const URL_PAGO_MULTAS_MUNI = 'https://tributariomuni.cordoba.gob.ar/multas';
export const URL_PAGO_MUNI = 'https://tributariomuni.cordoba.gob.ar/automotor';

export const MENSAJE_SIN_ULTIMO_DOMINIO =
  'Todavía no tengo una patente tuya para armar el link. Mandame primero la patente (ej: AB123CD).';

export function mensajeLinkPago(dominio: string): string {
  return [
    `Para pagar lo de *${dominio}* en la Municipalidad:`,
    '',
    '🅿️ Multas (estacionamiento, tránsito): elegí "Rodado" y pegá la patente',
    URL_PAGO_MULTAS_MUNI,
    '',
    '🚗 Tasa automotor: pegá la patente en "Dominio"',
    URL_PAGO_MUNI,
    '',
    'Tocá para copiar la patente:',
    dominio,
  ].join('\n');
}
