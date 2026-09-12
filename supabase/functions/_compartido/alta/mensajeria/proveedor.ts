// =============================================================================
// Contrato generico de mensajeria por WhatsApp, mas amplio que ProveedorOtp:
// mandar un texto suelto y consultar la salud de la sesion. `waha.ts` lo
// implementa y expone ademas un adaptador a ProveedorOtp para el hook de
// Send SMS. Separado de proveedor-otp.ts porque el bot (Fase 4) va a
// necesitar mandar texto libre, no solo un OTP.
// =============================================================================

export interface ProveedorMensajeria {
  enviarTexto(p: {
    telefonoE164: string;
    texto: string;
    senal: AbortSignal;
  }): Promise<{ ok: true; idExterno?: string } | { ok: false; reintentable: boolean }>;
  estadoSesion(senal: AbortSignal): Promise<'conectado' | 'desconectado' | 'degradado'>;
}
