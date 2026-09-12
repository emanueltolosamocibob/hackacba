// =============================================================================
// Esquemas de validacion (zod).
//
// Espejan las restricciones que ya impone la base. La base sigue siendo la
// autoridad -- estos esquemas no la reemplazan, la anticipan: sirven para que
// el bot rechace una entrada mal formada con un mensaje claro en castellano en
// vez de mostrarle al usuario un error de Postgres.
//
// Cuando cambie una restriccion en una migracion, hay que actualizar el
// esquema de aca. Es duplicacion deliberada, y es el precio de tener buenos
// mensajes de error en el chat.
// =============================================================================

import { z } from 'zod';

// ------------------------------------------------------------------ primitivos

/**
 * Dominio (patente). Se normaliza antes de validar, igual que hace el trigger
 * fn_normalizar_dominio: mayusculas y sin separadores.
 * Formatos argentinos: AAA123 (viejo), AB123CD (Mercosur), A123BCD (moto).
 */
export const dominio = z
  .string()
  .transform(v => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
  .refine(v => v.length >= 6 && v.length <= 8, {
    message: 'El dominio debe tener entre 6 y 8 caracteres alfanumericos (AAA123 o AB123CD).',
  });

export const uuid = z.string().uuid('Identificador invalido.');

/** Importes en pesos: dos decimales, nunca negativos, tope del numeric(14,2). */
export const monto = z
  .number()
  .nonnegative('El importe no puede ser negativo.')
  .max(999_999_999_999.99, 'El importe supera el maximo admitido.')
  .multipleOf(0.01, 'El importe admite como maximo dos decimales.');

/** Fecha de calendario en formato ISO, sin hora: los vencimientos son dias. */
export const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD.')
  .refine(v => !Number.isNaN(Date.parse(v)), 'La fecha no existe en el calendario.');

/** Periodo de una cuota: AAAA-MM. */
export const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El periodo debe tener el formato AAAA-MM.');

export const cuit = z
  .string()
  .regex(/^[0-9]{11}$/, 'El CUIT son 11 digitos sin guiones.');

// ------------------------------------------------------------------ enumerados

export const rolMiembro        = z.enum(['propietario', 'administrador', 'operador', 'lector']);
export const estadoVehiculo    = z.enum(['activo', 'inactivo', 'vendido', 'baja']);
export const tipoVehiculo      = z.enum(['auto', 'camioneta', 'moto', 'camion', 'acoplado', 'utilitario', 'otro']);
export const jurisdiccion      = z.enum(['provincial', 'municipal', 'nacional', 'privado']);
export const frecuencia        = z.enum(['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual', 'unica']);
export const estadoVencimiento = z.enum(['pendiente', 'parcial', 'pagado', 'condonado', 'anulado']);
export const estadoEfectivo    = z.enum(['pendiente', 'parcial', 'vencido', 'pagado', 'condonado', 'anulado']);
export const medioPago         = z.enum(['transferencia', 'debito_automatico', 'efectivo', 'tarjeta', 'homebanking', 'pago_facil', 'rapipago', 'otro']);

// ------------------------------------------------------------------- entidades

export const altaVehiculo = z.object({
  organizacion_id: uuid,
  flota_id:        uuid,
  dominio,
  marca:           z.string().trim().min(1).max(60).optional(),
  modelo:          z.string().trim().min(1).max(60).optional(),
  anio:            z.number().int().min(1900).max(2100).optional(),
  tipo:            tipoVehiculo.default('auto'),
  numero_motor:    z.string().trim().max(60).optional(),
  numero_chasis:   z.string().trim().max(60).optional(),
  notas:           z.string().trim().max(2000).optional(),
});

export const altaReglaVencimiento = z
  .object({
    organizacion_id:    uuid,
    vehiculo_id:        uuid,
    tipo_obligacion_id: uuid,
    frecuencia,
    dia_vencimiento:    z.number().int().min(1).max(31),
    mes_inicio:         z.number().int().min(1).max(12).default(1),
    /** Calendario explicito. Si viene, manda sobre frecuencia y mes_inicio. */
    meses_cuotas:       z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
    monto_estimado:     monto.optional(),
    vigente_desde:      fecha.optional(),
    vigente_hasta:      fecha.optional(),
    notas:              z.string().trim().max(2000).optional(),
  })
  .refine(
    r => !r.vigente_hasta || !r.vigente_desde || r.vigente_hasta > r.vigente_desde,
    { message: 'La vigencia debe terminar despues de empezar.', path: ['vigente_hasta'] },
  );

export const altaPago = z.object({
  organizacion_id: uuid,
  vencimiento_id:  uuid,
  monto:           monto.refine(v => v > 0, 'El pago debe ser mayor que cero.'),
  fecha_pago:      fecha.optional(),
  medio_pago:      medioPago.default('transferencia'),
  referencia:      z.string().trim().max(120).optional(),
  notas:           z.string().trim().max(2000).optional(),
});

export const anulacionPago = z.object({
  pago_id:          uuid,
  motivo_anulacion: z.string().trim().min(3, 'Hay que decir por que se anula.').max(500),
});

// ------------------------------------------------------- consultas del agente

/** Filtros con los que el bot va a listar vencimientos. */
export const filtroVencimientos = z
  .object({
    organizacion_id: uuid,
    flota_id:        uuid.optional(),
    vehiculo_id:     uuid.optional(),
    dominio:         dominio.optional(),
    tipo_codigo:     z.string().trim().max(50).optional(),
    estado:          z.array(estadoEfectivo).min(1).optional(),
    desde:           fecha.optional(),
    hasta:           fecha.optional(),
    limite:          z.number().int().min(1).max(200).default(50),
  })
  .refine(f => !f.desde || !f.hasta || f.hasta >= f.desde, {
    message: 'El fin del rango no puede ser anterior al inicio.',
    path: ['hasta'],
  });

export const parametrosReporteGastos = z
  .object({
    organizacion_id: uuid,
    desde:           fecha,
    hasta:           fecha,
    agrupar_por:     z.enum(['tipo', 'vehiculo', 'flota', 'mes']).default('tipo'),
  })
  .refine(p => p.hasta >= p.desde, {
    message: 'El fin del periodo no puede ser anterior al inicio.',
    path: ['hasta'],
  });

/** Una fila del CSV de importacion, antes de mandarla a importar_vehiculos. */
export const filaImportacion = z.object({
  dominio,
  marca:         z.string().trim().max(60).optional(),
  modelo:        z.string().trim().max(60).optional(),
  anio:          z.union([z.string(), z.number()]).optional(),
  tipo:          tipoVehiculo.optional(),
  numero_motor:  z.string().trim().max(60).optional(),
  numero_chasis: z.string().trim().max(60).optional(),
});

// ----------------------------------------------------------- tipos inferidos

export type AltaVehiculoEntrada         = z.input<typeof altaVehiculo>;
export type AltaReglaVencimientoEntrada = z.input<typeof altaReglaVencimiento>;
export type AltaPagoEntrada             = z.input<typeof altaPago>;
export type FiltroVencimientos          = z.output<typeof filtroVencimientos>;
export type ParametrosReporteGastos     = z.output<typeof parametrosReporteGastos>;
export type FilaImportacion             = z.output<typeof filaImportacion>;
