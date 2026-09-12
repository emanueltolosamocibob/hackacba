// =============================================================================
// Fan-out a las cuatro fuentes en paralelo (SPEC parr. 5, 7). Cada adaptador
// nunca lanza: si algo se rompe, esta capa igual entrega estado "error" para
// esa fuente sin tirar abajo la respuesta completa.
// =============================================================================

import { consultarMuniCordoba, PRESUPUESTO_MUNI_MS } from './muni.ts';
import { consultarPeaje, PRESUPUESTO_PEAJE_MS } from './peaje.ts';
import { rentasCba, itv } from './estaticas.ts';
import { fuenteError, type FuenteResultado } from './tipos.ts';

export interface ResultadoConsulta {
  patente: string;
  consultadoEn: string;
  fuentes: FuenteResultado[];
}

export interface OpcionesConsulta {
  /** Demo en vivo: rentas_cba/itv devuelven "sin deuda" en vez de derivar al portal. */
  demoSinDeuda?: boolean;
}

export async function consultarVehiculo(patente: string, opciones: OpcionesConsulta = {}): Promise<ResultadoConsulta> {
  const demoSinDeuda = opciones.demoSinDeuda ?? (Deno.env.get('DEMO_FUENTES_MOCK') === 'true');

  const [muni, peaje] = await Promise.allSettled([
    consultarMuniCordoba(patente, AbortSignal.timeout(PRESUPUESTO_MUNI_MS)),
    consultarPeaje(patente, AbortSignal.timeout(PRESUPUESTO_PEAJE_MS)),
  ]);

  return {
    patente,
    consultadoEn: new Date().toISOString(),
    fuentes: [
      muni.status === 'fulfilled' ? muni.value : fuenteError('muni_cordoba', 'Municipalidad de Córdoba', 'excepcion'),
      peaje.status === 'fulfilled' ? peaje.value : fuenteError('cdls_peaje', 'Caminos de las Sierras', 'excepcion'),
      rentasCba(demoSinDeuda),
      itv(demoSinDeuda),
    ],
  };
}
