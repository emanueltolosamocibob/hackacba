// =============================================================================
// Adaptador muni_cordoba: Portal Tributario municipal, sin captcha ni sesion.
// Ver SPEC parr. 2.1 y 4.1. Verificado en vivo el 12/09/2026 contra AH827BR:
// 200, status.success=true, 5.3s de latencia real -> presupuesto de 9s, no 4s
// (el eco de WAHA ya respondio 200 antes de esto, dentro de waitUntil).
// =============================================================================

import { fuenteError, formatearImporte, type FuenteResultado, type ObligacionNormalizada, type TipoObligacion } from './tipos.ts';

const NOMBRE = 'Municipalidad de Córdoba';
export const PRESUPUESTO_MUNI_MS = 9000;

interface ItemMuni {
  ctacte_id?: number | string;
  anio?: number;
  cuota?: number | string;
  fchvenc?: string;
  saldo?: number | string;
  nominal?: number | string;
  ref?: string;
  referencia?: string;
  causa?: string;
  est?: string;
  infrac?: string;
  infrac_fecha?: string;
  // "nombre" llega en el payload real pero se descarta a proposito (parr. 8).
}

interface RespuestaMuni {
  status: { success: boolean; messages?: string[] };
  data?: {
    deudas?: ItemMuni[];
    multas?: ItemMuni[];
    planes?: ItemMuni[];
    juicios?: ItemMuni[];
  };
}

function estaVencida(fechaIso: string | undefined, esD: boolean): boolean {
  if (!esD || !fechaIso) return false;
  const vencimiento = Date.parse(fechaIso);
  if (Number.isNaN(vencimiento)) return false;
  return vencimiento < Date.now();
}

function normalizarItem(item: ItemMuni, tipo: TipoObligacion): ObligacionNormalizada {
  const esD = item.est === 'D';
  return {
    tipo,
    concepto: item.infrac ?? (tipo === 'impuesto' ? `Impuesto automotor cuota ${item.cuota ?? ''}`.trim() : tipo),
    periodo: item.anio ? `${item.anio}/${String(item.cuota ?? '').padStart(2, '0')}` : null,
    vencimiento: item.fchvenc ?? null,
    importe: formatearImporte(item.saldo ?? item.nominal),
    moneda: 'ARS',
    estado: estaVencida(item.fchvenc, esD) ? 'vencida' : 'a_vencer',
    referencia: item.ref ?? item.referencia ?? item.causa ?? null,
    ...(item.infrac_fecha ? { fechaInfraccion: item.infrac_fecha } : {}),
    origen: { fuente: 'muni_cordoba', idOrigen: String(item.ctacte_id ?? '') },
  };
}

/** Puro: sin red. Recibe el JSON ya parseado y devuelve el resultado normalizado. */
export function normalizarMuni(datos: RespuestaMuni): FuenteResultado {
  const base = { id: 'muni_cordoba' as const, nombre: NOMBRE, consultadoEn: new Date().toISOString(), desdeCache: false };

  if (!datos?.status?.success) {
    return { ...base, estado: 'sin_datos', metodo: 'api', obligaciones: [] };
  }

  const obligaciones: ObligacionNormalizada[] = [
    ...(datos.data?.deudas ?? []).map(item => normalizarItem(item, 'impuesto')),
    ...(datos.data?.multas ?? []).map(item => normalizarItem(item, 'multa')),
    ...(datos.data?.planes ?? []).map(item => normalizarItem(item, 'plan')),
    ...(datos.data?.juicios ?? []).map(item => normalizarItem(item, 'juicio')),
  ];

  return { ...base, estado: 'ok', metodo: 'api', obligaciones };
}

export async function consultarMuniCordoba(patente: string, senal: AbortSignal): Promise<FuenteResultado> {
  try {
    const url = `https://tributariomuni.cordoba.gob.ar/nextapi/proxy/deuda/consultar?tipo=5&tipo_busqueda=2&identificador=${encodeURIComponent(patente)}`;
    const respuesta = await fetch(url, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: senal,
    });
    if (!respuesta.ok) return fuenteError('muni_cordoba', NOMBRE, `http_${respuesta.status}`);
    const datos = (await respuesta.json()) as RespuestaMuni;
    return normalizarMuni(datos);
  } catch {
    return fuenteError('muni_cordoba', NOMBRE, senal.aborted ? 'timeout' : 'excepcion');
  }
}
