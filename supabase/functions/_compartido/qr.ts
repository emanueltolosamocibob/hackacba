// =============================================================================
// El QR del link de pago.
//
// Se genera aca y no con un servicio de QR online por dos razones: el link
// lleva el dominio del vehiculo y el periodo, que no tienen por que pasar por
// un tercero, y un servicio externo es una dependencia mas que se puede caer
// justo el dia del vencimiento.
// =============================================================================

import QRCode from 'qrcode';

/**
 * Devuelve el PNG, o null si no se pudo generar.
 *
 * El null no es paranoia: la libreria es npm y depende del shim de zlib de
 * Deno. Si algun dia deja de resolver, el mensaje de pago tiene que salir igual
 * -el link y el importe son lo que importa- y el QR es la comodidad de poder
 * abrirlo desde otro telefono.
 */
export async function qrPng(texto: string): Promise<Uint8Array | null> {
  try {
    const buffer = await QRCode.toBuffer(texto, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 420,
    });
    return new Uint8Array(buffer);
  } catch (error) {
    console.error('No se pudo generar el QR:', error);
    return null;
  }
}
