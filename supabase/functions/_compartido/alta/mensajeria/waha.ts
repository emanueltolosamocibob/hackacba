// =============================================================================
// Adaptador de WAHA: implementa ProveedorMensajeria contra la API real y
// expone un ProveedorOtp para el hook de Send SMS.
//
// Un solo numero de operador atiende OTP y bot (design-2, "WAHA Operations
// and Degraded Behavior"). Si la sesion esta caida, WAHA devuelve un estado
// no-WORKING o el POST falla: en ambos casos esto es "no_disponible", nunca
// se inventa un envio exitoso.
// =============================================================================

import { telefonoParaWaha } from '../telefono.ts';
import type { ProveedorMensajeria } from './proveedor.ts';
import type { ProveedorOtp } from '../proveedor-otp.ts';

export interface ConfigWaha {
  baseUrl: string;
  apiKey: string;
  sesion: string;
}

function textoOtp(codigo: string): string {
  return `Tu codigo para verificar tu numero en FlotaBot es ${codigo}. Vence en pocos minutos, no lo compartas.`;
}

export function crearProveedorMensajeriaWaha(config: ConfigWaha): ProveedorMensajeria {
  const base = config.baseUrl.replace(/\/$/, '');

  return {
    async enviarTexto({ telefonoE164, texto, senal }) {
      const chatId = telefonoParaWaha(telefonoE164);
      if (!chatId) return { ok: false, reintentable: false };

      try {
        const respuesta = await fetch(`${base}/api/sendText`, {
          method: 'POST',
          headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: config.sesion, chatId: `${chatId}@c.us`, text: texto }),
          signal: senal,
        });

        if (respuesta.status === 429) return { ok: false, reintentable: true };
        if (!respuesta.ok) return { ok: false, reintentable: true };

        const datos = await respuesta.json().catch(() => null) as { id?: string } | null;
        return { ok: true, idExterno: datos?.id };
      } catch {
        return { ok: false, reintentable: true };
      }
    },

    async estadoSesion(senal) {
      try {
        const respuesta = await fetch(`${base}/api/sessions/${config.sesion}`, {
          headers: { 'X-Api-Key': config.apiKey },
          signal: senal,
        });
        if (!respuesta.ok) return 'desconectado';
        const datos = await respuesta.json() as { status?: string };
        return datos.status === 'WORKING' ? 'conectado' : 'degradado';
      } catch {
        return 'desconectado';
      }
    },
  };
}

/** El mismo adaptador, visto como ProveedorOtp para el hook de Send SMS. */
export function crearProveedorOtpWaha(config: ConfigWaha): ProveedorOtp {
  const mensajeria = crearProveedorMensajeriaWaha(config);

  return {
    async enviar({ telefonoE164, codigo, idempotencia, senal }) {
      const resultado = await mensajeria.enviarTexto({ telefonoE164, texto: textoOtp(codigo), senal });
      if (resultado.ok) return { estado: 'enviado', idExterno: resultado.idExterno ?? idempotencia };
      if (senal.aborted) return { estado: 'timeout', reintentable: true };
      return { estado: 'no_disponible', reintentable: resultado.reintentable };
    },

    async estado(senal) {
      return await mensajeria.estadoSesion(senal);
    },
  };
}
