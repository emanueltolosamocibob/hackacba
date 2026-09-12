// =============================================================================
// La superficie de la API, envuelta.
//
// Envoltorios finos y nada mas: validar la entrada, llamar, devolver. Toda
// decision de negocio ya la tomo Postgres (BOT.md, seccion 1), y si aparece una
// regla nueva va en una migracion, no aca.
//
// Todo pasa por `sesion.cliente`, que lleva el JWT de la persona. Ninguna de
// estas funciones acepta el cliente de service_role, y es a proposito.
// =============================================================================

import type { Sesion } from './sesion.ts';
import { ErrorApi } from './rest.ts';
import type { FilaVencimiento } from './formato.ts';

const COLUMNAS_VENCIMIENTO =
  'id,dominio,vehiculo_id,tipo_codigo,tipo_nombre,periodo,fecha_vencimiento,' +
  'monto_vigente,moneda,estado_efectivo,dias_para_vencer,numero_boleta';

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Flota {
  id: string;
  nombre: string;
  activa: boolean;
}

export interface Vehiculo {
  id: string;
  dominio: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  estado: string;
  flota_id: string;
}

export interface ResumenFlota {
  flota_id: string;
  total_vehiculos: number;
  vehiculos_activos: number;
  cantidad_pendientes: number;
  cantidad_vencidos: number;
  monto_vencido: number;
  monto_por_vencer_30d: number;
  proximo_vencimiento: string | null;
  flotas?: { nombre: string };
}

// --------------------------------------------------------------- lecturas

export const listarFlotas = (s: Sesion) =>
  s.cliente.rest<Flota[]>('/flotas?select=id,nombre,activa&order=nombre');

/** El panel de todas las flotas de una sola consulta. */
export const resumenDeFlotas = (s: Sesion) =>
  s.cliente.rest<ResumenFlota[]>(
    '/resumenes_flota?select=*,flotas(nombre)&order=flotas(nombre)',
  );

export const resumenFlota = (s: Sesion, flotaId: string) =>
  s.cliente.rpc<unknown>('resumen_flota', { p_flota_id: flotaId });

export const detalleVehiculo = (s: Sesion, vehiculoId: string) =>
  s.cliente.rpc<unknown>('detalle_vehiculo', { p_vehiculo_id: vehiculoId });

export const linkDePago = (s: Sesion, vencimientoId: string) =>
  s.cliente.rpc<Record<string, unknown>>('link_de_pago', { p_vencimiento_id: vencimientoId });

export const reporteGastos = (
  s: Sesion,
  desde: string,
  hasta: string,
  agruparPor: 'tipo' | 'vehiculo' | 'flota' | 'mes' = 'tipo',
) =>
  s.cliente.rpc<{ clave: string; etiqueta: string; cantidad: number; monto: number }[]>(
    'reporte_gastos',
    {
      p_organizacion_id: s.organizacion.id,
      p_desde: desde,
      p_hasta: hasta,
      p_agrupar_por: agruparPor,
    },
  );

export function buscarVehiculos(s: Sesion, texto: string) {
  // El `*` de PostgREST es el comodin de ilike. Se limpia la entrada porque una
  // coma o un parentesis rompen la sintaxis del parametro `or`.
  const limpio = texto.replace(/[(),*"]/g, '').trim();
  if (!limpio) return Promise.resolve<Vehiculo[]>([]);
  const patron = `*${limpio}*`;
  return s.cliente.rest<Vehiculo[]>(
    `/vehiculos?select=id,dominio,marca,modelo,anio,estado,flota_id` +
      `&or=(dominio.ilike.${patron},marca.ilike.${patron},modelo.ilike.${patron})` +
      `&order=dominio&limit=20`,
  );
}

export interface FiltroVencimientos {
  dominio?: string;
  flotaId?: string;
  tipoCodigo?: string;
  estados?: string[];
  hastaDias?: number;
  desde?: string;
  hasta?: string;
  limite?: number;
}

export function listarVencimientos(s: Sesion, filtro: FiltroVencimientos = {}) {
  const partes = [`select=${COLUMNAS_VENCIMIENTO}`, 'order=fecha_vencimiento'];

  const estados = filtro.estados ?? ['pendiente', 'parcial', 'vencido'];
  partes.push(`estado_efectivo=in.(${estados.join(',')})`);

  if (filtro.dominio) {
    partes.push(`dominio=eq.${encodeURIComponent(filtro.dominio.toUpperCase())}`);
  }
  if (filtro.flotaId) partes.push(`flota_id=eq.${filtro.flotaId}`);
  if (filtro.tipoCodigo) partes.push(`tipo_codigo=eq.${encodeURIComponent(filtro.tipoCodigo)}`);
  if (filtro.hastaDias !== undefined) partes.push(`dias_para_vencer=lte.${filtro.hastaDias}`);
  if (filtro.desde) partes.push(`fecha_vencimiento=gte.${filtro.desde}`);
  if (filtro.hasta) partes.push(`fecha_vencimiento=lte.${filtro.hasta}`);

  partes.push(`limit=${Math.min(filtro.limite ?? 30, 100)}`);

  // Sin filtro de organizacion: RLS ya lo hace, y agregarlo aca daria la falsa
  // impresion de que es el filtro lo que protege.
  return s.cliente.rest<FilaVencimiento[]>(`/v_vencimientos_estado?${partes.join('&')}`);
}

// --------------------------------------------------------- resolver un codigo

/**
 * De lo que la persona escribio al vencimiento.
 *
 * Acepta el uuid completo (el que viaja en los botones) o el codigo corto de
 * seis caracteres que se muestra en los listados. Para el corto hay que barrer,
 * porque PostgREST no sabe filtrar un uuid por prefijo; se piden solo los ids,
 * que son chicos, y se empieza por lo impago, que es de lo que se habla.
 */
export async function resolverVencimiento(
  s: Sesion,
  referencia: string,
): Promise<FilaVencimiento> {
  const limpio = referencia.trim().replace(/^#/, '');

  if (ES_UUID.test(limpio)) {
    const filas = await s.cliente.rest<FilaVencimiento[]>(
      `/v_vencimientos_estado?select=${COLUMNAS_VENCIMIENTO}&id=eq.${limpio}`,
    );
    if (filas.length === 0) throw new ErrorApi(404, 'No encontre ese vencimiento.');
    return filas[0];
  }

  const codigo = limpio.toLowerCase();
  if (!/^[0-9a-f]{4,32}$/.test(codigo)) {
    throw new ErrorApi(400, `"${referencia}" no parece un codigo de vencimiento.`);
  }

  const barridos = [
    `/v_vencimientos_estado?select=id&estado_efectivo=in.(pendiente,parcial,vencido)&order=fecha_vencimiento&limit=1000`,
    `/v_vencimientos_estado?select=id&order=fecha_vencimiento.desc&limit=1000`,
  ];

  for (const consulta of barridos) {
    const ids = await s.cliente.rest<{ id: string }[]>(consulta);
    const coinciden = ids.filter(f => f.id.replace(/-/g, '').startsWith(codigo));

    if (coinciden.length === 1) return resolverVencimiento(s, coinciden[0].id);
    if (coinciden.length > 1) {
      throw new ErrorApi(
        400,
        `Hay ${coinciden.length} vencimientos que empiezan con ${limpio.toUpperCase()}. Pasame algunos caracteres mas.`,
      );
    }
  }

  throw new ErrorApi(404, `No encontre ningun vencimiento con el codigo ${limpio.toUpperCase()}.`);
}

export async function resolverVehiculo(s: Sesion, dominio: string): Promise<Vehiculo> {
  const normalizado = dominio.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const filas = await s.cliente.rest<Vehiculo[]>(
    `/vehiculos?select=id,dominio,marca,modelo,anio,estado,flota_id&dominio=eq.${normalizado}`,
  );
  if (filas.length === 0) throw new ErrorApi(404, `No tengo ningun vehiculo con dominio ${normalizado}.`);
  return filas[0];
}

export async function resolverFlota(s: Sesion, nombre: string): Promise<Flota> {
  const flotas = await listarFlotas(s);
  const buscado = nombre.trim().toLowerCase();

  const exacta = flotas.find(f => f.nombre.toLowerCase() === buscado);
  if (exacta) return exacta;

  const parciales = flotas.filter(f => f.nombre.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0];
  if (parciales.length > 1) {
    throw new ErrorApi(400, `Hay varias flotas que dicen "${nombre}": ${parciales.map(f => f.nombre).join(', ')}.`);
  }
  throw new ErrorApi(404, `No encontre la flota "${nombre}". Tenes: ${flotas.map(f => f.nombre).join(', ')}.`);
}

// -------------------------------------------------------------- escrituras

export interface DatosPago {
  vencimiento_id: string;
  monto: number;
  fecha_pago?: string;
  medio_pago?: string;
  referencia?: string;
  notas?: string;
}

export function registrarPago(s: Sesion, datos: DatosPago) {
  return s.cliente.rest<{ id: string }[]>('/pagos', {
    metodo: 'POST',
    prefer: 'return=representation',
    cuerpo: {
      organizacion_id: s.organizacion.id,
      vencimiento_id: datos.vencimiento_id,
      monto: datos.monto,
      fecha_pago: datos.fecha_pago,
      medio_pago: datos.medio_pago ?? 'transferencia',
      referencia: datos.referencia,
      notas: datos.notas,
      registrado_por: s.usuarioId,
    },
  });
}

export function anularPago(s: Sesion, pagoId: string, motivo: string) {
  return s.cliente.rest<{ id: string }[]>(`/pagos?id=eq.${pagoId}`, {
    metodo: 'PATCH',
    prefer: 'return=representation',
    cuerpo: { anulado: true, motivo_anulacion: motivo },
  });
}

export interface DatosVencimiento {
  vehiculo_id: string;
  tipo_obligacion_id: string;
  periodo: string;
  fecha_vencimiento: string;
  monto_estimado?: number;
  numero_boleta?: string;
  notas?: string;
}

export function cargarVencimiento(s: Sesion, datos: DatosVencimiento) {
  return s.cliente.rest<{ id: string }[]>('/vencimientos', {
    metodo: 'POST',
    prefer: 'return=representation',
    cuerpo: { organizacion_id: s.organizacion.id, ...datos },
  });
}

export interface DatosRegla {
  vehiculo_id: string;
  tipo_obligacion_id: string;
  frecuencia: string;
  dia_vencimiento: number;
  mes_inicio?: number;
  meses_cuotas?: number[];
  monto_estimado?: number;
  vigente_desde?: string;
  notas?: string;
}

export async function crearRegla(s: Sesion, datos: DatosRegla) {
  const creadas = await s.cliente.rest<{ id: string }[]>('/reglas_vencimiento', {
    metodo: 'POST',
    prefer: 'return=representation',
    cuerpo: { organizacion_id: s.organizacion.id, ...datos },
  });

  // Una regla sin cuotas generadas no avisa de nada: el motor se corre ya, no
  // en la tarea de manana.
  const cuotas = await s.cliente.rpc<number>('generar_vencimientos', {
    p_regla_id: creadas[0].id,
    p_horizonte_meses: 12,
  });

  return { regla_id: creadas[0].id, cuotas };
}

export function darDeBajaVehiculo(s: Sesion, vehiculoId: string, fechaBaja?: string) {
  return s.cliente.rest<{ id: string; dominio: string }[]>(`/vehiculos?id=eq.${vehiculoId}`, {
    metodo: 'PATCH',
    prefer: 'return=representation',
    cuerpo: { estado: 'baja', fecha_baja: fechaBaja },
  });
}

export const tiposDeObligacion = (s: Sesion) =>
  s.cliente.rest<{ id: string; codigo: string; nombre: string }[]>(
    '/tipos_obligacion?select=id,codigo,nombre&activo=eq.true&order=nombre',
  );

export const hoyEnOrganizacion = (s: Sesion) =>
  s.cliente.rpc<string>('hoy_en_organizacion', { p_organizacion_id: s.organizacion.id });
