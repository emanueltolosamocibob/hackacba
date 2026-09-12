// =============================================================================
// El contrato que aisla el hook de Send SMS de WAHA (design-2, seccion
// "Interfaces"). Los tests usan `mensajeria/falso.ts`; produccion usa
// `mensajeria/waha.ts`. Ninguno de los dos lados conoce al otro.
// =============================================================================

export interface ResultadoEnvioOtp {
  estado: 'enviado';
  idExterno?: string;
}

export interface FalloEnvioOtp {
  estado: 'no_disponible' | 'rechazado' | 'timeout';
  reintentable: boolean;
}

export interface ProveedorOtp {
  enviar(p: {
    telefonoE164: string;
    codigo: string;
    idempotencia: string;
    senal: AbortSignal;
  }): Promise<ResultadoEnvioOtp | FalloEnvioOtp>;
  estado(senal: AbortSignal): Promise<'conectado' | 'desconectado' | 'degradado'>;
}
