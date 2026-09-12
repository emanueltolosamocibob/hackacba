// =============================================================================
// ProveedorOtp de prueba: no hace red, registra cada llamada para que los
// tests puedan afirmar cuantas veces (y con que) se lo invoco.
// =============================================================================

import type { FalloEnvioOtp, ProveedorOtp, ResultadoEnvioOtp } from '../proveedor-otp.ts';

export interface LlamadaFalsa {
  telefonoE164: string;
  codigo: string;
  idempotencia: string;
}

export interface ProveedorOtpFalso extends ProveedorOtp {
  readonly llamadas: LlamadaFalsa[];
}

export interface OpcionesProveedorFalso {
  resultado?: ResultadoEnvioOtp | FalloEnvioOtp;
  estadoConexion?: 'conectado' | 'desconectado' | 'degradado';
}

export function crearProveedorOtpFalso(opciones: OpcionesProveedorFalso = {}): ProveedorOtpFalso {
  const llamadas: LlamadaFalsa[] = [];

  return {
    llamadas,
    // deno-lint-ignore require-await
    async enviar({ telefonoE164, codigo, idempotencia }) {
      llamadas.push({ telefonoE164, codigo, idempotencia });
      return opciones.resultado ?? { estado: 'enviado', idExterno: 'falso-1' };
    },
    // deno-lint-ignore require-await
    async estado() {
      return opciones.estadoConexion ?? 'conectado';
    },
  };
}
