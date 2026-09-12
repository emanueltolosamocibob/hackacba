// =============================================================================
// Verifica el alta de usuarios desde el bot: invitaciones, canje por telefono
// verificado y por codigo, y los limites de quien puede hacer que.
//
// Es la frontera de quien entra a una flota, asi que se prueba tanto lo que
// tiene que funcionar como lo que tiene que fallar.
//
//   node --env-file=.env supabase/tests/verificar-alta.mjs
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON     = process.env.SUPABASE_ANON_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan variables. Correr con: node --env-file=.env supabase/tests/verificar-alta.mjs');
  process.exit(1);
}

let pasadas = 0;
const fallas = [];
const ok = (nombre, cond, detalle = '') => {
  if (cond) { pasadas++; console.log(`  \x1b[32mOK\x1b[0m   ${nombre}`); }
  else { fallas.push(nombre); console.log(`  \x1b[31mFALLA\x1b[0m ${nombre}${detalle ? ` -> ${detalle}` : ''}`); }
};
const seccion = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

async function api(ruta, { token, metodo = 'GET', cuerpo, prefer, servicio = false } = {}) {
  const cab = {
    apikey: servicio ? SERVICE : ANON,
    Authorization: `Bearer ${servicio ? SERVICE : token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) cab.Prefer = prefer;
  const r = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo, headers: cab,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { estado: r.status, ok: r.ok, datos: d };
}

const rest = (ruta, o) => api(`/rest/v1${ruta}`, o);
const rpc  = (fn, args, o) => api(`/rest/v1/rpc/${fn}`, { metodo: 'POST', cuerpo: args, ...o });

const esperar = ms => new Promise(r => setTimeout(r, ms));

// La API de Auth devuelve 429 y 504 esporadicos cuando se crean varios usuarios
// seguidos. Es infraestructura, no logica: se reintenta con espera creciente.
async function conReintento(etiqueta, fn, intentos = 4) {
  let ultimo;
  for (let i = 1; i <= intentos; i++) {
    const r = await fn();
    if (r.ok) return r;
    ultimo = r;
    if (r.estado < 500 && r.estado !== 429) break;
    await esperar(i * 1500);
  }
  throw new Error(`${etiqueta}: ${ultimo.estado} ${JSON.stringify(ultimo.datos)}`);
}

async function crearUsuario(email) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const alta = await conReintento(`crear ${email}`, () =>
    api('/auth/v1/admin/users', {
      metodo: 'POST', servicio: true,
      cuerpo: { email, password: clave, email_confirm: true },
    }));
  const ses = await conReintento(`login ${email}`, () =>
    api('/auth/v1/token?grant_type=password', {
      metodo: 'POST', token: ANON, cuerpo: { email, password: clave },
    }));
  return { id: alta.datos.id, email, token: ses.datos.access_token };
}

const sello = Date.now();
console.log(`\x1b[1mVerificacion del alta de usuarios contra ${URL_BASE}\x1b[0m`);

// ---------------------------------------------------------------- escenario

const duenoA = await crearUsuario(`alta-duenoa-${sello}@flota.test`);
const duenoB = await crearUsuario(`alta-duenob-${sello}@flota.test`);
// El administrativo invitado: el bot le crea la cuenta al vincularlo.
const invitado = await crearUsuario(`alta-admin-${sello}@flota.test`);

async function montar(u, nombre) {
  const orgId = crypto.randomUUID();
  const alta = await rest('/organizaciones', {
    token: u.token, metodo: 'POST', prefer: 'return=minimal',
    cuerpo: { id: orgId, nombre },
  });
  if (!alta.ok) throw new Error(`org: ${JSON.stringify(alta.datos)}`);
  return orgId;
}

const orgA = await montar(duenoA, `Alta A ${sello}`);
const orgB = await montar(duenoB, `Alta B ${sello}`);

// Numeros de prueba: el mismo numero escrito de tres formas distintas.
const TEL_CARGADO   = '+54 9 351 123-4567';   // como lo tipea el admin
const TEL_VERIFICADO = '5493511234567';       // como lo manda Telegram
const TG_ID = 900000000 + (sello % 1000000);
const CHAT  = TG_ID;

seccion('0. Normalizacion de telefonos');

// El prefijo 15 va en el MEDIO, despues del codigo de area: comparar por los
// ultimos digitos no alcanza. Esta tanda es la que detecto ese bug.
const VARIANTES = [
  ['+54 9 351 123-4567', '3511234567'],
  ['0351 15 123 4567',   '3511234567'],
  ['3511234567',         '3511234567'],
  ['351 15 1234567',     '3511234567'],
  ['00549 351 1234567',  '3511234567'],
  ['+54 11 4444 5555',   '1144445555'],
  ['011 15 4444 5555',   '1144445555'],
];

for (const [entrada, esperado] of VARIANTES) {
  const r = await rpc('clave_telefono', { p_telefono: entrada }, { servicio: true });
  ok(`"${entrada}" -> ${esperado}`, r.datos === esperado, `dio ${JSON.stringify(r.datos)}`);
}

seccion('1. Crear invitaciones');

const inv = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'administrador', p_telefono: TEL_CARGADO,
}, { token: duenoA.token });
ok('Un administrador puede invitar por telefono', inv.ok, JSON.stringify(inv.datos));
ok('Devuelve un codigo de 12 caracteres del alfabeto Crockford',
   /^[0-9A-HJKMNP-TV-Z]{12}$/.test(inv.datos?.codigo || ''), inv.datos?.codigo);

const propietario = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'propietario', p_telefono: '+5493519998888',
}, { token: duenoA.token });
ok('No se puede invitar como propietario', !propietario.ok, `estado ${propietario.estado}`);

const sinContacto = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'operador',
}, { token: duenoA.token });
ok('Exige telefono o email', !sinContacto.ok, `estado ${sinContacto.estado}`);

const ajena = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'operador', p_telefono: '+5493511110000',
}, { token: duenoB.token });
ok('B no puede invitar a la organizacion de A', !ajena.ok, `estado ${ajena.estado}`);

const duplicada = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'lector', p_telefono: '0351 15 123 4567',
}, { token: duenoA.token });
ok('No admite dos invitaciones pendientes para el mismo numero',
   !duplicada.ok, `estado ${duplicada.estado}`);

seccion('2. Quien puede canjear');

const canjeUsuario = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID, p_chat_id: CHAT,
}, { token: invitado.token });
ok('Un usuario autenticado no puede canjear por su cuenta',
   !canjeUsuario.ok, `estado ${canjeUsuario.estado}`);

const canjeAnon = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID, p_chat_id: CHAT,
}, { token: ANON });
ok('Un anonimo tampoco', !canjeAnon.ok, `estado ${canjeAnon.estado}`);

seccion('3. Canje por telefono verificado (lo hace el bot)');

const canje = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID, p_chat_id: CHAT, p_nombre_telegram: 'Admin Prueba',
}, { servicio: true });
ok('El bot canjea con service_role', canje.ok, JSON.stringify(canje.datos));
ok('"+54 9 351 123-4567" matchea con "5493511234567"',
   canje.datos?.organizacion_id === orgA, JSON.stringify(canje.datos));
ok('Queda con el rol de la invitacion', canje.datos?.rol === 'administrador', JSON.stringify(canje.datos));

const repetido = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID, p_chat_id: CHAT,
}, { servicio: true });
ok('La invitacion es de un solo uso', !repetido.ok, `estado ${repetido.estado}`);

const desconocido = await rpc('canjear_por_telefono', {
  p_telefono_verificado: '5493519999999', p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID + 1, p_chat_id: CHAT,
}, { servicio: true });
ok('Un numero sin invitacion no entra', !desconocido.ok, `estado ${desconocido.estado}`);

seccion('4. El invitado quedo adentro, y solo adentro');

const vistaInvitado = await rest('/organizaciones?select=id,nombre', { token: invitado.token });
ok('Ve la organizacion A', (vistaInvitado.datos || []).some(o => o.id === orgA),
   JSON.stringify(vistaInvitado.datos));
ok('No ve la organizacion B', !(vistaInvitado.datos || []).some(o => o.id === orgB));

const creaFlota = await rest('/flotas', {
  token: invitado.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: orgA, nombre: 'Flota nueva' },
});
ok('Como administrador ya puede crear flotas', creaFlota.ok, `estado ${creaFlota.estado}`);

seccion('5. vinculos_telegram no se expone');

const vinculoAnon = await rest('/vinculos_telegram?select=*', { token: ANON });
ok('anon no puede leer vinculos_telegram',
   !vinculoAnon.ok || (Array.isArray(vinculoAnon.datos) && vinculoAnon.datos.length === 0),
   `estado ${vinculoAnon.estado} ${JSON.stringify(vinculoAnon.datos)?.slice(0, 80)}`);

const vinculoUsuario = await rest('/vinculos_telegram?select=*', { token: invitado.token });
ok('un usuario autenticado tampoco',
   !vinculoUsuario.ok || (Array.isArray(vinculoUsuario.datos) && vinculoUsuario.datos.length === 0),
   `estado ${vinculoUsuario.estado}`);

seccion('6. Contexto del chat');

const ctx = await rpc('contexto_telegram', { p_telegram_user_id: TG_ID }, { servicio: true });
ok('Devuelve el vinculo', ctx.datos?.vinculado === true, JSON.stringify(ctx.datos));
ok('Con la organizacion activa correcta',
   ctx.datos?.organizacion_activa?.id === orgA, JSON.stringify(ctx.datos?.organizacion_activa));
ok('Y el rol', ctx.datos?.organizacion_activa?.rol === 'administrador');

const ctxDesconocido = await rpc('contexto_telegram', { p_telegram_user_id: 1 }, { servicio: true });
ok('Un chat sin vincular devuelve vinculado:false',
   ctxDesconocido.datos?.vinculado === false, JSON.stringify(ctxDesconocido.datos));

const ctxUsuario = await rpc('contexto_telegram', { p_telegram_user_id: TG_ID }, { token: invitado.token });
ok('contexto_telegram no es llamable por un usuario', !ctxUsuario.ok, `estado ${ctxUsuario.estado}`);

seccion('7. Cambio de organizacion activa');

const cambioIlegal = await rpc('cambiar_organizacion_activa', {
  p_telegram_user_id: TG_ID, p_organizacion_id: orgB,
}, { servicio: true });
ok('No puede activar una organizacion de la que no es miembro',
   !cambioIlegal.ok, `estado ${cambioIlegal.estado}`);

// Invitarlo tambien a B y verificar que ahi si puede cambiar.
const invB = await rpc('crear_invitacion', {
  p_organizacion_id: orgB, p_rol: 'lector', p_telefono: '+54 351 777 6666',
}, { token: duenoB.token });
await rpc('canjear_invitacion', {
  p_codigo: invB.datos.codigo, p_usuario_id: invitado.id,
  p_telegram_user_id: TG_ID, p_chat_id: CHAT,
}, { servicio: true });

const ctx2 = await rpc('contexto_telegram', { p_telegram_user_id: TG_ID }, { servicio: true });
ok('El canje por codigo tambien funciona',
   (ctx2.datos?.organizaciones || []).length === 2, JSON.stringify(ctx2.datos?.organizaciones));
ok('Y deja activa la organizacion recien canjeada',
   ctx2.datos?.organizacion_activa?.id === orgB);

const cambioValido = await rpc('cambiar_organizacion_activa', {
  p_telegram_user_id: TG_ID, p_organizacion_id: orgA,
}, { servicio: true });
ok('Puede volver a la organizacion A', cambioValido.ok, JSON.stringify(cambioValido.datos));

seccion('8. Desvincular');

const desv = await rpc('desvincular_telegram', { p_telegram_user_id: TG_ID }, { servicio: true });
ok('Desvincula el chat', desv.datos === true, JSON.stringify(desv.datos));

const ctx3 = await rpc('contexto_telegram', { p_telegram_user_id: TG_ID }, { servicio: true });
ok('El chat queda sin vinculo', ctx3.datos?.vinculado === false);

const sigueAdentro = await rest('/organizaciones?select=id', { token: invitado.token });
ok('Pero sigue siendo miembro: desvincular no es echar',
   (sigueAdentro.datos || []).length === 2, JSON.stringify(sigueAdentro.datos));

seccion('9. Las invitaciones son privadas de la organizacion');

const invisA = await rest('/invitaciones?select=codigo', { token: duenoA.token });
const invisB = await rest('/invitaciones?select=codigo', { token: duenoB.token });
ok('A ve solo las suyas', (invisA.datos || []).length === 1, JSON.stringify(invisA.datos?.length));
ok('B ve solo las suyas', (invisB.datos || []).length === 1, JSON.stringify(invisB.datos?.length));

const invisOperador = await rest('/invitaciones?select=codigo', { token: invitado.token });
ok('Un administrador de A ve las invitaciones de A y ninguna de B',
   (invisOperador.datos || []).length === (invisA.datos || []).length,
   JSON.stringify(invisOperador.datos?.length));

const inventada = await rest('/invitaciones', {
  token: duenoA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: orgA, codigo: 'AAAAAAAAAAAA', telefono: '+5493510000000', rol: 'administrador',
            expira_en: '2099-01-01T00:00:00Z' },
});
ok('Nadie puede insertar una invitacion con un codigo elegido a mano',
   !inventada.ok, `estado ${inventada.estado}`);

seccion('10. Alta de una organizacion nueva (el arranque real)');

const TEL_NUEVO = '+54 351 400 1234';

const noSistema = await rpc('registrar_organizacion', {
  p_nombre: 'Intento', p_telefono_admin: TEL_NUEVO,
}, { token: duenoA.token });
ok('Un usuario no puede registrar organizaciones', !noSistema.ok, `estado ${noSistema.estado}`);

const alta = await rpc('registrar_organizacion', {
  p_nombre: `Flota Nueva ${sello}`,
  p_telefono_admin: TEL_NUEVO,
  p_email_admin: `nuevo-${sello}@flota.test`,
  p_cuit: '30712345678',
}, { servicio: true });
ok('El servidor registra la organizacion', alta.ok, JSON.stringify(alta.datos));

const orgC = alta.datos?.organizacion_id;
ok('Emite una invitacion de propietario',
   alta.datos?.invitacion?.rol === 'propietario', JSON.stringify(alta.datos?.invitacion));

const catalogo = await rest(`/tipos_obligacion?select=codigo&organizacion_id=eq.${orgC}`, { servicio: true });
ok('Nace con el catalogo de Cordoba sembrado',
   (catalogo.datos || []).length === 6, JSON.stringify((catalogo.datos || []).length));

const avisosC = await rest(`/reglas_aviso?select=tipo_obligacion_id&organizacion_id=eq.${orgC}`, { servicio: true });
ok('Y con su regla de aviso general', (avisosC.datos || []).length === 1,
   JSON.stringify(avisosC.datos));

// El administrativo abre el bot y comparte su numero.
const nuevoAdmin = await crearUsuario(`alta-nuevo-${sello}@flota.test`);
const TG_NUEVO = TG_ID + 5000;

const canjeC = await rpc('canjear_por_telefono', {
  p_telefono_verificado: '543514001234',   // como lo manda Telegram, sin el 9
  p_usuario_id: nuevoAdmin.id,
  p_telegram_user_id: TG_NUEVO, p_chat_id: TG_NUEVO,
  p_nombre_telegram: 'Nuevo Admin',
}, { servicio: true });
ok('Entra compartiendo el numero', canjeC.ok, JSON.stringify(canjeC.datos));
ok('Y queda como propietario', canjeC.datos?.rol === 'propietario', JSON.stringify(canjeC.datos));

const suOrg = await rest('/organizaciones?select=id,nombre', { token: nuevoAdmin.token });
ok('Ve su organizacion y ninguna otra',
   (suOrg.datos || []).length === 1 && suOrg.datos[0].id === orgC,
   JSON.stringify(suOrg.datos));

const puedeInvitar = await rpc('crear_invitacion', {
  p_organizacion_id: orgC, p_telefono: '+5493515550000',
}, { token: nuevoAdmin.token });
ok('Como propietario ya puede invitar (por defecto, administrador)',
   puedeInvitar.ok && puedeInvitar.datos?.rol === 'administrador',
   JSON.stringify(puedeInvitar.datos));

// ------------------------------------------------------------------ limpieza

seccion('Limpieza');
for (const org of [orgA, orgB, orgC].filter(Boolean)) {
  const r = await rest(`/organizaciones?id=eq.${org}`, { metodo: 'DELETE', servicio: true });
  console.log(`  organizacion ${org.slice(0, 8)}: ${r.ok ? 'borrada' : 'quedo (' + r.estado + ')'}`);
}
for (const u of [duenoA, duenoB, invitado, nuevoAdmin].filter(Boolean)) {
  await api(`/auth/v1/admin/users/${u.id}`, { metodo: 'DELETE', servicio: true });
}
console.log('  usuarios de prueba borrados');

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(f => console.log(`  - ${f}`));
}
process.exit(fallas.length === 0 ? 0 : 1);
