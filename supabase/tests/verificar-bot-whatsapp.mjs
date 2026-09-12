// =============================================================================
// Verifica las RPC del bot de WhatsApp (migracion 0020): contexto de chat,
// alta/reactivacion de dominio, listado de flota y deduplicacion de mensajes.
// Todo se crea con service_role y se limpia aunque falle una prueba.
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan variables. Correr con: node --env-file=.env supabase/tests/verificar-bot-whatsapp.mjs');
  process.exit(1);
}

let pasadas = 0;
const fallas = [];
const organizacionesCreadas = [];
const usuariosCreados = [];

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
  const respuesta = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: respuesta.status, ok: respuesta.ok, datos };
}

const rpc = (funcion, argumentos, opciones) => api(`/rest/v1/rpc/${funcion}`, {
  metodo: 'POST', cuerpo: argumentos, servicio: true, ...opciones,
});

async function crearUsuario(telefono) {
  const email = `bot-wa-${crypto.randomUUID()}@ejemplo.test`;
  const alta = await api('/auth/v1/admin/users', {
    metodo: 'POST',
    servicio: true,
    cuerpo: {
      email,
      password: `Prueba-${crypto.randomUUID()}`,
      email_confirm: true,
      phone: telefono,
      phone_confirm: true,
    },
  });
  if (!alta.ok) throw new Error(`crear usuario: ${alta.estado} ${JSON.stringify(alta.datos)}`);
  usuariosCreados.push(alta.datos.id);
  return alta.datos.id;
}

async function crearOrganizacionConMiembro(usuarioId) {
  const org = await api('/rest/v1/organizaciones', {
    metodo: 'POST', servicio: true, prefer: 'return=representation',
    cuerpo: { nombre: `Flota de prueba ${crypto.randomUUID()}` },
  });
  if (!org.ok) throw new Error(`crear organizacion: ${org.estado} ${JSON.stringify(org.datos)}`);
  const organizacionId = org.datos[0].id;
  organizacionesCreadas.push(organizacionId);

  const miembro = await api('/rest/v1/miembros', {
    metodo: 'POST', servicio: true,
    cuerpo: { organizacion_id: organizacionId, usuario_id: usuarioId, rol: 'administrador' },
  });
  if (!miembro.ok) throw new Error(`crear miembro: ${miembro.estado} ${JSON.stringify(miembro.datos)}`);
  return organizacionId;
}

async function vincularChat(usuarioId, telefono, organizacionId) {
  const clave = telefono.replace(/\D/g, '').slice(-10);
  const vinculo = await api('/rest/v1/vinculos_chat', {
    metodo: 'POST', servicio: true,
    cuerpo: {
      usuario_id: usuarioId,
      canal: 'whatsapp',
      identificador_externo: `${clave}@whatsapp`,
      telefono,
      organizacion_activa_id: organizacionId,
    },
  });
  if (!vinculo.ok) throw new Error(`vincular chat: ${vinculo.estado} ${JSON.stringify(vinculo.datos)}`);
}

async function limpiar() {
  for (const id of usuariosCreados) {
    await api(`/auth/v1/admin/users/${id}`, { metodo: 'DELETE', servicio: true });
  }
  for (const id of organizacionesCreadas) {
    await api(`/rest/v1/organizaciones?id=eq.${id}`, { metodo: 'DELETE', servicio: true });
  }
}

async function principal() {
  seccion('contexto_chat_whatsapp');

  const numeroDesconocido = '+5493511111111';
  const vacio = await rpc('contexto_chat_whatsapp', { p_telefono: numeroDesconocido });
  ok('numero no dado de alta devuelve vacio', vacio.ok && Array.isArray(vacio.datos) && vacio.datos.length === 0,
    JSON.stringify(vacio.datos));

  const telefono = '+5493516000001';
  const usuarioId = await crearUsuario(telefono);
  const organizacionId = await crearOrganizacionConMiembro(usuarioId);
  await vincularChat(usuarioId, telefono, organizacionId);

  const contexto = await rpc('contexto_chat_whatsapp', { p_telefono: telefono });
  ok('numero registrado devuelve la organizacion', contexto.ok && contexto.datos?.[0]?.organizacion_id === organizacionId,
    JSON.stringify(contexto.datos));
  ok('numero recien vinculado no tiene ultimo_dominio', contexto.ok && contexto.datos?.[0]?.ultimo_dominio === null,
    JSON.stringify(contexto.datos));

  seccion('registrar_dominio_chat');

  const nuevo = await rpc('registrar_dominio_chat', { p_organizacion_id: organizacionId, p_dominio: 'ab123cd', p_telefono: telefono });
  ok('dominio nuevo se crea y normaliza', nuevo.ok && nuevo.datos?.[0]?.es_nuevo === true, JSON.stringify(nuevo.datos));
  const vehiculoId = nuevo.datos?.[0]?.vehiculo_id;

  const contextoConDominio = await rpc('contexto_chat_whatsapp', { p_telefono: telefono });
  ok('registrar_dominio_chat actualiza ultimo_dominio del chat',
    contextoConDominio.ok && contextoConDominio.datos?.[0]?.ultimo_dominio === 'AB123CD',
    JSON.stringify(contextoConDominio.datos));

  const repetido = await rpc('registrar_dominio_chat', { p_organizacion_id: organizacionId, p_dominio: 'AB 123 CD' });
  ok('dominio repetido no crea otra fila', repetido.ok && repetido.datos?.[0]?.vehiculo_id === vehiculoId
    && repetido.datos?.[0]?.es_nuevo === false, JSON.stringify(repetido.datos));

  const invalido = await rpc('registrar_dominio_chat', { p_organizacion_id: organizacionId, p_dominio: '1234' });
  ok('dominio invalido se rechaza', !invalido.ok, JSON.stringify(invalido.datos));

  const hoy = new Date().toISOString().slice(0, 10);
  const baja = await api(`/rest/v1/vehiculos?id=eq.${vehiculoId}`, {
    metodo: 'PATCH', servicio: true, prefer: 'return=representation',
    cuerpo: { estado: 'inactivo', fecha_baja: hoy },
  });
  const fechaAltaOriginal = baja.datos?.[0]?.fecha_alta;

  const reactivado = await rpc('registrar_dominio_chat', { p_organizacion_id: organizacionId, p_dominio: 'AB123CD' });
  const vehiculoTrasReactivar = await api(`/rest/v1/vehiculos?id=eq.${vehiculoId}&select=estado,fecha_alta,fecha_baja`, { servicio: true });
  ok('dominio inactivo se reactiva sin reescribir fecha_alta',
    reactivado.ok
    && vehiculoTrasReactivar.datos?.[0]?.estado === 'activo'
    && vehiculoTrasReactivar.datos?.[0]?.fecha_baja === null
    && vehiculoTrasReactivar.datos?.[0]?.fecha_alta === fechaAltaOriginal,
    JSON.stringify(vehiculoTrasReactivar.datos));

  seccion('dominios_de_chat');

  const listado = await rpc('dominios_de_chat', { p_organizacion_id: organizacionId });
  const dominiosListados = (listado.datos ?? []).map(fila => fila.dominio);
  ok('lista solo dominios activos', listado.ok && dominiosListados.includes('AB123CD'), JSON.stringify(listado.datos));

  seccion('marcar_mensaje_procesado');

  const idMensaje = `mensaje-${crypto.randomUUID()}`;
  const primeraVez = await rpc('marcar_mensaje_procesado', { p_id: idMensaje });
  ok('primera vez devuelve true', primeraVez.ok && primeraVez.datos === true, JSON.stringify(primeraVez.datos));

  const segundaVez = await rpc('marcar_mensaje_procesado', { p_id: idMensaje });
  ok('reintento devuelve false', segundaVez.ok && segundaVez.datos === false, JSON.stringify(segundaVez.datos));

  seccion('permisos');

  const sinService = await api('/rest/v1/rpc/contexto_chat_whatsapp', {
    metodo: 'POST', cuerpo: { p_telefono: telefono }, token: ANON,
  });
  ok('anon no puede llamar contexto_chat_whatsapp', !sinService.ok, JSON.stringify(sinService.datos));

  await limpiar();

  seccion('Resultado');
  console.log(`  ${pasadas} pruebas OK, ${fallas.length} fallas.`);
  if (fallas.length > 0) {
    console.log(`  Fallaron: ${fallas.join(', ')}`);
    process.exit(1);
  }
}

principal().catch(async error => {
  console.error('\x1b[31mError inesperado:\x1b[0m', error.message);
  await limpiar().catch(() => {});
  process.exit(1);
});
