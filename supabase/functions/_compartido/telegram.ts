// =============================================================================
// Cliente de la API de Telegram.
//
// Se usa parse_mode HTML y no MarkdownV2: MarkdownV2 obliga a escapar catorce
// caracteres, entre ellos el punto y el guion, que aparecen en cada fecha y en
// cada dominio. Con HTML alcanza con escapar tres.
// =============================================================================

import { TOKEN_BOT } from './entorno.ts';

const BASE = `https://api.telegram.org/bot${TOKEN_BOT}`;

// -------------------------------------------------------- tipos del update

export interface Contacto {
  phone_number: string;
  first_name: string;
  last_name?: string;
  /** Viene SOLO si el contacto es el del propio remitente. Ver verificarContacto(). */
  user_id?: number;
}

export interface Usuario {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface Mensaje {
  message_id: number;
  from?: Usuario;
  chat: { id: number; type: string };
  text?: string;
  contact?: Contacto;
}

export interface ConsultaBoton {
  id: string;
  from: Usuario;
  message?: Mensaje;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Mensaje;
  edited_message?: Mensaje;
  callback_query?: ConsultaBoton;
}

// ------------------------------------------------------------------ botones

export interface Boton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type Teclado = { inline_keyboard: Boton[][] };

/**
 * Telegram corta el callback_data en 64 bytes y no avisa: el boton llega, pero
 * con el dato truncado. Mejor enterarse al construirlo.
 */
export function boton(text: string, callback_data: string): Boton {
  const bytes = new TextEncoder().encode(callback_data).length;
  if (bytes > 64) {
    throw new Error(`callback_data de ${bytes} bytes (maximo 64): ${callback_data}`);
  }
  return { text, callback_data };
}

// --------------------------------------------------------------- llamadas

async function llamar<T>(metodo: string, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(`${BASE}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  const datos = await respuesta.json() as { ok: boolean; result?: T; description?: string };
  if (!datos.ok) {
    throw new Error(`Telegram ${metodo}: ${datos.description ?? respuesta.status}`);
  }
  return datos.result as T;
}

/** Escapa lo que HTML necesita, que es solo esto. */
export const escapar = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface OpcionesEnvio {
  teclado?: Teclado;
  /** Teclado de respuesta (el de abajo), para el boton de compartir contacto. */
  tecladoRespuesta?: unknown;
  responderA?: number;
  vistaPrevia?: boolean;
}

export function enviar(chatId: number, texto: string, opciones: OpcionesEnvio = {}) {
  return llamar<Mensaje>('sendMessage', {
    chat_id: chatId,
    text: texto,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: !opciones.vistaPrevia },
    reply_markup: opciones.teclado ?? opciones.tecladoRespuesta,
    reply_parameters: opciones.responderA ? { message_id: opciones.responderA } : undefined,
  });
}

export function editar(chatId: number, mensajeId: number, texto: string, teclado?: Teclado) {
  return llamar<Mensaje>('editMessageText', {
    chat_id: chatId,
    message_id: mensajeId,
    text: texto,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: teclado,
  });
}

export function responderBoton(consultaId: string, texto?: string) {
  return llamar<boolean>('answerCallbackQuery', { callback_query_id: consultaId, text: texto });
}

/**
 * El "escribiendo..." de Telegram. Dura cinco segundos o hasta el proximo
 * mensaje, y es lo unico que separa "el bot esta pensando" de "el bot murio".
 */
export function escribiendo(chatId: number) {
  return llamar<boolean>('sendChatAction', { chat_id: chatId, action: 'typing' });
}

export async function enviarFoto(
  chatId: number,
  foto: Uint8Array,
  opciones: { nombre?: string; pie?: string; teclado?: Teclado } = {},
) {
  const formulario = new FormData();
  formulario.append('chat_id', String(chatId));
  formulario.append(
    'photo',
    new Blob([foto as BlobPart], { type: 'image/png' }),
    opciones.nombre ?? 'qr.png',
  );
  if (opciones.pie) {
    formulario.append('caption', opciones.pie);
    formulario.append('parse_mode', 'HTML');
  }
  if (opciones.teclado) formulario.append('reply_markup', JSON.stringify(opciones.teclado));

  const respuesta = await fetch(`${BASE}/sendPhoto`, { method: 'POST', body: formulario });
  const datos = await respuesta.json() as { ok: boolean; description?: string };
  if (!datos.ok) throw new Error(`Telegram sendPhoto: ${datos.description ?? respuesta.status}`);
}

// ------------------------------------------------------------ el chequeo

/**
 * El chequeo que sostiene todo el alta.
 *
 * `contact.user_id` viene solo cuando el contacto compartido es el del propio
 * remitente. Sin esta comparacion, cualquiera reenvia la tarjeta de contacto de
 * otra persona y entra como ella: la invitacion se busca por ese numero. Es una
 * linea, y es la diferencia entre un numero verificado y uno declarado.
 */
export function contactoEsDelRemitente(mensaje: Mensaje): boolean {
  const contacto = mensaje.contact;
  return Boolean(contacto?.user_id && mensaje.from && contacto.user_id === mensaje.from.id);
}

/** Teclado con el boton de compartir el numero. */
export const tecladoCompartirNumero = {
  keyboard: [[{ text: 'Compartir mi numero', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const quitarTeclado = { remove_keyboard: true };
