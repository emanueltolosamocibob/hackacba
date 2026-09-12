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

export interface ResultadoFlotaItem {
  dominio: string;
  resultado: ResultadoConsulta;
}

/** Reemplazo defensivo cuando una consulta de flota revienta por completo: las
 * cuatro fuentes quedan en "error" en vez de tirar abajo el resto de la flota. */
function resultadoDeExcepcion(dominio: string): ResultadoConsulta {
  return {
    patente: dominio,
    consultadoEn: new Date().toISOString(),
    fuentes: [
      fuenteError('muni_cordoba', 'Municipalidad de Córdoba', 'excepcion'),
      fuenteError('cdls_peaje', 'Caminos de las Sierras', 'excepcion'),
      fuenteError('rentas_cba', 'Rentas Córdoba', 'excepcion'),
      fuenteError('itv', 'ITV Córdoba', 'excepcion'),
    ],
  };
}

const CONCURRENCIA_FLOTA = 3;

/**
 * Consulta varias patentes con un limite de concurrencia (parr. "Ser buen
 * ciudadano"): no dispara N*4 pedidos en paralelo sin control. Cada patente
 * nunca lanza -- una que revienta no aborta el resto de la flota.
 */
export async function consultarFlota(dominios: string[], opciones: OpcionesConsulta = {}): Promise<ResultadoFlotaItem[]> {
  const resultados: ResultadoFlotaItem[] = new Array(dominios.length);
  let siguiente = 0;

  async function trabajador() {
    while (siguiente < dominios.length) {
      const indice = siguiente++;
      const dominio = dominios[indice];
      try {
        resultados[indice] = { dominio, resultado: await consultarVehiculo(dominio, opciones) };
      } catch {
        resultados[indice] = { dominio, resultado: resultadoDeExcepcion(dominio) };
      }
    }
  }

  const trabajadores = Array.from({ length: Math.min(CONCURRENCIA_FLOTA, dominios.length) }, trabajador);
  await Promise.all(trabajadores);
  return resultados;
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
