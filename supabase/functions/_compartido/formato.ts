// =============================================================================
// Como se ve todo esto en un chat.
//
// Nada de logica: entra un dato de la base, sale texto. Se separa del resto
// para poder cambiar como se lee un vencimiento sin tocar como se consulta.
// =============================================================================

import { escapar } from './telegram.ts';

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

export function importe(monto: number | string | null | undefined, moneda = 'ARS'): string {
  if (monto === null || monto === undefined || monto === '') return 'sin monto';
  const numero = typeof monto === 'string' ? Number(monto) : monto;
  if (Number.isNaN(numero)) return 'sin monto';
  if (moneda !== 'ARS') {
    return `${moneda} ${numero.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }
  return PESOS.format(numero);
}

/** Las fechas de la base vienen AAAA-MM-DD y se muestran como en Argentina. */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [anio, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
}

/**
 * El identificador que se puede tipear en un chat.
 *
 * Un uuid no se tipea, pero sus primeros seis caracteres si, y a diferencia de
 * un indice `#3` este es estable: el mismo vencimiento tiene el mismo codigo en
 * cualquier listado y manana tambien. Seis caracteres hex son 16 millones de
 * combinaciones; para los cientos de vencimientos de una flota, la chance de
 * choque es despreciable, y cuando pasa se pide el codigo mas largo.
 */
export const codigoCorto = (uuid: string): string =>
  uuid.replace(/-/g, '').slice(0, 6).toUpperCase();

export function diasLegible(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence manana';
  if (dias > 1) return `en ${dias} dias`;
  if (dias === -1) return 'vencio ayer';
  return `vencido hace ${Math.abs(dias)} dias`;
}

const ETIQUETAS: Record<string, string> = {
  pendiente: 'pendiente',
  parcial: 'pago parcial',
  vencido: 'VENCIDO',
  pagado: 'pagado',
  condonado: 'condonado',
  anulado: 'anulado',
};

export const estado = (valor: string): string => ETIQUETAS[valor] ?? valor;

export interface FilaVencimiento {
  id: string;
  dominio: string;
  tipo_nombre?: string;
  tipo?: string;
  periodo: string;
  fecha_vencimiento: string;
  monto_vigente?: number | string | null;
  monto?: number | string | null;
  moneda?: string;
  estado_efectivo: string;
  dias_para_vencer?: number | null;
}

/** Una linea por vencimiento, con el codigo adelante para poder referenciarlo. */
export function lineaVencimiento(v: FilaVencimiento): string {
  const tipo = v.tipo_nombre ?? v.tipo ?? 'obligacion';
  const monto = importe(v.monto_vigente ?? v.monto, v.moneda ?? 'ARS');
  const dias = diasLegible(v.dias_para_vencer);
  const cola = dias ? ` - ${dias}` : '';
  return (
    `<code>${codigoCorto(v.id)}</code> <b>${escapar(v.dominio)}</b> ${escapar(tipo)} ${escapar(v.periodo)}\n` +
    `      ${monto} - ${fecha(v.fecha_vencimiento)} - ${estado(v.estado_efectivo)}${cola}`
  );
}

export function listaVencimientos(filas: FilaVencimiento[], vacio = 'No hay nada.'): string {
  if (filas.length === 0) return vacio;
  return filas.map(lineaVencimiento).join('\n');
}

/**
 * Telegram corta los mensajes en 4096 caracteres. Cortar por lineas y no por
 * caracteres evita partir una etiqueta HTML al medio, que rompe el parseo del
 * mensaje entero.
 */
export function partir(texto: string, maximo = 3800): string[] {
  if (texto.length <= maximo) return [texto];

  const partes: string[] = [];
  let actual = '';
  for (const linea of texto.split('\n')) {
    if (actual.length + linea.length + 1 > maximo) {
      partes.push(actual);
      actual = '';
    }
    actual += (actual ? '\n' : '') + linea;
  }
  if (actual) partes.push(actual);
  return partes;
}
