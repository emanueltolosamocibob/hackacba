// =============================================================================
// Verifica el alta de usuarios desde el bot: invitaciones, canje por telefono
// verificado y por codigo, y los limites de quien puede hacer que. El vinculo
// es neutral por canal: esta bateria usa WhatsApp, no objetos de Telegram.
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
const organizacionesCreadas = [];
const usuariosCreados = [];

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

async function crearUsuario(email, telefono = null) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const alta = await conReintento(`crear ${email}`, () =>
    api('/auth/v1/admin/users', {
      metodo: 'POST', servicio: true,
      cuerpo: {
        email, password: clave, email_confirm: true,
        ...(telefono ? { phone: telefono, phone_confirm: true } : {}),
      },
    }));
  usuariosCreados.push({ id: alta.datos.id, email });
  const ses = await conReintento(`login ${email}`, () =>
    api('/auth/v1/token?grant_type=password', {
      metodo: 'POST', token: ANON, cuerpo: { email, password: clave },
    }));
  return { id: alta.datos.id, email, token: ses.datos.access_token };
}

const sello = Date.now();
console.log(`\x1b[1mVerificacion del alta de usuarios contra ${URL_BASE}\x1b[0m`);

const sufijoTelefono = String(sello).slice(-7);
const telefonoPrueba = indice => `+549${String(300 + indice).slice(-3)}${sufijoTelefono}`;
const identificadorDe = telefono => `${telefono.replace(/^\+549/, '')}@whatsapp`;
const codigoPrueba = indice => `${String(sello).slice(-10)}${String(indice).padStart(2, '0')}`;

const TEL_CARGADO = '+54 9 351 123-4567';
const TEL_VERIFICADO = '+5493511234567';
const CANAL = 'whatsapp';
const IDENTIFICADOR = '3511234567@whatsapp';

// ---------------------------------------------------------------- escenario

try {
const duenoA = await crearUsuario(`alta-duenoa-${sello}@flota.test`);
const duenoB = await crearUsuario(`alta-duenob-${sello}@flota.test`);
// El administrativo invitado: el bot le crea la cuenta al vincularlo.
const invitado = await crearUsuario(`alta-admin-${sello}@flota.test`, TEL_VERIFICADO);

async function montar(u, nombre) {
  const orgId = crypto.randomUUID();
  const alta = await rest('/organizaciones', {
    token: u.token, metodo: 'POST', prefer: 'return=minimal',
    cuerpo: { id: orgId, nombre },
  });
  if (!alta.ok) throw new Error(`org: ${JSON.stringify(alta.datos)}`);
  organizacionesCreadas.push(orgId);
  return orgId;
}

const orgA = await montar(duenoA, `Alta A ${sello}`);
const orgB = await montar(duenoB, `Alta B ${sello}`);

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

const propietarioSistema = await rpc('crear_invitacion', {
  p_organizacion_id: orgA, p_rol: 'propietario', p_telefono: '+5493519997777',
}, { servicio: true });
ok('Ni el servidor puede emitir una invitacion pendiente de propietario',
   !propietarioSistema.ok, `estado ${propietarioSistema.estado}`);

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
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { token: invitado.token });
ok('Un usuario autenticado no puede canjear por su cuenta',
   !canjeUsuario.ok, `estado ${canjeUsuario.estado}`);

const canjeAnon = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { token: ANON });
ok('Un anonimo tampoco', !canjeAnon.ok, `estado ${canjeAnon.estado}`);

seccion('3. Canje por telefono verificado (lo hace el bot)');

const canje = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR, p_nombre_mostrado: 'Admin Prueba',
}, { servicio: true });
ok('El bot canjea con service_role', canje.ok, JSON.stringify(canje.datos));
ok('"+54 9 351 123-4567" matchea con "5493511234567"',
   canje.datos?.organizacion_id === orgA, JSON.stringify(canje.datos));
ok('Queda con el rol de la invitacion', canje.datos?.rol === 'administrador', JSON.stringify(canje.datos));

const vinculoCanonico = await rest(
  `/vinculos_chat?select=identificador_externo,jid_crudo,nombre_mostrado&usuario_id=eq.${invitado.id}`,
  { servicio: true },
);
ok('El identificador canonico no se copia al JID crudo',
   vinculoCanonico.datos?.[0]?.identificador_externo === IDENTIFICADOR
     && vinculoCanonico.datos?.[0]?.jid_crudo === null,
   JSON.stringify(vinculoCanonico.datos));

const repetido = await rpc('canjear_por_telefono', {
  p_telefono_verificado: TEL_VERIFICADO, p_usuario_id: invitado.id,
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });
ok('La invitacion es de un solo uso', !repetido.ok, `estado ${repetido.estado}`);

const telefonoDesconocido = telefonoPrueba(1);
const usuarioDesconocido = await crearUsuario(`alta-desconocido-${sello}@flota.test`, telefonoDesconocido);
const desconocido = await rpc('canjear_por_telefono', {
  p_telefono_verificado: telefonoDesconocido, p_usuario_id: usuarioDesconocido.id,
  p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoDesconocido),
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

seccion('5. vinculos_chat no entrega filas a clientes');

const vinculoAnon = await rest('/vinculos_chat?select=*', { token: ANON });
ok('anon no obtiene filas de vinculos_chat',
   !vinculoAnon.ok || (Array.isArray(vinculoAnon.datos) && vinculoAnon.datos.length === 0),
   `estado ${vinculoAnon.estado} ${JSON.stringify(vinculoAnon.datos)?.slice(0, 80)}`);

const vinculoUsuario = await rest('/vinculos_chat?select=*', { token: invitado.token });
ok('un usuario autenticado tampoco obtiene filas',
   !vinculoUsuario.ok || (Array.isArray(vinculoUsuario.datos) && vinculoUsuario.datos.length === 0),
   `estado ${vinculoUsuario.estado}`);

seccion('6. Contexto del chat');

const ctx = await rpc('contexto_chat', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });
ok('Devuelve el canal y el identificador, no un chat_id de Telegram',
   ctx.datos?.vinculado === true && ctx.datos?.canal === CANAL
     && ctx.datos?.identificador_externo === IDENTIFICADOR && !('chat_id' in (ctx.datos || {})),
   JSON.stringify(ctx.datos));
ok('Con la organizacion activa correcta',
   ctx.datos?.organizacion_activa?.id === orgA, JSON.stringify(ctx.datos?.organizacion_activa));
ok('Y el rol', ctx.datos?.organizacion_activa?.rol === 'administrador');

const ctxDesconocido = await rpc('contexto_chat', {
  p_canal: CANAL, p_identificador_externo: '0000000001@whatsapp',
}, { servicio: true });
ok('Un chat sin vincular devuelve vinculado:false',
   ctxDesconocido.datos?.vinculado === false, JSON.stringify(ctxDesconocido.datos));

const ctxUsuario = await rpc('contexto_chat', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { token: invitado.token });
ok('contexto_chat no es llamable por un usuario', !ctxUsuario.ok, `estado ${ctxUsuario.estado}`);

seccion('7. Cambio de organizacion activa');

const cambioIlegal = await rpc('cambiar_organizacion_activa', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR, p_organizacion_id: orgB,
}, { servicio: true });
ok('No puede activar una organizacion de la que no es miembro',
   !cambioIlegal.ok, `estado ${cambioIlegal.estado}`);

// Invitarlo tambien a B y verificar que ahi si puede cambiar.
const invB = await rpc('crear_invitacion', {
  p_organizacion_id: orgB, p_rol: 'lector', p_telefono: '+54 351 777 6666',
}, { token: duenoB.token });
await rpc('canjear_invitacion', {
  p_codigo: invB.datos.codigo, p_usuario_id: invitado.id,
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });

const ctx2 = await rpc('contexto_chat', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });
ok('El canje por codigo tambien funciona',
   (ctx2.datos?.organizaciones || []).length === 2, JSON.stringify(ctx2.datos?.organizaciones));
ok('Y deja activa la organizacion recien canjeada',
   ctx2.datos?.organizacion_activa?.id === orgB);

const cambioValido = await rpc('cambiar_organizacion_activa', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR, p_organizacion_id: orgA,
}, { servicio: true });
ok('Puede volver a la organizacion A', cambioValido.ok, JSON.stringify(cambioValido.datos));

seccion('8. Desvincular');

const desv = await rpc('desvincular_chat', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });
ok('Desvincula el chat', desv.datos === true, JSON.stringify(desv.datos));

const ctx3 = await rpc('contexto_chat', {
  p_canal: CANAL, p_identificador_externo: IDENTIFICADOR,
}, { servicio: true });
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

seccion('10. Canje atomico bajo contencion');

const orgCarrera = await montar(duenoA, `Carrera ${sello}`);
const invitacionCarrera = await rpc('crear_invitacion', {
  p_organizacion_id: orgCarrera, p_email: `carrera-${sello}@flota.test`,
}, { token: duenoA.token });
const telefonoCarreraA = telefonoPrueba(2);
const telefonoCarreraB = telefonoPrueba(3);
const usuarioCarreraA = await crearUsuario(`alta-carrera-a-${sello}@flota.test`, telefonoCarreraA);
const usuarioCarreraB = await crearUsuario(`alta-carrera-b-${sello}@flota.test`, telefonoCarreraB);
const candidatosCarrera = [
  [usuarioCarreraA, telefonoCarreraA],
  [usuarioCarreraB, telefonoCarreraB],
];

const resultadosCarrera = await Promise.all(Array.from({ length: 20 }, (_, indice) => {
  const [usuario, telefono] = candidatosCarrera[indice % candidatosCarrera.length];
  return rpc('canjear_invitacion', {
    p_codigo: invitacionCarrera.datos?.codigo,
    p_usuario_id: usuario.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefono),
  }, { servicio: true });
}));

const exitosCarrera = resultadosCarrera.filter(resultado => resultado.ok);
ok('Una sola ejecucion gana el canje concurrente', exitosCarrera.length === 1,
   `${exitosCarrera.length} exitos`);

const estadoCarrera = await rest(
  `/invitaciones?select=usada_en,usada_por&id=eq.${invitacionCarrera.datos?.invitacion_id}`,
  { servicio: true },
);
const idsCarrera = `${usuarioCarreraA.id},${usuarioCarreraB.id}`;
const miembrosCarrera = await rest(
  `/miembros?select=usuario_id&organizacion_id=eq.${orgCarrera}&usuario_id=in.(${idsCarrera})`,
  { servicio: true },
);
const vinculosCarrera = await rest(
  `/vinculos_chat?select=usuario_id&usuario_id=in.(${idsCarrera})`,
  { servicio: true },
);
ok('La carrera deja una invitacion usada por un unico ganador',
   estadoCarrera.datos?.length === 1 && estadoCarrera.datos[0].usada_en !== null
     && [usuarioCarreraA.id, usuarioCarreraB.id].includes(estadoCarrera.datos[0].usada_por),
   JSON.stringify(estadoCarrera.datos));
ok('La carrera deja una sola membresia nueva', miembrosCarrera.datos?.length === 1,
   JSON.stringify(miembrosCarrera.datos));
ok('La carrera deja un solo vinculo nuevo', vinculosCarrera.datos?.length === 1,
   JSON.stringify(vinculosCarrera.datos));

const ganadorCarrera = estadoCarrera.datos?.[0]?.usada_por;
const perdedorCarrera = [usuarioCarreraA.id, usuarioCarreraB.id].find(id => id !== ganadorCarrera);
ok('El perdedor no recibe membresia ni vinculo',
   !miembrosCarrera.datos?.some(fila => fila.usuario_id === perdedorCarrera)
     && !vinculosCarrera.datos?.some(fila => fila.usuario_id === perdedorCarrera));

seccion('11. Colisiones se rechazan antes de mutar');

const telefonoColision = telefonoPrueba(4);
const usuarioColision = await crearUsuario(`alta-colision-${sello}@flota.test`, telefonoColision);
const identificadorColision = identificadorDe(telefonoColision);
const vinculoAjeno = await rest('/vinculos_chat', {
  servicio: true, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    usuario_id: duenoA.id,
    canal: CANAL,
    identificador_externo: identificadorColision,
    jid_crudo: null,
    organizacion_activa_id: orgA,
  },
});
if (!vinculoAjeno.ok) throw new Error(`vinculo de colision: ${JSON.stringify(vinculoAjeno.datos)}`);

const invitacionColision = await rpc('crear_invitacion', {
  p_organizacion_id: orgB, p_email: `colision-${sello}@flota.test`,
}, { token: duenoB.token });
const canjeColision = await rpc('canjear_invitacion', {
  p_codigo: invitacionColision.datos?.codigo,
  p_usuario_id: usuarioColision.id,
  p_canal: CANAL,
  p_identificador_externo: identificadorColision,
}, { servicio: true });
ok('Un identificador de otro usuario falla con identidad_en_uso',
   !canjeColision.ok && canjeColision.datos?.details === 'identidad_en_uso',
   JSON.stringify(canjeColision.datos));

const estadoColision = await rest(
  `/invitaciones?select=usada_en,usada_por&id=eq.${invitacionColision.datos?.invitacion_id}`,
  { servicio: true },
);
const miembroColision = await rest(
  `/miembros?select=id&organizacion_id=eq.${orgB}&usuario_id=eq.${usuarioColision.id}`,
  { servicio: true },
);
const vinculoColision = await rest(
  `/vinculos_chat?select=id&usuario_id=eq.${usuarioColision.id}`,
  { servicio: true },
);
ok('La colision deja la invitacion pendiente', estadoColision.datos?.[0]?.usada_en === null,
   JSON.stringify(estadoColision.datos));
ok('La colision no deja membresia ni vinculo parcial',
   miembroColision.datos?.length === 0 && vinculoColision.datos?.length === 0,
   `${JSON.stringify(miembroColision.datos)} ${JSON.stringify(vinculoColision.datos)}`);

seccion('12. Invitaciones no disponibles no mutan');

const orgEstados = await montar(duenoA, `Estados ${sello}`);
const telefonoEstados = telefonoPrueba(5);
const usuarioEstados = await crearUsuario(`alta-estados-${sello}@flota.test`, telefonoEstados);
const estados = [
  { nombre: 'anulada', codigo: codigoPrueba(1), anulada: true,
    expira_en: new Date(Date.now() + 86_400_000).toISOString() },
  { nombre: 'vencida', codigo: codigoPrueba(2), anulada: false,
    expira_en: new Date(Date.now() - 86_400_000).toISOString() },
  { nombre: 'usada', codigo: codigoPrueba(3), anulada: false,
    expira_en: new Date(Date.now() + 86_400_000).toISOString(),
    usada_en: new Date().toISOString(), usada_por: duenoA.id },
];

for (const estado of estados) {
  const altaEstado = await rest('/invitaciones', {
    servicio: true, metodo: 'POST', prefer: 'return=minimal',
    cuerpo: {
      organizacion_id: orgEstados,
      codigo: estado.codigo,
      email: `${estado.nombre}-${sello}@flota.test`,
      rol: 'lector',
      expira_en: estado.expira_en,
      anulada: estado.anulada,
      usada_en: estado.usada_en,
      usada_por: estado.usada_por,
    },
  });
  if (!altaEstado.ok) throw new Error(`invitacion ${estado.nombre}: ${JSON.stringify(altaEstado.datos)}`);

  const resultado = await rpc('canjear_invitacion', {
    p_codigo: estado.codigo,
    p_usuario_id: usuarioEstados.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoEstados),
  }, { servicio: true });
  ok(`Una invitacion ${estado.nombre} se rechaza`, !resultado.ok, JSON.stringify(resultado.datos));
}

const miembroEstados = await rest(
  `/miembros?select=id&organizacion_id=eq.${orgEstados}&usuario_id=eq.${usuarioEstados.id}`,
  { servicio: true },
);
const vinculoEstados = await rest(
  `/vinculos_chat?select=id&usuario_id=eq.${usuarioEstados.id}`,
  { servicio: true },
);
ok('Los rechazos de estado no dejan escrituras parciales',
   miembroEstados.datos?.length === 0 && vinculoEstados.datos?.length === 0);

seccion('13. Identidad Auth, canonico y limites de nombre');

const casosNombre = [
  { etiqueta: 'un caracter', entrada: ' X ', esperado: 'X', valido: true },
  { etiqueta: '120 caracteres', entrada: 'N'.repeat(120), esperado: 'N'.repeat(120), valido: true },
  { etiqueta: 'vacio', entrada: '   ', valido: false },
  { etiqueta: '121 caracteres', entrada: 'N'.repeat(121), valido: false },
];
const usuariosNombre = [];

for (const [indice, caso] of casosNombre.entries()) {
  const telefono = telefonoPrueba(10 + indice);
  const usuario = await crearUsuario(`alta-nombre-${indice}-${sello}@flota.test`, telefono);
  const invitacion = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_email: `nombre-${indice}-${sello}@flota.test`,
  }, { token: duenoA.token });
  const resultado = await rpc('canjear_invitacion', {
    p_codigo: invitacion.datos?.codigo,
    p_usuario_id: usuario.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefono),
    p_nombre_mostrado: caso.entrada,
  }, { servicio: true });

  usuariosNombre.push({ usuario, telefono, invitacion, caso, resultado });
  ok(`Nombre ${caso.etiqueta}: ${caso.valido ? 'se acepta' : 'se rechaza antes de mutar'}`,
     caso.valido
       ? resultado.ok
       : !resultado.ok && resultado.datos?.details === 'nombre_fuera_de_rango',
     JSON.stringify(resultado.datos));
}

for (const { usuario, invitacion, caso } of usuariosNombre) {
  const vinculo = await rest(
    `/vinculos_chat?select=nombre_mostrado,jid_crudo&usuario_id=eq.${usuario.id}`,
    { servicio: true },
  );
  const estadoInvitacion = await rest(
    `/invitaciones?select=usada_en&id=eq.${invitacion.datos?.invitacion_id}`,
    { servicio: true },
  );
  const membresia = await rest(
    `/miembros?select=id&organizacion_id=eq.${orgA}&usuario_id=eq.${usuario.id}`,
    { servicio: true },
  );

  if (caso.valido) {
    ok(`Nombre ${caso.etiqueta}: persiste exactamente despues de btrim`,
       vinculo.datos?.[0]?.nombre_mostrado === caso.esperado
         && vinculo.datos?.[0]?.jid_crudo === null,
       JSON.stringify(vinculo.datos));
  } else {
    ok(`Nombre ${caso.etiqueta}: no consume invitacion ni crea filas`,
       estadoInvitacion.datos?.[0]?.usada_en === null
         && vinculo.datos?.length === 0 && membresia.datos?.length === 0,
       `${JSON.stringify(estadoInvitacion.datos)} ${JSON.stringify(vinculo.datos)}`);
  }
}

const casoCanonico = usuariosNombre.find(item => !item.caso.valido);
const identificadorNoCanonico = await rpc('canjear_invitacion', {
  p_codigo: casoCanonico.invitacion.datos?.codigo,
  p_usuario_id: casoCanonico.usuario.id,
  p_canal: CANAL,
  p_identificador_externo: `raw-${sello}@s.whatsapp.net`,
  p_nombre_mostrado: 'Nombre valido',
}, { servicio: true });
ok('Un JID crudo no puede ocupar el identificador canonico',
   !identificadorNoCanonico.ok && identificadorNoCanonico.datos?.details === 'identificador_no_canonico',
   JSON.stringify(identificadorNoCanonico.datos));

const telefonoAutoridad = casoCanonico.telefono;
const telefonoNoAuth = telefonoPrueba(30);
const telefonoInyectado = await rpc('canjear_por_telefono', {
  p_telefono_verificado: telefonoNoAuth,
  p_usuario_id: casoCanonico.usuario.id,
  p_canal: CANAL,
  p_identificador_externo: identificadorDe(telefonoAutoridad),
  p_nombre_mostrado: 'Nombre valido',
}, { servicio: true });
ok('El telefono del argumento no reemplaza al telefono confirmado de Auth',
   !telefonoInyectado.ok && telefonoInyectado.datos?.details === 'telefono_no_coincide_con_auth',
   JSON.stringify(telefonoInyectado.datos));

seccion('14. La superficie de registro obsoleta desaparece');

const altaObsoleta = await rpc('registrar_organizacion', {
  p_nombre: `Alta obsoleta ${sello}`,
  p_telefono_admin: telefonoPrueba(40),
  p_email_admin: `obsoleta-${sello}@flota.test`,
  p_cuit: '30712345678',
}, { servicio: true });
if (altaObsoleta.ok && altaObsoleta.datos?.organizacion_id) {
  organizacionesCreadas.push(altaObsoleta.datos.organizacion_id);
}
ok('El RPC registrar_organizacion de seis argumentos ya no existe',
   !altaObsoleta.ok && ['PGRST202', '42883'].includes(altaObsoleta.datos?.code),
   JSON.stringify(altaObsoleta.datos));
} catch (error) {
  fallas.push('La bateria termino sin errores inesperados');
  console.error(`  \x1b[31mERROR\x1b[0m ${error.stack || error}`);
} finally {
  seccion('Limpieza');

  const organizaciones = await Promise.allSettled(
    [...organizacionesCreadas].reverse().map(async org => {
      const r = await rest(`/organizaciones?id=eq.${org}`, { metodo: 'DELETE', servicio: true });
      if (!r.ok) throw new Error(`organizacion ${org}: ${r.estado}`);
      return org;
    }),
  );
  for (const resultado of organizaciones) {
    if (resultado.status === 'fulfilled') {
      console.log(`  organizacion ${resultado.value.slice(0, 8)}: borrada`);
    } else {
      fallas.push('Limpieza de organizacion');
      console.log(`  \x1b[31mFALLA\x1b[0m ${resultado.reason}`);
    }
  }

  const usuarios = await Promise.allSettled(
    [...usuariosCreados].reverse().map(async usuario => {
      const r = await api(`/auth/v1/admin/users/${usuario.id}`, { metodo: 'DELETE', servicio: true });
      if (!r.ok) throw new Error(`usuario ${usuario.email}: ${r.estado}`);
      return usuario.email;
    }),
  );
  for (const resultado of usuarios) {
    if (resultado.status === 'rejected') {
      fallas.push('Limpieza de usuario');
      console.log(`  \x1b[31mFALLA\x1b[0m ${resultado.reason}`);
    }
  }
  console.log('  usuarios de prueba procesados');
}

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(f => console.log(`  - ${f}`));
  process.exitCode = 1;
}
