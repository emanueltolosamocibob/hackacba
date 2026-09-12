// =============================================================================
// El Auth Send SMS Hook: Supabase Auth lo llama para entregar el OTP del alta
// por WhatsApp de la landing (design-2, "SPA and Authorization Flow" y
// "Current Supabase Send SMS Hook Contract").
//
// No lleva JWT de Supabase: Auth firma el pedido con Standard Webhooks
// (`SEND_SMS_HOOK_SECRET`), no con un token de la plataforma. Por eso
// `verify_jwt = false` en config.toml, igual que el webhook de Telegram
// (ver el comentario ahi): con verify_jwt en true, ningun hook llegaria al
// codigo. Lo que protege esta URL es la firma que verifica `manejarHookSms`.
//
// La logica de negocio (verificar, reservar, mandar, cerrar) vive en
// `_compartido/alta/hook-sms.ts`, con las dependencias inyectadas aca. Eso es
// lo que permite probarla sin red ni Deno.serve.
// =============================================================================

import { manejarHookSms } from '../_compartido/alta/hook-sms.ts';
import { rpcServicio } from '../_compartido/alta/supabase.ts';
import { crearProveedorOtpWaha } from '../_compartido/alta/mensajeria/waha.ts';

const PRESUPUESTO_MS = 8000;

function requerido(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) {
    throw new Error(`Falta el secreto ${nombre}. Definirlo con: supabase secrets set ${nombre}=...`);
  }
  return valor;
}

function json(cuerpo: Record<string, unknown>, status: number, encabezados: Record<string, string> = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...encabezados },
  });
}

async function manejar(peticion: Request): Promise<Response> {
  if (peticion.method !== 'POST') {
    return json({ error: 'metodo_no_admitido' }, 405);
  }

  const cuerpoCrudo = await peticion.text();
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), PRESUPUESTO_MS);

  try {
    const proveedor = crearProveedorOtpWaha({
      baseUrl: requerido('WAHA_BASE_URL'),
      apiKey: requerido('WAHA_API_KEY'),
      sesion: requerido('WAHA_SESION'),
    });

    const resultado = await manejarHookSms(cuerpoCrudo, peticion.headers, {
      secreto: requerido('SEND_SMS_HOOK_SECRET'),
      proveedor,
      senal: controlador.signal,
      async reservar(idEntrega, telefonoE164) {
        return await rpcServicio('reservar_entrega_otp', {
          p_id_entrega: idEntrega,
          p_telefono_e164: telefonoE164,
        });
      },
      async cerrar(idEntrega, estado, idProveedor, codigoError) {
        await rpcServicio('cerrar_entrega_otp', {
          p_id_entrega: idEntrega,
          p_estado: estado,
          p_id_proveedor: idProveedor ?? null,
          p_error_codigo: codigoError ?? null,
        });
      },
    });

    return json(resultado.cuerpo, resultado.status, resultado.encabezados ?? {});
  } catch (error) {
    // Nunca se loguea `cuerpoCrudo` ni el payload parseado: podrian llevar el OTP.
    console.error('enviar-otp-whatsapp: fallo inesperado', error instanceof Error ? error.message : String(error));
    return json({ error: 'error_interno' }, 500);
  } finally {
    clearTimeout(limite);
  }
}

if (import.meta.main) {
  Deno.serve(manejar);
}

export { manejar };
