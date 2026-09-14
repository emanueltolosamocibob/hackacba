// =============================================================================
// Contrato normalizado de las fuentes de deuda vehicular de Cordoba.
// Ver /Users/nataliorover/Downloads/SPEC-bot-consulta-vehicular.md (parr. 3).
// El campo "nombre" del titular NUNCA entra a este esquema (parr. 8).
// =============================================================================

export type TipoObligacion = 'impuesto' | 'multa' | 'peaje' | 'plan' | 'juicio';
export type EstadoObligacion = 'vencida' | 'a_vencer' | 'en_juicio' | 'en_plan';
export type EstadoFuente = 'ok' | 'sin_datos' | 'error' | 'requiere_usuario';

export interface ObligacionNormalizada {
  tipo: TipoObligacion;
  concepto: string;
  periodo: string | null;
  vencimiento: string | null;
  importe: string;
  moneda: 'ARS';
  estado: EstadoObligacion;
  referencia: string | null;
  fechaInfraccion?: string;
  /**
   * El "Descuento" que informa la Muni, solo cuando es > 0.
   *
   * NO esta restado de `importe`, y no se sabe desde afuera como se obtiene.
   * El propio portal lo muestra como una columna aparte y su checkout cobra el
   * saldo entero: `totalGeneral += parseFloat(item.saldo)`, sin restar nada.
   * Por eso viaja como dato suelto y el mensaje no promete ningun ahorro.
   */
  descuento?: string;
  origen: { fuente: string; idOrigen: string };
}

export interface FuenteResultado {
  id: 'muni_cordoba' | 'cdls_peaje' | 'rentas_cba' | 'itv';
  nombre: string;
  estado: EstadoFuente;
  metodo?: 'api' | 'parser' | 'modelo' | 'estatico';
  motivo?: string;
  url?: string;
  cubre?: string[];
  consultadoEn: string;
  desdeCache: boolean;
  obligaciones: ObligacionNormalizada[];
}

export function fuenteError(
  id: FuenteResultado['id'],
  nombre: string,
  motivo: string,
): FuenteResultado {
  return {
    id,
    nombre,
    estado: 'error',
    motivo,
    consultadoEn: new Date().toISOString(),
    desdeCache: false,
    obligaciones: [],
  };
}

/** dos decimales, nunca float en el texto de salida (parr. 3 "reglas de normalizacion"). */
export function formatearImporte(valor: number | string | null | undefined): string {
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  if (numero === null || numero === undefined || Number.isNaN(numero)) return '0.00';
  return numero.toFixed(2);
}
