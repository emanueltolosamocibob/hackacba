// =============================================================================
// El webhook de Telegram: la primera Edge Function del proyecto.
//
// Hace tres cosas: el alta de usuarios, los comandos deterministas y los
// botones. Todo lo que no sea un comando se deriva a la funcion `agente`.
//
// Los comandos existen ademas del agente y no en lugar de el (BOT.md, seccion
// 5): son predecibles, no cuestan tokens y siguen andando si el modelo falla o
// se acaba la cuota. Un dueno de flota que necesita el link de pago un viernes
// a la noche no deberia depender de que un LLM este disponible.
//
// Sobre el tiempo: se contesta 200 apenas se valida la cabecera y se sigue
// trabajando en segundo plano. Telegram reintenta el update si el webhook tarda,
// y un reintento es un mensaje duplicado para la persona.
// =============================================================================

import { SECRETO_WEBHOOK, URL_SUPABASE, CLAVE_SERVICIO } from '../_compartido/entorno.ts';
import { ErrorApi, servicio } from '../_compartido/rest.ts';
import { asegurarCuenta, contextoDe, sesionDeChat, type Sesion } from '../_compartido/sesion.ts';
import * as negocio from '../_compartido/negocio.ts';
import * as mensajes from '../_compartido/mensajes.ts';
import { ejecutar, ErrorDeEntrada } from '../_compartido/escrituras.ts';
import {
  codigoCorto,
  type FilaVencimiento,
  fecha as formatoFecha,
  importe,
} from '../_compartido/formato.ts';
import {
  boton,
  contactoEsDelRemitente,
  enviar,
  escapar,
  escribiendo,
  type Mensaje,
  quitarTeclado,
  responderBoton,
  tecladoCompartirNumero,
  type ConsultaBoton,
  type Update,
} from '../_compartido/telegram.ts';

const AYUDA = `<b>Comandos</b>

/flota - resumen de todas las flotas
/flota &lt;nombre&gt; - una flota en particular
/vehiculo &lt;dominio&gt; - ficha y deuda de un vehiculo
/vencimientos [dias] - lo que vence en N dias (30 por defecto)
/vencidos - solo lo que ya vencio
/pagar &lt;codigo&gt; - link de pago, importe y QR
/pague &lt;codigo&gt; &lt;monto&gt; - registrar un pago
/reporte &lt;desde&gt; &lt;hasta&gt; [tipo|vehiculo|flota|mes] - gastos del periodo
/organizacion [nombre] - ver o cambiar la organizacion activa
/olvidar - borrar lo que recuerdo de la charla
/salir - desvincular este chat
/ayuda - esto

El &lt;codigo&gt; son los seis caracteres que aparecen al principio de cada
vencimiento en los listados. Tambien podes escribirme en castellano:
"que vence esta semana", "cuanto debe la ABC123", "pague el automotor de la
DEF456".`;

// ---------------------------------------------------------------- servidor

function enSegundoPlano(promesa: Promise<unknown>) {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil(p: Promise<unknown>): void };
  }).EdgeRuntime;
  if (runtime) runtime.waitUntil(promesa);
}

Deno.serve(async (peticion) => {
  if (peticion.method !== 'POST') return new Response('Metodo no admitido', { status: 405 });

  // Lo unico que separa un update de Telegram de cualquiera que descubra esta
  // URL, que es publica y no valida JWT.
  if (peticion.headers.get('x-telegram-bot-api-secret-token') !== SECRETO_WEBHOOK) {
    return new Response('No autorizado', { status: 401 });
  }

  let update: Update;
  try {
    update = await peticion.json();
  } catch {
    return new Response('ok');
  }

  enSegundoPlano(
    procesar(update).catch(error => console.error('Error procesando el update:', error)),
  );

  return new Response('ok');
});

// ---------------------------------------------------------------- despacho

async function procesar(update: Update) {
  if (update.callback_query) return manejarBoton(update.callback_query);

  const mensaje = update.message;
  if (!mensaje?.from || mensaje.from.is_bot) return;

  if (mensaje.contact) return manejarContacto(mensaje);
  if (mensaje.text) return manejarTexto(mensaje, mensaje.text.trim());
}

/** Convierte cualquier fallo en algo que se pueda leer en el chat. */
async function conAviso(chatId: number, trabajo: () => Promise<void>) {
  try {
    await trabajo();
  } catch (error) {
    if (error instanceof ErrorApi || error instanceof ErrorDeEntrada) {
      await enviar(chatId, escapar(error.message));
      return;
    }
    console.error(error);
    await enviar(chatId, 'Algo se rompio de mi lado. Proba de nuevo en un momento.');
  }
}

/**
 * La sesion, o el pedido de vinculacion.
 *
 * Devolver null y haber avisado ya es mas simple que tirar una excepcion que
 * cada llamador tenga que distinguir de un error real.
 */
async function sesionOInvitar(mensaje: Mensaje): Promise<Sesion | null> {
  const sesion = await sesionDeChat(mensaje.from!.id);
  if (sesion) return sesion;

  await enviar(
    mensaje.chat.id,
    'Todavia no te reconozco. Toca el boton para compartir tu numero y te vinculo con tu flota.',
    { tecladoRespuesta: tecladoCompartirNumero },
  );
  return null;
}

// -------------------------------------------------------------------- alta

async function manejarContacto(mensaje: Mensaje) {
  const chatId = mensaje.chat.id;

  // EL chequeo. `contact.user_id` solo viene cuando el contacto es el del
  // propio remitente; sin esto, reenviar la tarjeta de otra persona alcanza
  // para entrar como ella, porque la invitacion se busca por ese numero.
  if (!contactoEsDelRemitente(mensaje)) {
    await enviar(
      chatId,
      'Ese contacto no es el tuyo. Usa el boton "Compartir mi numero": Telegram verifica el ' +
        'numero con el que te registraste, y es el unico que puedo aceptar.',
      { tecladoRespuesta: tecladoCompartirNumero },
    );
    return;
  }

  const telegramUserId = mensaje.from!.id;
  const telefono = mensaje.contact!.phone_number;
  const nombre = [mensaje.from!.first_name, mensaje.from!.last_name].filter(Boolean).join(' ');

  await conAviso(chatId, async () => {
    const usuarioId = await asegurarCuenta(telegramUserId, { nombre, telefono });

    // El numero va tal cual lo dio Telegram: la normalizacion es de la base
    // (migracion 0015), y el `15` de celular va en el medio, asi que comparar
    // por los ultimos digitos desde el bot no alcanzaria.
    const alta = await servicio.rpc<{ organizacion: string; rol: string }>('canjear_por_telefono', {
      p_telefono_verificado: telefono,
      p_usuario_id: usuarioId,
      p_telegram_user_id: telegramUserId,
      p_chat_id: chatId,
      p_nombre_telegram: nombre || null,
    });

    await enviar(
      chatId,
      `Listo. Entraste a <b>${escapar(alta.organizacion)}</b> como ${escapar(alta.rol)}.\n\n${AYUDA}`,
      { tecladoRespuesta: quitarTeclado },
    );
  });
}

async function altaPorCodigo(mensaje: Mensaje, codigo: string) {
  const chatId = mensaje.chat.id;
  const telegramUserId = mensaje.from!.id;
  const nombre = [mensaje.from!.first_name, mensaje.from!.last_name].filter(Boolean).join(' ');

  await conAviso(chatId, async () => {
    const usuarioId = await asegurarCuenta(telegramUserId, { nombre });

    const alta = await servicio.rpc<{ organizacion: string; rol: string }>('canjear_invitacion', {
      p_codigo: codigo,
      p_usuario_id: usuarioId,
      p_telegram_user_id: telegramUserId,
      p_chat_id: chatId,
      p_nombre_telegram: nombre || null,
    });

    await enviar(
      chatId,
      `Listo. Entraste a <b>${escapar(alta.organizacion)}</b> como ${escapar(alta.rol)}.\n\n${AYUDA}`,
      { tecladoRespuesta: quitarTeclado },
    );
  });
}

// ---------------------------------------------------------------- comandos

async function manejarTexto(mensaje: Mensaje, texto: string) {
  const chatId = mensaje.chat.id;

  if (!texto.startsWith('/')) return derivarAlAgente(mensaje, texto);

  // En grupos los comandos llegan como /flota@mi_bot.
  const [crudo, ...resto] = texto.split(/\s+/);
  const comando = crudo.split('@')[0].toLowerCase();
  const argumento = resto.join(' ').trim();

  switch (comando) {
    case '/start':
      return conAviso(chatId, () => comandoStart(mensaje, argumento));
    case '/ayuda':
    case '/help':
      return void await enviar(chatId, AYUDA);
    case '/flota':
      return conAviso(chatId, () => comandoFlota(mensaje, argumento));
    case '/vehiculo':
      return conAviso(chatId, () => comandoVehiculo(mensaje, argumento));
    case '/vencimientos':
      return conAviso(chatId, () => comandoVencimientos(mensaje, argumento));
    case '/vencidos':
      return conAviso(chatId, () => comandoVencidos(mensaje));
    case '/pagar':
      return conAviso(chatId, () => comandoPagar(mensaje, argumento));
    case '/pague':
      return conAviso(chatId, () => comandoPague(mensaje, resto));
    case '/reporte':
      return conAviso(chatId, () => comandoReporte(mensaje, resto));
    case '/organizacion':
      return conAviso(chatId, () => comandoOrganizacion(mensaje, argumento));
    case '/olvidar':
      return conAviso(chatId, () => comandoOlvidar(mensaje));
    case '/salir':
      return conAviso(chatId, () => comandoSalir(mensaje));
    default:
      return void await enviar(chatId, `No conozco ${escapar(comando)}.\n\n${AYUDA}`);
  }
}

async function comandoStart(mensaje: Mensaje, argumento: string) {
  const chatId = mensaje.chat.id;

  if (argumento) return altaPorCodigo(mensaje, argumento);

  const contexto = await contextoDe(mensaje.from!.id);
  if (contexto.vinculado && contexto.organizacion_activa) {
    await enviar(
      chatId,
      `Ya estas dentro de <b>${escapar(contexto.organizacion_activa.nombre)}</b>.\n\n${AYUDA}`,
    );
    return;
  }

  await enviar(
    chatId,
    'Hola. Para vincularte con tu flota necesito el numero con el que te registraste en ' +
      'Telegram: toca el boton de abajo.\n\n' +
      'Si en cambio tenes un codigo de invitacion, mandalo asi: <code>/start CODIGO</code>',
    { tecladoRespuesta: tecladoCompartirNumero },
  );
}

async function comandoFlota(mensaje: Mensaje, nombre: string) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  if (!nombre) {
    await mensajes.enviarPanelDeFlotas(mensaje.chat.id, s);
    return;
  }

  const flota = await negocio.resolverFlota(s, nombre);
  await mensajes.enviarResumenDeFlota(mensaje.chat.id, s, flota.id);
}

async function comandoVehiculo(mensaje: Mensaje, dominio: string) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  if (!dominio) {
    await enviar(mensaje.chat.id, 'Decime el dominio: <code>/vehiculo ABC123</code>');
    return;
  }

  const vehiculo = await negocio.resolverVehiculo(s, dominio);
  await mensajes.enviarDetalleDeVehiculo(mensaje.chat.id, s, vehiculo.id);
}

async function comandoVencimientos(mensaje: Mensaje, argumento: string) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  const dias = Number(argumento) || 30;
  const filas = await negocio.listarVencimientos(s, { hastaDias: dias, limite: 40 });

  await mensajes.enviarVencimientos(
    mensaje.chat.id,
    `Vence en los proximos ${dias} dias`,
    filas,
    `No hay nada impago en los proximos ${dias} dias.`,
  );
}

async function comandoVencidos(mensaje: Mensaje) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  const filas = await negocio.listarVencimientos(s, { estados: ['vencido'], limite: 40 });
  await mensajes.enviarVencimientos(mensaje.chat.id, 'Vencido', filas, 'No hay nada vencido.');
}

async function comandoPagar(mensaje: Mensaje, referencia: string) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  if (!referencia) {
    await enviar(mensaje.chat.id, 'Decime cual: <code>/pagar A3F9C1</code> (el codigo del listado).');
    return;
  }

  const vencimiento = await negocio.resolverVencimiento(s, referencia);
  await mensajes.enviarLinkDePago(mensaje.chat.id, s, vencimiento.id);
}

async function comandoPague(mensaje: Mensaje, partes: string[]) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  const [referencia, montoCrudo] = partes;
  if (!referencia || !montoCrudo) {
    await enviar(mensaje.chat.id, 'Se usa asi: <code>/pague A3F9C1 15000</code>');
    return;
  }

  // "15.000,50" es como se escribe un importe en Argentina y como no lo entiende
  // Number(). El punto es separador de miles y la coma es el decimal.
  const monto = Number(montoCrudo.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(monto) || monto <= 0) {
    await enviar(mensaje.chat.id, `No entendi el importe "${escapar(montoCrudo)}".`);
    return;
  }

  const v = await negocio.resolverVencimiento(s, referencia);
  await proponerPago(mensaje.chat.id, mensaje.from!.id, s, v, monto);
}

async function comandoReporte(mensaje: Mensaje, partes: string[]) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  const [desde, hasta, agrupacion = 'tipo'] = partes;
  if (!desde || !hasta) {
    await enviar(mensaje.chat.id, 'Se usa asi: <code>/reporte 2026-01-01 2026-06-30 tipo</code>');
    return;
  }

  const validas = ['tipo', 'vehiculo', 'flota', 'mes'] as const;
  const agrupar = validas.find(v => v === agrupacion) ?? 'tipo';

  const filas = await negocio.reporteGastos(s, desde, hasta, agrupar);
  if (filas.length === 0) {
    await enviar(mensaje.chat.id, 'No hubo pagos en ese periodo.');
    return;
  }

  const total = filas.reduce((suma, f) => suma + Number(f.monto), 0);
  const cuerpo =
    `<b>Gastos del ${formatoFecha(desde)} al ${formatoFecha(hasta)}</b>, por ${agrupar}\n\n` +
    filas.map(f => `${escapar(f.etiqueta)}\n      ${importe(f.monto)} en ${f.cantidad} pago(s)`).join('\n') +
    `\n\nTotal: <b>${importe(total)}</b>`;

  await mensajes.enviarTexto(mensaje.chat.id, cuerpo);
}

async function comandoOrganizacion(mensaje: Mensaje, nombre: string) {
  const s = await sesionOInvitar(mensaje);
  if (!s) return;

  if (!nombre) {
    if (s.organizaciones.length === 1) {
      await enviar(mensaje.chat.id, `Estas en <b>${escapar(s.organizacion.nombre)}</b>, tu unica organizacion.`);
      return;
    }
    await enviar(mensaje.chat.id, `Estas en <b>${escapar(s.organizacion.nombre)}</b>. Elegi otra:`, {
      teclado: {
        inline_keyboard: s.organizaciones.map(o => [boton(o.nombre, `org:${o.id}`)]),
      },
    });
    return;
  }

  const elegida = s.organizaciones.find(o => o.nombre.toLowerCase().includes(nombre.toLowerCase()));
  if (!elegida) {
    await enviar(mensaje.chat.id, `No perteneces a ninguna organizacion que diga "${escapar(nombre)}".`);
    return;
  }

  await cambiarOrganizacion(mensaje.chat.id, mensaje.from!.id, elegida.id);
}

async function comandoOlvidar(mensaje: Mensaje) {
  await servicio.rpc('olvidar_conversacion', { p_telegram_user_id: mensaje.from!.id });
  await enviar(mensaje.chat.id, 'Listo, me olvide de la charla. Los datos de la flota siguen intactos.');
}

async function comandoSalir(mensaje: Mensaje) {
  const suelto = await servicio.rpc<boolean>('desvincular_telegram', {
    p_telegram_user_id: mensaje.from!.id,
  });

  await enviar(
    mensaje.chat.id,
    suelto
      ? 'Desvinculado. No te saque de la organizacion: para eso hay que borrar tu membresia. ' +
        'Cuando quieras volver, /start.'
      : 'Este chat no estaba vinculado.',
  );
}

// ----------------------------------------------------------------- botones

async function manejarBoton(consulta: ConsultaBoton) {
  const chatId = consulta.message?.chat.id;
  const datos = consulta.data ?? '';
  if (!chatId) return;

  const separador = datos.indexOf(':');
  const verbo = separador === -1 ? datos : datos.slice(0, separador);
  const valor = separador === -1 ? '' : datos.slice(separador + 1);

  // Telegram deja el boton girando hasta que se responde la consulta.
  await responderBoton(consulta.id).catch(() => {});

  await conAviso(chatId, async () => {
    switch (verbo) {
      case 'ok':
        return confirmarAccion(chatId, consulta.from.id, valor);
      case 'no':
        return cancelarAccion(chatId, consulta.from.id, valor);
      case 'link': {
        const s = await sesionDeChat(consulta.from.id);
        if (!s) return;
        return mensajes.enviarLinkDePago(chatId, s, valor);
      }
      case 'pagar': {
        const s = await sesionDeChat(consulta.from.id);
        if (!s) return;
        const v = await negocio.resolverVencimiento(s, valor);
        return proponerPago(chatId, consulta.from.id, s, v, Number(v.monto_vigente ?? 0));
      }
      case 'org':
        return cambiarOrganizacion(chatId, consulta.from.id, valor);
    }
  });
}

async function cambiarOrganizacion(chatId: number, telegramUserId: number, organizacionId: string) {
  const cambio = await servicio.rpc<{ organizacion: string }>('cambiar_organizacion_activa', {
    p_telegram_user_id: telegramUserId,
    p_organizacion_id: organizacionId,
  });
  await enviar(chatId, `Ahora estas operando sobre <b>${escapar(cambio.organizacion)}</b>.`);
}

/**
 * Arma la confirmacion de un pago.
 *
 * Nunca escribe: deja la accion pendiente y manda los botones. Que el camino
 * por defecto sea "no pasa nada" es lo que hace que un malentendido con el
 * agente cueste un toque de "Cancelar" y no un pago mal registrado.
 */
async function proponerPago(
  chatId: number,
  telegramUserId: number,
  s: Sesion,
  v: FilaVencimiento,
  monto: number,
) {
  if (!Number.isFinite(monto) || monto <= 0) {
    await enviar(
      chatId,
      `Ese vencimiento no tiene importe cargado. Decime cuanto pagaste: ` +
        `<code>/pague ${codigoCorto(v.id)} 15000</code>`,
    );
    return;
  }

  const pendiente = Number(v.monto_vigente ?? 0) - monto;
  const nota = pendiente > 0.005
    ? `\nQueda como pago parcial: restarian ${importe(pendiente)}.`
    : '';

  await mensajes.pedirConfirmacion({
    chatId,
    telegramUserId,
    organizacionId: s.organizacion.id,
    herramienta: 'registrar_pago',
    argumentos: { vencimiento_id: v.id, monto },
    resumen:
      `Registrar <b>${importe(monto)}</b> en <b>${escapar(v.dominio)}</b>\n` +
      `${escapar(v.tipo_nombre ?? '')} ${escapar(v.periodo)}, vence el ${formatoFecha(v.fecha_vencimiento)}` +
      nota,
  });
}

async function confirmarAccion(chatId: number, telegramUserId: number, id: string) {
  const accion = await servicio.rpc<{
    herramienta: string;
    argumentos: Record<string, unknown>;
  } | null>('tomar_accion_pendiente', { p_id: id, p_telegram_user_id: telegramUserId });

  if (!accion) {
    await enviar(chatId, 'Esa confirmacion ya no vale: se uso, se cancelo o se vencio. Pedimelo de nuevo.');
    return;
  }

  const s = await sesionDeChat(telegramUserId);
  if (!s) return;

  const resultado = await ejecutar(s, accion.herramienta, accion.argumentos);
  await enviar(chatId, escapar(resultado));
}

async function cancelarAccion(chatId: number, telegramUserId: number, id: string) {
  await servicio.rpc<boolean>('cancelar_accion_pendiente', {
    p_id: id,
    p_telegram_user_id: telegramUserId,
  });
  await enviar(chatId, 'Cancelado, no toque nada.');
}

// ------------------------------------------------------------------ agente

/**
 * Todo lo que no es un comando.
 *
 * Se invoca la funcion `agente` por HTTP en vez de correr el loop aca: un loop
 * de tool calling puede tardar mas que lo que dura esta invocacion, y asi cada
 * uno tiene su propio presupuesto de ejecucion. El agente contesta al chat por
 * su cuenta; aca no se espera nada de vuelta salvo saber que arranco.
 */
async function derivarAlAgente(mensaje: Mensaje, texto: string) {
  await escribiendo(mensaje.chat.id).catch(() => {});

  const respuesta = await fetch(`${URL_SUPABASE}/functions/v1/agente`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLAVE_SERVICIO}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      telegram_user_id: mensaje.from!.id,
      chat_id: mensaje.chat.id,
      texto,
    }),
  });

  if (!respuesta.ok) {
    console.error('El agente respondio', respuesta.status, await respuesta.text());
    await enviar(
      mensaje.chat.id,
      'No pude procesar eso ahora. Los comandos siguen andando: /ayuda',
    );
  }
}
