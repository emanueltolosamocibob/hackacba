// =============================================================================
// El facade de la landing sobre `finalizar_alta_landing()` (design-2, "SPA
// and Authorization Flow", paso 6). Exige el bearer del usuario, lo reenvia
// tal cual a traves de un cliente con scope de usuario, y jamas usa
// service_role. Existe solo para el CORS de origen exacto y para traducir
// los errores de la base a algo que la SPA pueda mostrar.
//
// La logica vive en `_compartido/alta/finalizador.ts`, probada sin red.
// =============================================================================

import { manejarFinalizarAltaLanding } from '../_compartido/alta/finalizador.ts';
import { ErrorRpc, rpcComoUsuario } from '../_compartido/alta/supabase.ts';
import { crearProveedorMensajeriaWaha } from '../_compartido/alta/mensajeria/waha.ts';

declare const EdgeRuntime: { waitUntil(tarea: Promise<unknown>): void } | undefined;

function origenesPermitidos(): string[] {
  return (Deno.env.get('LANDING_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

const MENSAJE_BIENVENIDA = [
  '¡Hola! Soy *FlotaBot* 🚗',
  '',
  'Tu número ya quedó verificado. Desde acá te ayudo a ver qué debe cada vehículo de tu flota en Córdoba:',
  '• Municipalidad de Córdoba: tasa automotor y multas',
  '• Caminos de las Sierras: infracciones de peaje',
  '• Rentas Córdoba e ITV: te dejo el acceso oficial',
  '',
  'Para empezar, mandame una patente. Por ejemplo: *AA000AA*',
  'Después podés escribir *link de pago* para pagar, o *flota* para ver tus vehículos.',
].join('\n');

/**
 * El telefono confirmado viaja en el claim `phone` del JWT que PostgREST ya
 * valido; leerlo del payload no requiere verificar la firma de nuevo.
 */
function telefonoDesdeBearer(autorizacion: string | null): string | null {
  const token = autorizacion?.replace(/^Bearer\s+/i, '');
  const partes = token?.split('.') ?? [];
  if (partes.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/'))) as { phone?: string };
    const digitos = payload.phone?.replace(/\D/g, '');
    return digitos && digitos.length >= 10 ? `+${digitos}` : null;
  } catch {
    return null;
  }
}

async function enviarBienvenida(telefonoE164: string): Promise<void> {
  const mensajeria = crearProveedorMensajeriaWaha({
    baseUrl: Deno.env.get('WAHA_BASE_URL') ?? '',
    apiKey: Deno.env.get('WAHA_API_KEY') ?? '',
    sesion: Deno.env.get('WAHA_SESION') ?? '',
  });
  try {
    await mensajeria.enviarTexto({ telefonoE164, texto: MENSAJE_BIENVENIDA, senal: AbortSignal.timeout(10000) });
  } catch (error) {
    // La bienvenida es cortesia: si WAHA no esta, el alta ya quedo hecha igual.
    console.error('finalizar-alta-landing: no se pudo enviar la bienvenida', error instanceof Error ? error.message : String(error));
  }
}

async function manejar(peticion: Request): Promise<Response> {
  const resultado = await manejarFinalizarAltaLanding(
    peticion.method,
    peticion.headers.get('origin'),
    peticion.headers.get('authorization'),
    {
      origenesPermitidos: origenesPermitidos(),
      async llamarFinalizador(bearer) {
        try {
          return await rpcComoUsuario('finalizar_alta_landing', bearer, {});
        } catch (error) {
          if (error instanceof ErrorRpc) {
            throw { estadoHttp: error.estado, detalle: error.detalle };
          }
          throw error;
        }
      },
    },
  );

  // Alta completada: la bienvenida sale por WhatsApp en segundo plano, sin
  // demorar la respuesta a la SPA.
  if (resultado.status === 200) {
    const telefono = telefonoDesdeBearer(peticion.headers.get('authorization'));
    if (telefono && typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(enviarBienvenida(telefono));
    }
  }

  // Un 204 (preflight CORS) no admite cuerpo: Response lanza si se le pasa uno.
  if (resultado.status === 204) {
    return new Response(null, { status: 204, headers: resultado.encabezadosCors });
  }

  return new Response(JSON.stringify(resultado.cuerpo), {
    status: resultado.status,
    headers: { 'Content-Type': 'application/json', ...resultado.encabezadosCors },
  });
}

if (import.meta.main) {
  Deno.serve(manejar);
}

export { manejar };
