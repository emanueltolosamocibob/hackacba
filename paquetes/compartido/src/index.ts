// =============================================================================
// Tipos compartidos del backend.
//
// `tipos.ts` se genera desde el esquema real, no se edita a mano:
//   npm run db:tipos
//
// Este archivo le pone alias legibles encima, para que el codigo cliente diga
// `Vehiculo` en vez de `Database['public']['Tables']['vehiculos']['Row']`.
// Lo van a consumir tanto el bot como la Mini App.
// =============================================================================

export type { Database, Json } from './tipos.js';

import type { Database } from './tipos.js';

type Publico = Database['public'];
type Tabla<N extends keyof Publico['Tables']> = Publico['Tables'][N]['Row'];
type Alta<N extends keyof Publico['Tables']> = Publico['Tables'][N]['Insert'];
type Cambio<N extends keyof Publico['Tables']> = Publico['Tables'][N]['Update'];

// ----------------------------------------------------------------- entidades

export type Organizacion     = Tabla<'organizaciones'>;
export type Miembro          = Tabla<'miembros'>;
export type Flota            = Tabla<'flotas'>;
export type Vehiculo         = Tabla<'vehiculos'>;
export type TipoObligacion   = Tabla<'tipos_obligacion'>;
export type ReglaVencimiento = Tabla<'reglas_vencimiento'>;
export type Vencimiento      = Tabla<'vencimientos'>;
export type Pago             = Tabla<'pagos'>;
export type ReglaAviso       = Tabla<'reglas_aviso'>;
export type Aviso            = Tabla<'avisos'>;
export type ResumenFlota     = Tabla<'resumenes_flota'>;
export type Auditoria        = Tabla<'auditoria'>;

export type VencimientoConEstado = Publico['Views']['v_vencimientos_estado']['Row'];

// ------------------------------------------------------------------- escritura

export type AltaVehiculo         = Alta<'vehiculos'>;
export type AltaReglaVencimiento = Alta<'reglas_vencimiento'>;
export type AltaVencimiento      = Alta<'vencimientos'>;
export type AltaPago             = Alta<'pagos'>;

export type CambioVehiculo    = Cambio<'vehiculos'>;
export type CambioVencimiento = Cambio<'vencimientos'>;

// ----------------------------------------------------------------- enumerados

export type RolMiembro        = Publico['Enums']['rol_miembro'];
export type EstadoVehiculo    = Publico['Enums']['estado_vehiculo'];
export type TipoVehiculo      = Publico['Enums']['tipo_vehiculo'];
export type Jurisdiccion      = Publico['Enums']['jurisdiccion'];
export type Frecuencia        = Publico['Enums']['frecuencia'];
export type EstadoVencimiento = Publico['Enums']['estado_vencimiento'];
export type EstadoEfectivo    = Publico['Enums']['estado_efectivo'];
export type MedioPago         = Publico['Enums']['medio_pago'];

// --------------------------------------------------------------------- canales

/** Topico del canal Realtime privado de una flota. */
export const canalDeFlota = (flotaId: string): string => `flota:${flotaId}`;

/** Evento que emite recalcular_resumen_flota en ese canal. */
export const EVENTO_RESUMEN = 'resumen_actualizado' as const;

/** Payload del broadcast: el resumen compacto, no la fila cruda. */
export interface PayloadResumen {
  flota_id: string;
  total_vehiculos: number;
  vehiculos_activos: number;
  cantidad_pendientes: number;
  cantidad_vencidos: number;
  monto_vencido: number;
  monto_por_vencer_30d: number;
  proximo_vencimiento: string | null;
}

// -------------------------------------------------------------------- utiles

/** Un vencimiento esta impago si todavia se le debe plata a alguien. */
export const estaImpago = (estado: EstadoEfectivo): boolean =>
  estado === 'pendiente' || estado === 'parcial' || estado === 'vencido';

/** Normaliza un dominio igual que el trigger de la base. */
export const normalizarDominio = (dominio: string): string =>
  dominio.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// ------------------------------------------------------------------ esquemas

export * as esquemas from './esquemas.js';
