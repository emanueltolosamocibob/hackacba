// =============================================================================
// Adaptador cdls_peaje: Caminos de las Sierras, WordPress sin API.
// SPEC parr. 2.2 y 4.2. Solo el nivel 1 (caso vacio) esta implementado: el
// markup del caso con infracciones es desconocido (hueco documentado). Ante
// cualquier otra forma de HTML, la fuente vuelve "requiere_usuario" en vez de
// inventar un parser o arriesgar un falso "sin infracciones". Nivel 3 (LLM)
// queda fuera de esta version.
// =============================================================================

import { fuenteError, type FuenteResultado } from './tipos.ts';

const NOMBRE = 'Caminos de las Sierras';
const URL_CONSULTA = 'https://caminosdelassierras.com.ar/autogestion/infracciones/';
export const PRESUPUESTO_PEAJE_MS = 4000;

/** Puro: sin red. Recibe el HTML de respuesta y decide el estado. */
export function normalizarPeaje(html: string): FuenteResultado {
  const base = { id: 'cdls_peaje' as const, nombre: NOMBRE, consultadoEn: new Date().toISOString(), desdeCache: false };

  if (html.toLowerCase().includes('no posee infracciones impagas')) {
    return { ...base, estado: 'ok', metodo: 'parser', obligaciones: [] };
  }

  // Markup con resultados: desconocido a esta fecha. No se arriesga un parser
  // a ciegas ni un LLM sin fixture real; se deriva a la persona.
  return {
    ...base,
    estado: 'requiere_usuario',
    metodo: 'parser',
    motivo: 'markup_desconocido',
    url: URL_CONSULTA,
    obligaciones: [],
  };
}

export async function consultarPeaje(patente: string, senal: AbortSignal): Promise<FuenteResultado> {
  try {
    const respuesta = await fetch(URL_CONSULTA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `dominio=${encodeURIComponent(patente)}&buscar-infracciones=`,
      signal: senal,
    });
    if (!respuesta.ok) return fuenteError('cdls_peaje', NOMBRE, `http_${respuesta.status}`);
    const html = await respuesta.text();
    return normalizarPeaje(html);
  } catch {
    return fuenteError('cdls_peaje', NOMBRE, senal.aborted ? 'timeout' : 'excepcion');
  }
}
