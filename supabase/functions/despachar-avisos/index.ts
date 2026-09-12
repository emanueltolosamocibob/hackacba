// =============================================================================
// Despacho de la cola de avisos.
//
// La base ya decidio a quien avisar y cuando: pg_cron corre tarea_diaria() a
// las 11:00 UTC (08:00 en Cordoba) y encola en `avisos`. Esta funcion solo
// reparte, y se dispara poco despues. Ver README para el cron que la llama.
//
// Dos cosas que importan mas de lo que parecen:
//
//   1. **Marcar siempre**, tambien lo que fallo. Un aviso que nunca se marca se
//      reintenta para siempre, y el proximo despacho arrastra la misma cola mas
//      grande. Por eso hasta "no hay a quien avisarle" se escribe como fallo
//      con su motivo.
//
//   2. **Un mensaje por chat, no por aviso.** El primero de mes puede haber
//      cuarenta cuotas de la misma flota; cuarenta mensajes seguidos son una
//      notificacion inutil y ademas chocan contra el limite de Telegram de un
//      mensaje por segundo por chat.
// =============================================================================

import { servicio } from '../_compartido/rest.ts';
import { boton, enviar, escapar, type Teclado } from '../_compartido/telegram.ts';
import { codigoCorto, fecha, importe, partir } from '../_compartido/formato.ts';

interface AvisoPendiente {
  aviso_id: number;
  clave_regla: string;
  programado_para: string;
  organizacion_id: string;
  organizacion: string;
  vencimiento: {
    id: string;
    dominio: string;
    tipo: string;
    periodo: string;
    fecha_vencimiento: string;
    monto: number | null;
    moneda: string;
    estado_efectivo: string;
    dias_para_vencer: number;
  };
  destinatarios: number[];
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * El encabezado cambia con la clave_regla: no es lo mismo "vence en 30 dias"
 * que "vencio hace una semana", y usar el mismo tono para los dos hace que se
 * ignoren los dos.
 */
function encabezado(clave: string, dias: number): string {
  if (clave.startsWith('d+') || dias < 0) {
    const cuantos = Math.abs(dias);
    return cuantos === 1 ? 'Vencio ayer y sigue impago' : `Vencio hace ${cuantos} dias y sigue impago`;
  }
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence manana';
  return `Vence en ${dias} dias`;
}

function componer(avisos: AvisoPendiente[]): { texto: string; teclado?: Teclado } {
  const organizacion = avisos[0].organizacion;

  if (avisos.length === 1) {
    const a = avisos[0];
    const v = a.vencimiento;
    const texto =
      `<b>${encabezado(a.clave_regla, v.dias_para_vencer)}</b>\n\n` +
      `${escapar(v.dominio)} - ${escapar(v.tipo)} ${escapar(v.periodo)}\n` +
      `${importe(v.monto, v.moneda)} - ${fecha(v.fecha_vencimiento)}\n` +
      `<i>${escapar(organizacion)}</i>`;

    return {
      texto,
      teclado: {
        inline_keyboard: [[
          boton('Ver link de pago', `link:${v.id}`),
          boton('Registrar pago', `pagar:${v.id}`),
        ]],
      },
    };
  }

  // Ordenar por fecha pone lo vencido arriba, que es lo que hay que mirar.
  const ordenados = [...avisos].sort(
    (a, b) => a.vencimiento.dias_para_vencer - b.vencimiento.dias_para_vencer,
  );

  const total = ordenados.reduce((suma, a) => suma + Number(a.vencimiento.monto ?? 0), 0);
  const vencidos = ordenados.filter(a => a.vencimiento.dias_para_vencer < 0).length;

  const lineas = ordenados.map(a => {
    const v = a.vencimiento;
    const cuando = encabezado(a.clave_regla, v.dias_para_vencer).toLowerCase();
    return (
      `<code>${codigoCorto(v.id)}</code> <b>${escapar(v.dominio)}</b> ${escapar(v.tipo)} ${escapar(v.periodo)}\n` +
      `      ${importe(v.monto, v.moneda)} - ${fecha(v.fecha_vencimiento)} - ${cuando}`
    );
  });

  const resumen = vencidos > 0
    ? `${ordenados.length} obligacion(es) para mirar, ${vencidos} ya vencida(s)`
    : `${ordenados.length} obligacion(es) por vencer`;

  return {
    texto:
      `<b>${resumen}</b>\n<i>${escapar(organizacion)}</i>\n\n` +
      lineas.join('\n') +
      `\n\nTotal: ${importe(total)}\nPara pagar una: <code>/pagar ${codigoCorto(ordenados[0].vencimiento.id)}</code>`,
  };
}

async function marcar(ids: number[], exito: boolean, destinatario: string | null, error?: string) {
  if (ids.length === 0) return;
  await servicio.rest(`/avisos?id=in.(${ids.join(',')})`, {
    metodo: 'PATCH',
    cuerpo: {
      enviado_en: new Date().toISOString(),
      exito,
      destinatario,
      error: error ?? null,
    },
  });
}

async function despachar(limite: number) {
  const pendientes = await servicio.rpc<AvisoPendiente[]>('avisos_pendientes', {
    p_limite: limite,
  });

  if (pendientes.length === 0) return { avisos: 0, chats: 0, fallidos: 0 };

  const porChat = new Map<number, AvisoPendiente[]>();
  for (const aviso of pendientes) {
    for (const chatId of aviso.destinatarios) {
      const lista = porChat.get(chatId) ?? [];
      lista.push(aviso);
      porChat.set(chatId, lista);
    }
  }

  const entregados = new Map<number, number[]>();
  const errores = new Map<number, string>();

  for (const [chatId, avisos] of porChat) {
    try {
      const { texto, teclado } = componer(avisos);
      const partes = partir(texto);

      for (const [i, parte] of partes.entries()) {
        // Telegram admite ~1 mensaje por segundo por chat. Solo hace falta
        // esperar entre partes del mismo chat; entre chats distintos rige el
        // limite global, de ~30 por segundo.
        if (i > 0) await dormir(1100);
        await enviar(chatId, parte, { teclado: i === partes.length - 1 ? teclado : undefined });
      }

      for (const a of avisos) {
        entregados.set(a.aviso_id, [...(entregados.get(a.aviso_id) ?? []), chatId]);
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`Fallo el aviso al chat ${chatId}:`, detalle);
      for (const a of avisos) errores.set(a.aviso_id, detalle.slice(0, 400));
    }

    await dormir(60);
  }

  // Se marca despues de recorrer todos los chats y no en el medio, porque un
  // aviso puede ir a varios: si se marcara por chat, el que fallo pisaria al
  // que salio bien y el proximo despacho lo mandaria de nuevo al primero.
  // Alcanza con que haya llegado a alguien para darlo por entregado.
  const grupos = new Map<string, { ids: number[]; exito: boolean; destinatario: string | null; error: string | null }>();

  for (const aviso of pendientes) {
    const chats = entregados.get(aviso.aviso_id) ?? [];
    const error = aviso.destinatarios.length === 0
      ? 'La organizacion no tiene ningun Telegram vinculado'
      : errores.get(aviso.aviso_id) ?? null;

    const grupo = {
      exito: chats.length > 0,
      destinatario: chats.length > 0 ? chats.join(',') : null,
      error: chats.length > 0 ? null : error,
    };

    const clave = `${grupo.exito}|${grupo.destinatario}|${grupo.error}`;
    const acumulado = grupos.get(clave) ?? { ...grupo, ids: [] };
    acumulado.ids.push(aviso.aviso_id);
    grupos.set(clave, acumulado);
  }

  let fallidos = 0;
  for (const g of grupos.values()) {
    await marcar(g.ids, g.exito, g.destinatario, g.error ?? undefined);
    if (!g.exito) fallidos += g.ids.length;
  }

  return { avisos: pendientes.length, chats: porChat.size, fallidos };
}

Deno.serve(async (peticion) => {
  const url = new URL(peticion.url);
  const limite = Math.min(Number(url.searchParams.get('limite') ?? '200'), 500);

  try {
    const resultado = await despachar(limite);
    console.log('Despacho de avisos:', resultado);
    return Response.json(resultado);
  } catch (error) {
    console.error('El despacho fallo entero:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
});
