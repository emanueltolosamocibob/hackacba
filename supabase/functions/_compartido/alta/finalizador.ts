// =============================================================================
// La logica del facade de la landing sobre `finalizar_alta_landing()`
// (design-2, "SPA and Authorization Flow", paso 6). Separada del `index.ts`
// de la Edge Function para poder probarla sin levantar un servidor: recibe
// el metodo/origen/autorizacion ya extraidos y una dependencia inyectada
// para llamar al RPC.
//
// Reglas que no son negociables aca: el origen se valida ANTES que cualquier
// otra cosa, y el bearer del usuario se reenvia tal cual, nunca se cambia por
// service_role.
// =============================================================================

import { evaluarCors } from './cors.ts';

export interface ErrorFinalizador {
  estadoHttp?: number;
  detalle?: string;
}

export interface DependenciasFinalizador {
  origenesPermitidos: string[];
  /** Debe reenviar `bearer` tal cual al RPC `finalizar_alta_landing()`. */
  llamarFinalizador(bearer: string): Promise<Record<string, unknown>>;
}

export interface ResultadoFinalizador {
  status: number;
  cuerpo: Record<string, unknown>;
  encabezadosCors: Record<string, string>;
}

const MAPA_ERRORES: Record<string, { status: number; error: string }> = {
  alta_no_autenticada: { status: 401, error: 'sesion_invalida' },
  telefono_no_verificado: { status: 422, error: 'telefono_no_verificado' },
  telefono_argentino_invalido: { status: 422, error: 'telefono_argentino_invalido' },
  identidad_en_uso: { status: 409, error: 'identidad_en_uso' },
  invitacion_no_disponible: { status: 422, error: 'invitacion_no_disponible' },
};

export async function manejarFinalizarAltaLanding(
  metodo: string,
  origen: string | null,
  autorizacion: string | null,
  deps: DependenciasFinalizador,
): Promise<ResultadoFinalizador> {
  const cors = evaluarCors(origen, deps.origenesPermitidos);

  if (metodo === 'OPTIONS') {
    return { status: cors.permitido ? 204 : 403, cuerpo: {}, encabezadosCors: cors.encabezados };
  }

  if (!cors.permitido) {
    return { status: 403, cuerpo: { error: 'origen_no_permitido' }, encabezadosCors: cors.encabezados };
  }

  if (metodo !== 'POST') {
    return { status: 405, cuerpo: { error: 'metodo_no_admitido' }, encabezadosCors: cors.encabezados };
  }

  if (!autorizacion?.startsWith('Bearer ')) {
    return { status: 401, cuerpo: { error: 'sesion_invalida' }, encabezadosCors: cors.encabezados };
  }
  const bearer = autorizacion.slice('Bearer '.length).trim();
  if (!bearer) {
    return { status: 401, cuerpo: { error: 'sesion_invalida' }, encabezadosCors: cors.encabezados };
  }

  try {
    const resultado = await deps.llamarFinalizador(bearer);
    return { status: 200, cuerpo: resultado, encabezadosCors: cors.encabezados };
  } catch (error) {
    const e = error as ErrorFinalizador;

    if (e.estadoHttp === 401 || e.estadoHttp === 403) {
      return { status: 401, cuerpo: { error: 'sesion_invalida' }, encabezadosCors: cors.encabezados };
    }

    const mapeado = e.detalle ? MAPA_ERRORES[e.detalle] : undefined;
    if (mapeado) {
      return { status: mapeado.status, cuerpo: { error: mapeado.error }, encabezadosCors: cors.encabezados };
    }

    return { status: 500, cuerpo: { error: 'error_interno' }, encabezadosCors: cors.encabezados };
  }
}
