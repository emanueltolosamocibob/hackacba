// =============================================================================
// Formato de respuesta de WhatsApp: negrita simple, sin tablas, sin markdown
// pesado (SPEC parr. 9-10). Nunca suma un total: cada fuente se informa por
// separado y su estado queda explicito, tal como piden los criterios de
// aceptacion (parr. 12).
// =============================================================================

import type { FuenteResultado, ObligacionNormalizada } from './fuentes/tipos.ts';
import type { ResultadoConsulta, ResultadoFlotaItem } from './fuentes/consulta.ts';

function pesosArgentinos(importe: string): string {
  const [entero, decimales] = importe.split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${conMiles},${decimales ?? '00'}`;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return 'sin fecha';
  const [anio, mes, dia] = iso.split('-');
  if (!anio || !mes || !dia) return iso;
  return `${dia}/${mes}/${anio}`;
}

function bullet(o: ObligacionNormalizada): string {
  const fecha = fechaCorta(o.vencimiento ?? o.fechaInfraccion);
  const periodo = o.periodo ? ` (${o.periodo})` : '';
  const ref = o.referencia ? `${o.referencia} — ` : '';
  return `• ${ref}${o.concepto}${periodo} — vence ${fecha} — ${pesosArgentinos(o.importe)}`;
}

function totalObligaciones(obligaciones: ObligacionNormalizada[]): string {
  const suma = obligaciones.reduce((acc, o) => acc + Number(o.importe), 0);
  return pesosArgentinos(suma.toFixed(2));
}

function bloqueMuni(f: FuenteResultado): string {
  if (f.estado === 'error') {
    return `*${f.nombre}*\nNo pudimos consultar el portal municipal ahora (${f.motivo ?? 'error'}). Probá de nuevo en unos minutos.`;
  }
  if (f.estado === 'sin_datos') {
    return `*${f.nombre}*\nNo encontramos datos para esta patente en el portal municipal.`;
  }
  if (f.obligaciones.length === 0) {
    return `*${f.nombre}*\nSin deudas ni multas registradas.`;
  }
  const ordenadas = [...f.obligaciones].sort((a, b) => Number(b.importe) - Number(a.importe));
  const top3 = ordenadas.slice(0, 3);
  const lineas = [
    `${f.obligaciones.length} obligaciones encontradas, total ${totalObligaciones(f.obligaciones)}.`,
    top3.length > 1 ? 'Las más importantes:' : 'Detalle:',
    ...top3.map(bullet),
  ];
  return `*${f.nombre}*\n${lineas.join('\n')}`;
}

function bloquePeaje(f: FuenteResultado, patente: string): string {
  if (f.estado === 'error') {
    return `*${f.nombre}*\nNo pudimos consultar peajes ahora. Probá de nuevo en unos minutos.`;
  }
  if (f.estado === 'requiere_usuario') {
    return `*${f.nombre}*\nEsta consulta la tenés que hacer vos, el sitio no nos dejó confirmarla automáticamente.\n${f.url}\nPatente: ${patente}`;
  }
  return `*${f.nombre}*\nSin infracciones de peaje.`;
}

function bloqueEstatica(f: FuenteResultado, patente: string): string {
  const cubre = f.cubre ? ` (${f.cubre.join(' y ')})` : '';
  if (f.estado === 'ok') {
    const etiqueta = f.id === 'rentas_cba' ? 'sin deuda' : 'al día';
    return `✅ *${f.nombre}*${cubre}: ${etiqueta}\nVer en el portal: ${f.url}`;
  }
  return `*${f.nombre}*${cubre}\nEsta consulta la tenés que hacer vos, el sitio pide validación.\n${f.url}\nPatente: ${patente}`;
}

export function formatearReporte(resultado: ResultadoConsulta): string {
  const bloques = resultado.fuentes.map(f => {
    if (f.id === 'muni_cordoba') return bloqueMuni(f);
    if (f.id === 'cdls_peaje') return bloquePeaje(f, resultado.patente);
    return bloqueEstatica(f, resultado.patente);
  });

  const fecha = new Date(resultado.consultadoEn);
  const dd = String(fecha.getUTCDate()).padStart(2, '0');
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getUTCHours()).padStart(2, '0');
  const min = String(fecha.getUTCMinutes()).padStart(2, '0');

  return [
    `Encontré esto para ${resultado.patente} 👇`,
    '',
    ...bloques.flatMap(b => [b, '']),
    'Los montos incluyen recargos y cambian con el tiempo; el importe final es el del portal.',
    `Datos al ${dd}/${mm} ${hh}:${min}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reporte consolidado de flota (intencion "deuda_flota"): un mensaje con
// todos los vehiculos que tienen deuda, y al final la lista de los que no.
// ---------------------------------------------------------------------------

function bulletCorto(o: ObligacionNormalizada): string {
  const fecha = fechaCorta(o.vencimiento ?? o.fechaInfraccion);
  return `• ${o.concepto} — vence ${fecha} — ${pesosArgentinos(o.importe)}`;
}

/** null si esa fuente no aporta nada al reporte de flota (sin deuda, sin error). */
function bloqueFuenteFlota(f: FuenteResultado): string | null {
  if (f.estado === 'error') return `*${f.nombre}*: no disponible`;
  if (f.obligaciones.length === 0) return null;
  const top2 = [...f.obligaciones].sort((a, b) => Number(b.importe) - Number(a.importe)).slice(0, 2);
  const etiqueta = f.obligaciones.length === 1 ? 'obligación' : 'obligaciones';
  return [
    `*${f.nombre}*: ${f.obligaciones.length} ${etiqueta}, total ${totalObligaciones(f.obligaciones)}`,
    ...top2.map(bulletCorto),
  ].join('\n');
}

export function formatearReporteFlota(items: ResultadoFlotaItem[], totalFlota: number, omitidas: number): string {
  const conDeuda: string[] = [];
  const sinDeuda: string[] = [];

  for (const item of items) {
    const tieneDeuda = item.resultado.fuentes.some(f => f.obligaciones.length > 0);
    if (!tieneDeuda) {
      sinDeuda.push(item.dominio);
      continue;
    }
    const bloquesFuente = item.resultado.fuentes
      .map(bloqueFuenteFlota)
      .filter((b): b is string => b !== null);
    conDeuda.push([`*${item.dominio}*`, ...bloquesFuente].join('\n'));
  }

  const lineas = [`Deudas de tu flota (${totalFlota} vehículos)`, ''];

  if (conDeuda.length > 0) {
    lineas.push(...conDeuda.flatMap(b => [b, '']));
  } else {
    lineas.push('No encontramos deuda en los vehículos consultados.', '');
  }

  if (sinDeuda.length > 0) {
    lineas.push(`Sin deuda: ${sinDeuda.join(', ')}`);
  }

  if (omitidas > 0) {
    lineas.push(`Quedaron ${omitidas} vehículo${omitidas === 1 ? '' : 's'} sin consultar en este mensaje; pedime la patente puntual si la necesitás.`);
  }

  return lineas.join('\n').trim();
}
