// =============================================================================
// wa-webhook: recibe eventos de WAHA. No lleva JWT de Supabase (WAHA no sabe
// que existe Supabase Auth); lo protege el header X-Webhook-Secret comparado
// con WA_WEBHOOK_SECRET (config.toml: verify_jwt = false, igual que el hook
// de Send SMS, ver ese comentario).
//
// Responde 200 apenas valida y clasifica el evento; el trabajo real (consultar
// contexto, fuentes vehiculares, responder por WAHA) corre en
// EdgeRuntime.waitUntil para no hacer esperar a WAHA (que reintenta si tarda).
// =============================================================================

import { rpcServicio } from '../_compartido/alta/supabase.ts';
import { crearProveedorMensajeriaWaha } from '../_compartido/alta/mensajeria/waha.ts';
import {
  clasificarEvento,
  interpretarTexto,
  MENSAJE_AYUDA,
  MENSAJE_SIN_REGISTRAR,
  MENSAJE_SIN_ULTIMO_DOMINIO,
  mensajeFlota,
  mensajeFlotaVacia,
  mensajeLinkPago,
  secretoValido,
  type EventoWaha,
} from '../_compartido/bot/webhook.ts';
import { consultarFlota, consultarVehiculo } from '../_compartido/bot/fuentes/consulta.ts';
import { formatearReporte, formatearReporteFlota } from '../_compartido/bot/respuestas.ts';

// Tope de patentes que se consultan en un solo mensaje de "deuda de flota":
// mantiene la corrida dentro de limites razonables de WAHA/Edge Functions.
const LIMITE_DEUDA_FLOTA = 8;

function requerido(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) throw new Error(`Falta el secreto ${nombre}. Definirlo con: supabase secrets set ${nombre}=...`);
  return valor;
}

function json(cuerpo: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

interface ContextoChat {
  usuario_id: string;
  organizacion_id: string;
  nombre_organizacion: string;
  ultimo_dominio: string | null;
}

interface FilaDominio {
  dominio: string;
}

/**
 * Traduce un LID de WhatsApp al telefono real con el endpoint de WAHA
 * `GET /api/{sesion}/lids/{lid}` → `{ lid, pn: "<digitos>@c.us" }`.
 */
async function resolverLid(lid: string): Promise<string | null> {
  const digitosLid = lid.split('@')[0];
  const url = `${requerido('WAHA_BASE_URL')}/api/${requerido('WAHA_SESION')}/lids/${encodeURIComponent(digitosLid)}`;
  const respuesta = await fetch(url, {
    headers: { 'X-Api-Key': requerido('WAHA_API_KEY') },
    signal: AbortSignal.timeout(4000),
  });
  if (!respuesta.ok) return null;
  const datos = (await respuesta.json()) as { pn?: string };
  const digitos = datos.pn?.split('@')[0]?.replace(/\D/g, '');
  return digitos && digitos.length >= 10 ? `+${digitos}` : null;
}

async function procesarMensaje(telefonoInicial: string | null, lid: string | null, texto: string) {
  const mensajeria = crearProveedorMensajeriaWaha({
    baseUrl: requerido('WAHA_BASE_URL'),
    apiKey: requerido('WAHA_API_KEY'),
    sesion: requerido('WAHA_SESION'),
  });

  const telefono = telefonoInicial ?? (lid ? await resolverLid(lid).catch(() => null) : null);
  if (!telefono) {
    console.error('wa-webhook: no se pudo resolver el remitente', lid ?? '(sin lid)');
    return;
  }

  try {
    const contextos = await rpcServicio<ContextoChat[]>('contexto_chat_whatsapp', { p_telefono: telefono });
    const registrado = Array.isArray(contextos) && contextos.length > 0;
    const intencion = interpretarTexto(texto, registrado);

    if (intencion.accion === 'sin_registrar') {
      await mensajeria.enviarTexto({ telefonoE164: telefono, texto: MENSAJE_SIN_REGISTRAR, senal: AbortSignal.timeout(4000) });
      return;
    }

    const organizacionId = contextos[0].organizacion_id;

    if (intencion.accion === 'ayuda') {
      await mensajeria.enviarTexto({ telefonoE164: telefono, texto: MENSAJE_AYUDA, senal: AbortSignal.timeout(4000) });
      return;
    }

    if (intencion.accion === 'listar_flota') {
      const filas = await rpcServicio<FilaDominio[]>('dominios_de_chat', { p_organizacion_id: organizacionId });
      const dominios = (filas ?? []).map(fila => fila.dominio);
      await mensajeria.enviarTexto({ telefonoE164: telefono, texto: mensajeFlota(dominios), senal: AbortSignal.timeout(4000) });
      return;
    }

    if (intencion.accion === 'deuda_flota') {
      const filas = await rpcServicio<FilaDominio[]>('dominios_de_chat', { p_organizacion_id: organizacionId });
      const dominios = (filas ?? []).map(fila => fila.dominio);
      if (dominios.length === 0) {
        await mensajeria.enviarTexto({ telefonoE164: telefono, texto: mensajeFlotaVacia(), senal: AbortSignal.timeout(4000) });
        return;
      }
      const aProcesar = dominios.slice(0, LIMITE_DEUDA_FLOTA);
      const omitidas = dominios.length - aProcesar.length;
      const demoSinDeuda = Deno.env.get('DEMO_FUENTES_MOCK') === 'true';
      const items = await consultarFlota(aProcesar, { demoSinDeuda });
      const reporte = formatearReporteFlota(items, dominios.length, omitidas);
      await mensajeria.enviarTexto({ telefonoE164: telefono, texto: reporte, senal: AbortSignal.timeout(20000) });
      return;
    }

    if (intencion.accion === 'link_pago') {
      const ultimoDominio = contextos[0].ultimo_dominio;
      const texto = ultimoDominio ? mensajeLinkPago(ultimoDominio) : MENSAJE_SIN_ULTIMO_DOMINIO;
      await mensajeria.enviarTexto({ telefonoE164: telefono, texto, senal: AbortSignal.timeout(4000) });
      return;
    }

    // consultar_dominio: se registra en la flota (guarda tambien "ultimo_dominio"
    // del chat, para que "link de pago" sepa a que patente se refiere) y se
    // consulta a las fuentes en paralelo.
    await rpcServicio('registrar_dominio_chat', {
      p_organizacion_id: organizacionId,
      p_dominio: intencion.dominio,
      p_telefono: telefono,
    });
    const resultado = await consultarVehiculo(intencion.dominio);
    const reporte = formatearReporte(resultado);
    await mensajeria.enviarTexto({ telefonoE164: telefono, texto: reporte, senal: AbortSignal.timeout(10000) });
  } catch (error) {
    console.error('wa-webhook: fallo procesando mensaje', error instanceof Error ? error.message : String(error));
  }
}

async function manejar(peticion: Request): Promise<Response> {
  if (peticion.method !== 'POST') return json({ error: 'metodo_no_admitido' }, 405);

  if (!secretoValido(peticion.headers.get('X-Webhook-Secret'), requerido('WA_WEBHOOK_SECRET'))) {
    return json({ error: 'secreto_invalido' }, 401);
  }

  let evento: EventoWaha;
  try {
    evento = await peticion.json();
  } catch {
    return json({ error: 'cuerpo_invalido' }, 400);
  }

  const clasificado = clasificarEvento(evento);
  if (clasificado.tipo === 'ignorar') return json({ ok: true, ignorado: clasificado.razon }, 200);

  const esNuevo = await rpcServicio<boolean>('marcar_mensaje_procesado', { p_id: clasificado.idMensaje });
  if (!esNuevo) return json({ ok: true, duplicado: true }, 200);

  // @ts-ignore -- EdgeRuntime existe en el runtime de Supabase Edge Functions, no en el tipado de Deno.
  EdgeRuntime.waitUntil(procesarMensaje(clasificado.telefono, clasificado.lid, clasificado.texto));

  return json({ ok: true }, 200);
}

if (import.meta.main) {
  Deno.serve(manejar);
}

export { manejar };
