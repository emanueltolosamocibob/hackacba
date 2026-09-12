// =============================================================================
// El contrato externo del Auth Send SMS Hook (design-2, seccion "Current
// Supabase Send SMS Hook Contract"). Dos responsabilidades separadas:
//
//   verificarHookSms  -> Standard Webhooks: firma + antiguedad + esquema.
//                        Nunca lee el telefono ni el OTP antes de verificar.
//   manejarHookSms    -> orquesta reserva/envio/cierre con dependencias
//                        inyectadas, para poder probarlo sin red ni base.
//
// El OTP (`payload.sms.otp`) solo vive en memoria de esta funcion y en el
// argumento que se le pasa al proveedor. Nunca aparece en una respuesta HTTP,
// un log ni una excepcion: revisar antes de agregar un nuevo `console.*` o
// un nuevo campo de error.
// =============================================================================

import { z } from 'zod';
import { validarTelefonoArgentino } from './telefono.ts';
import type { ProveedorOtp } from './proveedor-otp.ts';

const TOLERANCIA_SEGUNDOS = 5 * 60;

const EsquemaPayload = z.object({
  user: z
    .object({
      id: z.string(),
      phone: z.string(),
    })
    .passthrough(),
  sms: z.object({
    // Defensa en profundidad: nunca deberia llegar otra cosa que digitos,
    // pero si algo mas se cuela (inyeccion, un proveedor que cambio el
    // formato) se rechaza aca con el mismo 400 generico, antes de pasarlo a
    // WAHA como texto.
    otp: z.string().regex(/^\d{4,10}$/, 'El OTP debe ser solo digitos, de 4 a 10'),
  }),
});

export type PayloadSendSms = z.infer<typeof EsquemaPayload>;

export class ErrorVerificacion extends Error {
  constructor(
    readonly motivo: 'firma_invalida' | 'firma_expirada' | 'payload_invalido',
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorVerificacion';
  }
}

interface CabecerasWebhook {
  id: string;
  timestamp: string;
  firma: string;
}

function leerCabeceras(headers: Headers): CabecerasWebhook {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const firma = headers.get('webhook-signature');
  if (!id || !timestamp || !firma) {
    throw new ErrorVerificacion('firma_invalida', 'Faltan cabeceras de Standard Webhooks');
  }
  return { id, timestamp, firma };
}

function decodificarSecreto(secreto: string): Uint8Array {
  const sinPrefijo = secreto.startsWith('whsec_') ? secreto.slice('whsec_'.length) : secreto;
  return Uint8Array.from(atob(sinPrefijo), (c) => c.charCodeAt(0));
}

async function firmar(clave: Uint8Array, contenido: string): Promise<string> {
  const criptoClave = await crypto.subtle.importKey(
    'raw',
    clave as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', criptoClave, new TextEncoder().encode(contenido));
  return btoa(String.fromCharCode(...new Uint8Array(firma)));
}

function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica firma + antiguedad + esquema sobre el cuerpo crudo. Tira
 * `ErrorVerificacion` ante cualquier problema; jamas devuelve un payload sin
 * haber verificado antes la firma.
 */
export async function verificarHookSms(
  cuerpoCrudo: string,
  headers: Headers,
  secreto: string,
): Promise<{ idEntrega: string; payload: PayloadSendSms }> {
  const { id, timestamp, firma } = leerCabeceras(headers);

  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos)) {
    throw new ErrorVerificacion('firma_invalida', 'Timestamp invalido');
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - segundos) > TOLERANCIA_SEGUNDOS) {
    throw new ErrorVerificacion('firma_expirada', 'La firma esta fuera de tolerancia');
  }

  const clave = decodificarSecreto(secreto);
  const esperada = await firmar(clave, `${id}.${timestamp}.${cuerpoCrudo}`);

  // webhook-signature puede traer mas de una firma separada por espacios,
  // cada una "v1,<base64>". Alcanza con que una coincida.
  const firmasRecibidas = firma
    .split(' ')
    .map((parte) => parte.split(',')[1])
    .filter((v): v is string => Boolean(v));

  const valida = firmasRecibidas.some((recibida) => comparacionSegura(recibida, esperada));
  if (!valida) {
    throw new ErrorVerificacion('firma_invalida', 'La firma no coincide');
  }

  let json: unknown;
  try {
    json = JSON.parse(cuerpoCrudo);
  } catch {
    throw new ErrorVerificacion('payload_invalido', 'El cuerpo no es JSON valido');
  }

  const resultado = EsquemaPayload.safeParse(json);
  if (!resultado.success) {
    throw new ErrorVerificacion('payload_invalido', 'El payload no cumple el esquema esperado');
  }

  return { idEntrega: id, payload: resultado.data };
}

// --------------------------------------------------------------- orquestacion

export type EstadoReserva = 'procesar' | 'duplicada' | 'limitada' | 'agotada';

export interface DependenciasHookSms {
  secreto: string;
  proveedor: ProveedorOtp;
  senal: AbortSignal;
  reservar(idEntrega: string, telefonoE164: string): Promise<{ estado: EstadoReserva }>;
  cerrar(
    idEntrega: string,
    estado: 'enviada' | 'fallida',
    idProveedor?: string,
    codigoError?: string,
  ): Promise<void>;
}

export interface ResultadoHookSms {
  status: number;
  cuerpo: Record<string, unknown>;
  encabezados?: Record<string, string>;
}

/**
 * Orquesta verificar -> reservar -> proveedor -> cerrar con dependencias
 * inyectadas. No conoce Supabase ni WAHA: por eso se puede probar sin red.
 */
export async function manejarHookSms(
  cuerpoCrudo: string,
  headers: Headers,
  deps: DependenciasHookSms,
): Promise<ResultadoHookSms> {
  let verificado: { idEntrega: string; payload: PayloadSendSms };
  try {
    verificado = await verificarHookSms(cuerpoCrudo, headers, deps.secreto);
  } catch (error) {
    if (error instanceof ErrorVerificacion) {
      const status = error.motivo === 'payload_invalido' ? 400 : 401;
      return { status, cuerpo: { error: 'hook_invalido' } };
    }
    throw error;
  }

  const { idEntrega, payload } = verificado;

  const telefono = validarTelefonoArgentino(payload.user.phone);
  if (!telefono) {
    return { status: 400, cuerpo: { error: 'telefono_invalido' } };
  }

  const reserva = await deps.reservar(idEntrega, telefono.e164);

  if (reserva.estado === 'duplicada') {
    return { status: 200, cuerpo: {} };
  }
  if (reserva.estado === 'limitada' || reserva.estado === 'agotada') {
    return {
      status: 429,
      cuerpo: { error: 'limite_de_envios' },
      encabezados: { 'retry-after': '900' },
    };
  }

  const envio = await deps.proveedor.enviar({
    telefonoE164: telefono.e164,
    codigo: payload.sms.otp,
    idempotencia: idEntrega,
    senal: deps.senal,
  });

  if (envio.estado === 'enviado') {
    await deps.cerrar(idEntrega, 'enviada', envio.idExterno);
    return { status: 200, cuerpo: {} };
  }

  await deps.cerrar(idEntrega, 'fallida', undefined, envio.estado);
  return { status: 503, cuerpo: { error: 'proveedor_no_disponible' } };
}
