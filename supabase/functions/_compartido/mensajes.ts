// =============================================================================
// Los mensajes compuestos: lo que sale por el chat.
//
// Viven aca y no en cada funcion porque los comandos y el agente tienen que
// mandar exactamente lo mismo. Que `/pagar ABC123` y "pasame el link del
// automotor de la ABC123" den dos mensajes distintos seria confuso.
// =============================================================================

import { servicio } from './rest.ts';
import type { Sesion } from './sesion.ts';
import * as negocio from './negocio.ts';
import { qrPng } from './qr.ts';
import {
  boton,
  enviar,
  enviarFoto,
  escapar,
  type Teclado,
} from './telegram.ts';
import {
  codigoCorto,
  type FilaVencimiento,
  fecha,
  importe,
  listaVencimientos,
  partir,
} from './formato.ts';

/** Manda un texto largo en varios mensajes si hace falta. */
export async function enviarTexto(chatId: number, texto: string, teclado?: Teclado) {
  const partes = partir(texto);
  for (const [i, parte] of partes.entries()) {
    // El teclado va solo en el ultimo, o quedan botones colgando en el medio.
    await enviar(chatId, parte, { teclado: i === partes.length - 1 ? teclado : undefined });
  }
}

// ------------------------------------------------------------------- pagos

/**
 * El mensaje de pago: link, datos copiables y QR.
 *
 * El sistema no mueve plata (README y BOT.md, seccion 9). Esto acerca el link
 * oficial con los marcadores ya resueltos y nada mas; el pago lo hace una
 * persona en el portal del organismo.
 */
export async function enviarLinkDePago(chatId: number, s: Sesion, vencimientoId: string) {
  const datos = await negocio.linkDePago(s, vencimientoId);
  if (!datos) {
    await enviar(chatId, 'No encontre ese vencimiento.');
    return;
  }

  const url = datos.url as string | null;
  const monto = datos.monto as number | null;
  const dominio = String(datos.dominio ?? '');

  const lineas = [
    `<b>${escapar(dominio)}</b> - ${escapar(String(datos.tipo ?? ''))} ${escapar(String(datos.periodo ?? ''))}`,
    `Vence el ${fecha(datos.fecha_vencimiento as string)}`,
    '',
    `Dominio: <code>${escapar(dominio)}</code>`,
    `Importe: <code>${monto ?? ''}</code>  (${importe(monto, String(datos.moneda ?? 'ARS'))})`,
  ];

  if (!datos.monto_confirmado) {
    lineas.push('<i>El importe es el estimado de la regla, no el de la boleta.</i>');
  }
  if (datos.numero_boleta) {
    lineas.push(`Boleta: <code>${escapar(String(datos.numero_boleta))}</code>`);
  }
  if (datos.instrucciones) {
    lineas.push('', escapar(String(datos.instrucciones)));
  }
  if (!url) {
    lineas.push('', 'Este tipo de obligacion no tiene URL de pago cargada.');
  }

  const teclado: Teclado = { inline_keyboard: [] };
  if (url) teclado.inline_keyboard.push([{ text: `Pagar en ${datos.organismo ?? 'el sitio oficial'}`, url }]);
  teclado.inline_keyboard.push([boton('Registrar el pago', `pagar:${vencimientoId}`)]);

  await enviar(chatId, lineas.join('\n'), { teclado });

  if (url) {
    const png = await qrPng(url);
    if (png) {
      await enviarFoto(chatId, png, {
        pie: `QR del pago de <b>${escapar(dominio)}</b>, para abrirlo desde otro telefono.`,
      });
    }
  }
}

// ----------------------------------------------------------- vencimientos

export async function enviarVencimientos(
  chatId: number,
  titulo: string,
  filas: FilaVencimiento[],
  vacio: string,
) {
  if (filas.length === 0) {
    await enviar(chatId, vacio);
    return;
  }

  const total = filas.reduce((suma, f) => suma + Number(f.monto_vigente ?? 0), 0);
  const cuerpo =
    `<b>${escapar(titulo)}</b>\n\n` +
    listaVencimientos(filas) +
    `\n\n${filas.length} vencimiento(s), ${importe(total)} en total.` +
    `\nPara el link de pago: <code>/pagar ${codigoCorto(filas[0].id)}</code>`;

  await enviarTexto(chatId, cuerpo);
}

// ------------------------------------------------------------------ flotas

export async function enviarPanelDeFlotas(chatId: number, s: Sesion) {
  const resumenes = await negocio.resumenDeFlotas(s);

  if (resumenes.length === 0) {
    await enviar(chatId, 'Todavia no hay flotas cargadas en esta organizacion.');
    return;
  }

  const bloques = resumenes.map(r => {
    const nombre = r.flotas?.nombre ?? 'Flota';
    const vencidos = r.cantidad_vencidos > 0
      ? `<b>${r.cantidad_vencidos} vencido(s)</b> por ${importe(r.monto_vencido)}`
      : 'sin vencidos';
    return (
      `<b>${escapar(nombre)}</b>\n` +
      `  ${r.vehiculos_activos} de ${r.total_vehiculos} vehiculo(s) activos\n` +
      `  ${vencidos}\n` +
      `  ${r.cantidad_pendientes} pendiente(s), ${importe(r.monto_por_vencer_30d)} en los proximos 30 dias\n` +
      `  Proximo vencimiento: ${fecha(r.proximo_vencimiento)}`
    );
  });

  await enviarTexto(chatId, `<b>${escapar(s.organizacion.nombre)}</b>\n\n${bloques.join('\n\n')}`);
}

export async function enviarResumenDeFlota(chatId: number, s: Sesion, flotaId: string) {
  const datos = await negocio.resumenFlota(s, flotaId) as {
    flota?: { nombre: string };
    resumen?: Record<string, number | string | null>;
    proximos?: FilaVencimiento[];
  };

  const nombre = datos.flota?.nombre ?? 'Flota';
  const r = datos.resumen ?? {};

  const encabezado =
    `<b>${escapar(nombre)}</b>\n` +
    `${r.vehiculos_activos ?? 0} de ${r.total_vehiculos ?? 0} vehiculo(s) activos\n` +
    `${r.cantidad_vencidos ?? 0} vencido(s) por ${importe(r.monto_vencido as number)}\n` +
    `${r.cantidad_pendientes ?? 0} pendiente(s), ${importe(r.monto_por_vencer_30d as number)} a 30 dias`;

  const proximos = datos.proximos ?? [];
  const cuerpo = proximos.length
    ? `${encabezado}\n\n<b>Lo que viene</b>\n${listaVencimientos(proximos)}`
    : `${encabezado}\n\nNo hay nada impago.`;

  await enviarTexto(chatId, cuerpo);
}

// ---------------------------------------------------------------- vehiculo

export async function enviarDetalleDeVehiculo(chatId: number, s: Sesion, vehiculoId: string) {
  const datos = await negocio.detalleVehiculo(s, vehiculoId) as {
    vehiculo?: Record<string, unknown>;
    vencimientos?: FilaVencimiento[];
    total_pagado?: number;
  };

  const v = datos.vehiculo ?? {};
  const todos = datos.vencimientos ?? [];
  const impagos = todos.filter(x => ['pendiente', 'parcial', 'vencido'].includes(x.estado_efectivo));

  const ficha =
    `<b>${escapar(String(v.dominio ?? ''))}</b> ${escapar([v.marca, v.modelo, v.anio].filter(Boolean).join(' '))}\n` +
    `Flota: ${escapar(String(v.flota ?? '-'))} - ${escapar(String(v.estado ?? ''))}\n` +
    `Total pagado historico: ${importe(datos.total_pagado)}`;

  const cuerpo = impagos.length
    ? `${ficha}\n\n<b>Impago</b>\n${listaVencimientos(impagos)}`
    : `${ficha}\n\nNo debe nada.`;

  await enviarTexto(chatId, cuerpo);
}

// ----------------------------------------------------------- confirmacion

/**
 * Deja una escritura esperando el boton.
 *
 * Los argumentos van a la base y no al callback_data: 64 bytes no alcanzan para
 * un motivo de anulacion, y ademas un dato que viaja por el cliente se puede
 * fabricar. Lo unico que vuelve del boton es un id de un solo uso.
 */
export async function pedirConfirmacion(opciones: {
  chatId: number;
  telegramUserId: number;
  organizacionId: string;
  herramienta: string;
  argumentos: Record<string, unknown>;
  resumen: string;
}) {
  const id = await servicio.rpc<string>('guardar_accion_pendiente', {
    p_telegram_user_id: opciones.telegramUserId,
    p_chat_id: opciones.chatId,
    p_organizacion_id: opciones.organizacionId,
    p_herramienta: opciones.herramienta,
    p_argumentos: opciones.argumentos,
    p_minutos: 10,
  });

  await enviar(opciones.chatId, `${opciones.resumen}\n\n¿Lo confirmas?`, {
    teclado: {
      inline_keyboard: [[
        boton('Confirmar', `ok:${id}`),
        boton('Cancelar', `no:${id}`),
      ]],
    },
  });

  return id;
}
