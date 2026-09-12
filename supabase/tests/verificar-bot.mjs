// =============================================================================
// Verificacion del estado del bot (migracion 0016).
//
// Tres cosas que tienen que valer:
//
//   1. Nada de esto se ve desde afuera. Son tablas y funciones del servidor; si
//      un JWT de usuario las alcanza, el aislamiento del bot esta roto.
//   2. Una confirmacion es de un solo uso, de una sola persona y con
//      vencimiento. Es lo unico que separa "el agente propuso" de "se escribio".
//   3. avisos_pendientes resuelve el aviso, su vencimiento y sus destinatarios,
//      que es lo que el despachador da por hecho.
//
//   node --env-file=.env supabase/tests/verificar-bot.mjs
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON     = process.env.SUPABASE_ANON_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Correr con: node --env-file=.env supabase/tests/verificar-bot.mjs');
  process.exit(1);
}

let pasadas = 0;
const fallas = [];

function ok(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log(`  \x1b[32mOK\x1b[0m   ${nombre}`);
  } else {
    fallas.push(nombre);
    console.log(`  \x1b[31mFALLA\x1b[0m ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  }
}

const seccion = titulo => console.log(`\n\x1b[1m${titulo}\x1b[0m`);

async function api(ruta, { token, metodo = 'GET', cuerpo, prefer, servicio = false } = {}) {
  const cabeceras = {
    apikey: servicio ? SERVICE : ANON,
    Authorization: `Bearer ${servicio ? SERVICE : token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) cabeceras.Prefer = prefer;

  const r = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: r.status, ok: r.ok, datos };
}

const rest = (ruta, opciones) => api(`/rest/v1${ruta}`, opciones);
const rpc  = (fn, args, opciones) =>
  api(`/rest/v1/rpc/${fn}`, { metodo: 'POST', cuerpo: args, ...opciones });

async function crearUsuario(email) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const alta = await api('/auth/v1/admin/users', {
    metodo: 'POST', servicio: true,
    cuerpo: { email, password: clave, email_confirm: true },
  });
  if (!alta.ok) throw new Error(`No se pudo crear ${email}: ${JSON.stringify(alta.datos)}`);

  const sesion = await api('/auth/v1/token?grant_type=password', {
    metodo: 'POST', token: ANON, cuerpo: { email, password: clave },
  });
  if (!sesion.ok) throw new Error(`No se pudo autenticar ${email}: ${JSON.stringify(sesion.datos)}`);

  return { id: alta.datos.id, email, token: sesion.datos.access_token };
}

// ------------------------------------------------------------------ escenario

const sello = Date.now();
// Los ids de Telegram son de la persona, no de la base: se inventan dos que no
// van a chocar con nadie real.
const TG_DUENO = 900_000_000_000 + (sello % 1_000_000);
const TG_AJENO = TG_DUENO + 1;
const CHAT = TG_DUENO;

console.log(`\x1b[1mVerificacion del estado del bot contra ${URL_BASE}\x1b[0m`);

const dueno = await crearUsuario(`bot-dueno-${sello}@flota.test`);

const orgId = crypto.randomUUID();
{
  const alta = await rest('/organizaciones', {
    token: dueno.token, metodo: 'POST', prefer: 'return=minimal',
    cuerpo: { id: orgId, nombre: `Bot ${sello}` },
  });
  if (!alta.ok) throw new Error(`alta de organizacion: ${JSON.stringify(alta.datos)}`);
}

await rpc('sembrar_catalogo_cordoba', { p_organizacion_id: orgId }, { token: dueno.token });

const flotaId = crypto.randomUUID();
await rest('/flotas', {
  token: dueno.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { id: flotaId, organizacion_id: orgId, nombre: 'Flota bot' },
});

const vehiculoId = crypto.randomUUID();
await rest('/vehiculos', {
  token: dueno.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: vehiculoId, organizacion_id: orgId, flota_id: flotaId,
    dominio: 'BOT001', marca: 'Renault', modelo: 'Kangoo', anio: 2020,
  },
});

const tipos = await rest(`/tipos_obligacion?organizacion_id=eq.${orgId}&select=id,codigo`, {
  token: dueno.token,
});
const tipoId = tipos.datos[0].id;

const vencimientoId = crypto.randomUUID();
await rest('/vencimientos', {
  token: dueno.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: vencimientoId, organizacion_id: orgId, vehiculo_id: vehiculoId,
    tipo_obligacion_id: tipoId, periodo: '2026-03',
    fecha_vencimiento: '2026-03-15', monto_estimado: 45000,
  },
});

// El vinculo lo escribe normalmente canjear_por_telefono; aca se pone a mano
// porque lo que se prueba es lo que viene despues.
await rest('/vinculos_telegram', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    usuario_id: dueno.id, telegram_user_id: TG_DUENO, chat_id: CHAT,
    nombre_telegram: 'Prueba', organizacion_activa_id: orgId,
  },
});

// -------------------------------------------------------- 1. superficie cerrada

seccion('1. Nada de esto se ve desde afuera');

for (const tabla of ['acciones_pendientes', 'mensajes_conversacion']) {
  const anonimo = await rest(`/${tabla}?select=*`, { token: ANON });
  ok(`anon no puede leer ${tabla}`, !anonimo.ok || (anonimo.datos || []).length === 0,
     `estado ${anonimo.estado}`);

  const usuario = await rest(`/${tabla}?select=*`, { token: dueno.token });
  ok(`un usuario autenticado no puede leer ${tabla}`,
     !usuario.ok || (usuario.datos || []).length === 0, `estado ${usuario.estado}`);
}

const internas = [
  ['guardar_accion_pendiente', { p_telegram_user_id: TG_DUENO, p_chat_id: CHAT,
    p_organizacion_id: orgId, p_herramienta: 'registrar_pago', p_argumentos: {} }],
  ['tomar_accion_pendiente', { p_id: 'ZZZZZZZZZZZZ', p_telegram_user_id: TG_DUENO }],
  ['cancelar_accion_pendiente', { p_id: 'ZZZZZZZZZZZZ', p_telegram_user_id: TG_DUENO }],
  ['recordar_mensaje', { p_telegram_user_id: TG_DUENO, p_rol: 'usuario', p_contenido: 'hola' }],
  ['historial_conversacion', { p_telegram_user_id: TG_DUENO }],
  ['olvidar_conversacion', { p_telegram_user_id: TG_DUENO }],
  ['avisos_pendientes', { p_limite: 10 }],
];

for (const [nombre, argumentos] of internas) {
  const intento = await rpc(nombre, argumentos, { token: dueno.token });
  ok(`un usuario autenticado no puede llamar a ${nombre}`, !intento.ok,
     `estado ${intento.estado} ${JSON.stringify(intento.datos)}`);
}

// ------------------------------------------------------- 2. las confirmaciones

seccion('2. Una confirmacion es de un solo uso, de una sola persona y vence');

const guardar = (argumentos, minutos = 10) => rpc('guardar_accion_pendiente', {
  p_telegram_user_id: TG_DUENO,
  p_chat_id: CHAT,
  p_organizacion_id: orgId,
  p_herramienta: 'registrar_pago',
  p_argumentos: argumentos,
  p_minutos: minutos,
}, { servicio: true });

const primera = await guardar({ vencimiento_id: vencimientoId, monto: 45000 });
ok('guardar_accion_pendiente devuelve un codigo Crockford de 12',
   /^[0-9A-HJKMNP-TV-Z]{12}$/.test(primera.datos || ''), JSON.stringify(primera.datos));

const tomada = await rpc('tomar_accion_pendiente',
  { p_id: primera.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('tomarla devuelve la herramienta y sus argumentos intactos',
   tomada.datos?.herramienta === 'registrar_pago' &&
   tomada.datos?.argumentos?.monto === 45000 &&
   tomada.datos?.argumentos?.vencimiento_id === vencimientoId,
   JSON.stringify(tomada.datos));

const repetida = await rpc('tomar_accion_pendiente',
  { p_id: primera.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('la segunda vez ya no vale: un pago no se registra dos veces',
   repetida.datos === null, JSON.stringify(repetida.datos));

const deOtro = await guardar({ vencimiento_id: vencimientoId, monto: 100 });
const ajena = await rpc('tomar_accion_pendiente',
  { p_id: deOtro.datos, p_telegram_user_id: TG_AJENO }, { servicio: true });
ok('otra persona del grupo no puede apretar el boton ajeno',
   ajena.datos === null, JSON.stringify(ajena.datos));

const sigueViva = await rpc('tomar_accion_pendiente',
  { p_id: deOtro.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('y el dueno del boton todavia puede', sigueViva.datos !== null);

// Vencida: se inserta a mano porque la funcion no deja crear una en el pasado.
const idVencido = 'AAAAAAAAAAAA';
await rest('/acciones_pendientes', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: idVencido, organizacion_id: orgId, telegram_user_id: TG_DUENO, chat_id: CHAT,
    herramienta: 'registrar_pago', argumentos: { monto: 1 },
    expira_en: new Date(Date.now() - 60_000).toISOString(),
  },
});
const vencida = await rpc('tomar_accion_pendiente',
  { p_id: idVencido, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('una confirmacion vencida no se puede tomar', vencida.datos === null,
   JSON.stringify(vencida.datos));

const paraCancelar = await guardar({ vencimiento_id: vencimientoId, monto: 7 });
const cancelada = await rpc('cancelar_accion_pendiente',
  { p_id: paraCancelar.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('cancelar_accion_pendiente devuelve true la primera vez', cancelada.datos === true);

const trasCancelar = await rpc('tomar_accion_pendiente',
  { p_id: paraCancelar.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('lo cancelado ya no se puede confirmar', trasCancelar.datos === null,
   JSON.stringify(trasCancelar.datos));

const reCancelar = await rpc('cancelar_accion_pendiente',
  { p_id: paraCancelar.datos, p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('cancelar dos veces devuelve false', reCancelar.datos === false);

// ------------------------------------------------------------- 3. la memoria

seccion('3. La memoria de la conversacion');

const vacio = await rpc('historial_conversacion', { p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('sin nada dicho, el historial es una lista vacia',
   Array.isArray(vacio.datos) && vacio.datos.length === 0, JSON.stringify(vacio.datos));

for (const [rol, contenido] of [
  ['usuario', 'que vence esta semana'],
  ['asistente', 'Tenes dos vencimientos'],
  ['usuario', 'y el BOT001'],
]) {
  await rpc('recordar_mensaje',
    { p_telegram_user_id: TG_DUENO, p_rol: rol, p_contenido: contenido }, { servicio: true });
}

const historial = await rpc('historial_conversacion',
  { p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('el historial vuelve en orden cronologico, no al reves',
   historial.datos?.length === 3 &&
   historial.datos[0].contenido === 'que vence esta semana' &&
   historial.datos[2].contenido === 'y el BOT001',
   JSON.stringify(historial.datos));

// Una charla de hace horas no es la misma charla.
await rest('/mensajes_conversacion', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    telegram_user_id: TG_DUENO, rol: 'usuario', contenido: 'esto fue anteayer',
    creado_en: new Date(Date.now() - 48 * 3600_000).toISOString(),
  },
});
const conVentana = await rpc('historial_conversacion',
  { p_telegram_user_id: TG_DUENO, p_maximo: 20, p_minutos: 60 }, { servicio: true });
ok('la ventana de tiempo deja afuera lo viejo',
   !(conVentana.datos || []).some(m => m.contenido === 'esto fue anteayer'),
   JSON.stringify(conVentana.datos));

// La poda: se cargan 25 y se escribe uno mas, que dispara el recorte a 20.
await rest('/mensajes_conversacion', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: Array.from({ length: 25 }, (_, i) => ({
    telegram_user_id: TG_DUENO, rol: 'usuario', contenido: `relleno ${i}`,
  })),
});
await rpc('recordar_mensaje',
  { p_telegram_user_id: TG_DUENO, p_rol: 'usuario', p_contenido: 'el ultimo' }, { servicio: true });

const guardados = await rest(
  `/mensajes_conversacion?select=id&telegram_user_id=eq.${TG_DUENO}`, { servicio: true });
ok('la memoria se poda sola a 20 mensajes', (guardados.datos || []).length === 20,
   `quedaron ${(guardados.datos || []).length}`);

await rpc('olvidar_conversacion', { p_telegram_user_id: TG_DUENO }, { servicio: true });
const olvidado = await rpc('historial_conversacion',
  { p_telegram_user_id: TG_DUENO }, { servicio: true });
ok('olvidar_conversacion la vacia', (olvidado.datos || []).length === 0);

// ------------------------------------------------------------- 4. los avisos

seccion('4. Lo que el despachador da por hecho');

// Fecha vieja a proposito: avisos_pendientes ordena por programado_para, y asi
// este queda primero aunque la base tenga la cola de la demo.
await rest('/avisos', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    organizacion_id: orgId, vencimiento_id: vencimientoId,
    clave_regla: 'd-7', programado_para: '2000-01-01', canal: 'telegram',
  },
});

const pendientes = await rpc('avisos_pendientes', { p_limite: 5 }, { servicio: true });
const mio = (pendientes.datos || []).find(a => a.vencimiento?.id === vencimientoId);

ok('avisos_pendientes trae el aviso con su vencimiento resuelto',
   mio?.vencimiento?.dominio === 'BOT001' && mio?.vencimiento?.periodo === '2026-03',
   JSON.stringify(mio?.vencimiento));

ok('y con estado_efectivo y dias_para_vencer, que la vista ya calcula',
   typeof mio?.vencimiento?.estado_efectivo === 'string' &&
   typeof mio?.vencimiento?.dias_para_vencer === 'number',
   JSON.stringify(mio?.vencimiento));

ok('y con el chat del miembro vinculado, sin que el bot lo busque',
   Array.isArray(mio?.destinatarios) && mio.destinatarios.includes(CHAT),
   JSON.stringify(mio?.destinatarios));

ok('y con el nombre de la organizacion para firmar el mensaje',
   typeof mio?.organizacion === 'string' && mio.organizacion.startsWith('Bot '),
   JSON.stringify(mio?.organizacion));

await rest(`/avisos?vencimiento_id=eq.${vencimientoId}`, {
  servicio: true, metodo: 'PATCH',
  cuerpo: { enviado_en: new Date().toISOString(), exito: true, destinatario: String(CHAT) },
});

const trasDespachar = await rpc('avisos_pendientes', { p_limite: 5 }, { servicio: true });
ok('un aviso ya marcado no vuelve a salir en la cola',
   !(trasDespachar.datos || []).some(a => a.vencimiento?.id === vencimientoId));

// -------------------------------------------------------------------- limpieza

seccion('Limpieza');

for (const tabla of ['acciones_pendientes', 'mensajes_conversacion']) {
  const r = await rest(`/${tabla}?telegram_user_id=eq.${TG_DUENO}`, {
    metodo: 'DELETE', servicio: true,
  });
  console.log(`  ${tabla}: ${r.ok ? 'limpia' : 'quedo (' + r.estado + ')'}`);
}

{
  const r = await rest(`/vinculos_telegram?telegram_user_id=eq.${TG_DUENO}`, {
    metodo: 'DELETE', servicio: true,
  });
  console.log(`  vinculo de telegram: ${r.ok ? 'borrado' : 'quedo (' + r.estado + ')'}`);
}

{
  const r = await rest(`/organizaciones?id=eq.${orgId}`, { metodo: 'DELETE', servicio: true });
  console.log(`  organizacion: ${r.ok ? 'borrada' : 'quedo (' + r.estado + ')'}`);
}

{
  const r = await api(`/auth/v1/admin/users/${dueno.id}`, { metodo: 'DELETE', servicio: true });
  console.log(`  usuario ${dueno.email}: ${r.ok ? 'borrado' : 'quedo (' + r.estado + ')'}`);
}

// -------------------------------------------------------------------- resumen

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(f => console.log(`  - ${f}`));
}
process.exit(fallas.length === 0 ? 0 : 1);
