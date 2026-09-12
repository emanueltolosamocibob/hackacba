// =============================================================================
// Las cinco escrituras, y su validacion.
//
// Un solo lugar donde se ejecutan, porque hay dos caminos que llegan hasta aca:
// el boton de confirmacion del agente y los comandos deterministas. Que ambos
// pasen por la misma funcion es lo que garantiza que `/pague` y "registrame el
// pago" hagan exactamente lo mismo.
//
// La validacion usa los esquemas zod de paquetes/compartido, que espejan las
// restricciones de la base. No la reemplazan -la base sigue siendo la
// autoridad-: la anticipan, para poder decir "el importe no puede ser negativo"
// en vez de mostrar un error de constraint de Postgres en un chat.
// =============================================================================

import { z } from 'zod';
import * as esquemas from '../../../paquetes/compartido/src/esquemas.ts';
import type { Sesion } from './sesion.ts';
import * as negocio from './negocio.ts';
import { importe } from './formato.ts';

export class ErrorDeEntrada extends Error {}

function validar<T extends z.ZodType>(esquema: T, valor: unknown): z.output<T> {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    throw new ErrorDeEntrada(resultado.error.issues.map(i => i.message).join(' '));
  }
  return resultado.data;
}

const altaVencimiento = z.object({
  vehiculo_id: esquemas.uuid,
  tipo_obligacion_id: esquemas.uuid,
  periodo: esquemas.periodo,
  fecha_vencimiento: esquemas.fecha,
  monto_estimado: esquemas.monto.optional(),
  numero_boleta: z.string().trim().max(60).optional(),
  notas: z.string().trim().max(2000).optional(),
});

const bajaVehiculo = z.object({
  vehiculo_id: esquemas.uuid,
  fecha_baja: esquemas.fecha.optional(),
});

export const HERRAMIENTAS_DE_ESCRITURA = [
  'registrar_pago',
  'anular_pago',
  'cargar_vencimiento',
  'crear_regla',
  'dar_de_baja_vehiculo',
] as const;

export type HerramientaDeEscritura = typeof HERRAMIENTAS_DE_ESCRITURA[number];

export const esEscritura = (nombre: string): nombre is HerramientaDeEscritura =>
  (HERRAMIENTAS_DE_ESCRITURA as readonly string[]).includes(nombre);

/**
 * Ejecuta la escritura y devuelve que paso, en castellano.
 *
 * Se llama despues de la confirmacion, nunca antes.
 */
export async function ejecutar(
  s: Sesion,
  herramienta: string,
  argumentos: Record<string, unknown>,
): Promise<string> {
  switch (herramienta) {
    case 'registrar_pago': {
      const datos = validar(esquemas.altaPago, {
        ...argumentos,
        organizacion_id: s.organizacion.id,
      });
      await negocio.registrarPago(s, {
        vencimiento_id: datos.vencimiento_id,
        monto: datos.monto,
        fecha_pago: datos.fecha_pago,
        medio_pago: datos.medio_pago,
        referencia: datos.referencia,
        notas: datos.notas,
      });

      // La base recalcula el estado sola con el trigger de pagos; se relee para
      // decir como quedo en vez de suponerlo.
      const v = await negocio.resolverVencimiento(s, datos.vencimiento_id);
      return `Registre ${importe(datos.monto)} en ${v.dominio} (${v.tipo_nombre} ${v.periodo}). Quedo ${v.estado_efectivo}.`;
    }

    case 'anular_pago': {
      const datos = validar(esquemas.anulacionPago, argumentos);
      await negocio.anularPago(s, datos.pago_id, datos.motivo_anulacion);
      return 'Anule el pago. El vencimiento volvio al estado que corresponde.';
    }

    case 'cargar_vencimiento': {
      const datos = validar(altaVencimiento, argumentos);
      await negocio.cargarVencimiento(s, datos);
      return `Cargue el vencimiento del periodo ${datos.periodo} con fecha ${datos.fecha_vencimiento}.`;
    }

    case 'crear_regla': {
      const datos = validar(esquemas.altaReglaVencimiento, {
        ...argumentos,
        organizacion_id: s.organizacion.id,
      });
      const { cuotas } = await negocio.crearRegla(s, {
        vehiculo_id: datos.vehiculo_id,
        tipo_obligacion_id: datos.tipo_obligacion_id,
        frecuencia: datos.frecuencia,
        dia_vencimiento: datos.dia_vencimiento,
        mes_inicio: datos.mes_inicio,
        meses_cuotas: datos.meses_cuotas,
        monto_estimado: datos.monto_estimado,
        vigente_desde: datos.vigente_desde,
        notas: datos.notas,
      });
      return `Cree la regla y genere ${cuotas} cuota(s) para los proximos 12 meses.`;
    }

    case 'dar_de_baja_vehiculo': {
      const datos = validar(bajaVehiculo, argumentos);
      const [vehiculo] = await negocio.darDeBajaVehiculo(s, datos.vehiculo_id, datos.fecha_baja);
      return `Di de baja el vehiculo ${vehiculo?.dominio ?? ''}. Sus vencimientos futuros dejan de avisar.`;
    }

    default:
      throw new ErrorDeEntrada(`No conozco la accion "${herramienta}".`);
  }
}
