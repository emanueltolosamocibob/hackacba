// =============================================================================
// Verifica el camino Realtime completo:
//
//   cambio en vencimientos -> trigger -> recalcular_resumen_flota
//     -> realtime.send() en el canal privado 'flota:<id>' -> suscriptor
//
// Comprueba tambien la autorizacion del canal: un usuario de otra organizacion
// NO debe recibir el mensaje.
//
//   node --env-file=.env supabase/tests/verificar-realtime.mjs
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL;
const ANON     = process.env.SUPABASE_ANON_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan variables. Correr con: node --env-file=.env supabase/tests/verificar-realtime.mjs');
  process.exit(1);
}

let pasadas = 0;
const fallas = [];
const ok = (nombre, cond, detalle = '') => {
  if (cond) { pasadas++; console.log(`  \x1b[32mOK\x1b[0m   ${nombre}`); }
  else { fallas.push(nombre); console.log(`  \x1b[31mFALLA\x1b[0m ${nombre}${detalle ? ` -> ${detalle}` : ''}`); }
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

async function nuevoUsuario(email) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: clave, email_confirm: true,
  });
  if (error) throw new Error(`crear ${email}: ${error.message}`);

  const cliente = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data: sesion, error: e2 } = await cliente.auth.signInWithPassword({ email, password: clave });
  if (e2) throw new Error(`login ${email}: ${e2.message}`);

  await cliente.realtime.setAuth(sesion.session.access_token);

  // Suscribirse antes de que el websocket este conectado devuelve
  // CHANNEL_ERROR aunque la politica del canal sea correcta.
  cliente.realtime.connect();
  for (let i = 0; i < 100 && !cliente.realtime.isConnected(); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (!cliente.realtime.isConnected()) {
    throw new Error(`El websocket de ${email} no conecto en 10s`);
  }

  return { id: data.user.id, email, cliente };
}

// Espera un broadcast en el canal, con limite de tiempo.
function esperarBroadcast(cliente, topico, evento, ms) {
  return new Promise(resolve => {
    const canal = cliente.channel(topico, { config: { private: true } });
    const reloj = setTimeout(() => { cliente.removeChannel(canal); resolve(null); }, ms);

    canal
      .on('broadcast', { event: evento }, ({ payload }) => {
        clearTimeout(reloj);
        cliente.removeChannel(canal);
        resolve(payload);
      })
      .subscribe();
  });
}

function suscrito(cliente, topico) {
  return new Promise(resolve => {
    const canal = cliente.channel(topico, { config: { private: true } });
    const reloj = setTimeout(() => resolve({ canal, estado: 'TIMEOUT' }), 10000);
    canal.subscribe(estado => {
      if (estado === 'SUBSCRIBED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
        clearTimeout(reloj);
        resolve({ canal, estado });
      }
    });
  });
}

const sello = Date.now();
console.log(`\x1b[1mVerificacion de Realtime contra ${URL_BASE}\x1b[0m\n`);

const usuarioA = await nuevoUsuario(`rt-a-${sello}@flota.test`);
const usuarioB = await nuevoUsuario(`rt-b-${sello}@flota.test`);

// ---- Montaje ---------------------------------------------------------------

async function montar(u, nombre, dominio) {
  const orgId = crypto.randomUUID();
  const flotaId = crypto.randomUUID();
  const vehiculoId = crypto.randomUUID();

  await u.cliente.from('organizaciones').insert({ id: orgId, nombre });
  await u.cliente.rpc('sembrar_catalogo_cordoba', { p_organizacion_id: orgId });
  await u.cliente.from('flotas').insert({ id: flotaId, organizacion_id: orgId, nombre: 'Principal' });
  await u.cliente.from('vehiculos').insert({
    id: vehiculoId, organizacion_id: orgId, flota_id: flotaId, dominio,
  });

  const { data: tipos } = await u.cliente
    .from('tipos_obligacion').select('id, codigo').eq('organizacion_id', orgId);

  return { orgId, flotaId, vehiculoId, tipos: Object.fromEntries(tipos.map(t => [t.codigo, t.id])) };
}

const a = await montar(usuarioA, `RT A ${sello}`, 'RTA111');
const b = await montar(usuarioB, `RT B ${sello}`, 'RTB222');

console.log('1. Autorizacion del canal privado');

const canalPropio = await suscrito(usuarioA.cliente, `flota:${a.flotaId}`);
ok('A se suscribe al canal de su propia flota', canalPropio.estado === 'SUBSCRIBED', canalPropio.estado);
usuarioA.cliente.removeChannel(canalPropio.canal);

const canalAjeno = await suscrito(usuarioB.cliente, `flota:${a.flotaId}`);
ok('B NO puede suscribirse al canal de la flota de A',
   canalAjeno.estado !== 'SUBSCRIBED', canalAjeno.estado);
usuarioB.cliente.removeChannel(canalAjeno.canal);

console.log('\n2. El cambio en la base llega como broadcast');

const escucha = esperarBroadcast(usuarioA.cliente, `flota:${a.flotaId}`, 'resumen_actualizado', 15000);
await new Promise(r => setTimeout(r, 2500));  // dar tiempo a que la suscripcion se establezca

const { error: errVenc } = await usuarioA.cliente.from('vencimientos').insert({
  organizacion_id: a.orgId,
  vehiculo_id: a.vehiculoId,
  tipo_obligacion_id: a.tipos.impuesto_automotor_pcial,
  periodo: '2026-10',
  fecha_vencimiento: '2026-10-15',
  monto_estimado: 48000,
});
ok('Se inserta el vencimiento que dispara el trigger', !errVenc, errVenc?.message);

const carga = await escucha;
ok('Llega el broadcast resumen_actualizado', carga !== null,
   'no llego en 15s');

if (carga) {
  const cuerpo = carga.payload ?? carga;
  ok('El payload trae el resumen compacto, no la fila cruda',
     cuerpo.flota_id === a.flotaId && 'cantidad_pendientes' in cuerpo,
     JSON.stringify(cuerpo));
  ok('El resumen refleja el vencimiento recien creado',
     Number(cuerpo.monto_por_vencer_30d ?? 0) > 0 || Number(cuerpo.cantidad_pendientes ?? 0) > 0,
     JSON.stringify(cuerpo));
  console.log(`       payload: ${JSON.stringify(cuerpo)}`);
}

console.log('\n3. Limpieza');
for (const orgId of [a.orgId, b.orgId]) {
  const { error } = await admin.from('organizaciones').delete().eq('id', orgId);
  console.log(`  organizacion ${orgId.slice(0, 8)}: ${error ? 'quedo (' + error.message + ')' : 'borrada'}`);
}
for (const u of [usuarioA, usuarioB]) {
  await admin.auth.admin.deleteUser(u.id);
  usuarioA.cliente.realtime.disconnect();
  console.log(`  usuario ${u.email}: borrado`);
}
usuarioB.cliente.realtime.disconnect();

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(f => console.log(`  - ${f}`));
}
process.exit(fallas.length === 0 ? 0 : 1);
