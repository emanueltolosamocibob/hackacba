// =============================================================================
// Verifica el alta de usuarios: autoridad de Auth, telefonos argentinos,
// invitaciones atomicas, identidad canonica y permisos de las funciones.
// Todos los datos se registran al crearse y se limpian aunque falle una prueba.
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan variables. Correr con: node --env-file=.env supabase/tests/verificar-alta.mjs');
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

const rest = (ruta, opciones) => api(`/rest/v1${ruta}`, opciones);
const rpc = (funcion, argumentos, opciones) => api(`/rest/v1/rpc/${funcion}`, {
  metodo: 'POST', cuerpo: argumentos, ...opciones,
});
const esperar = milisegundos => new Promise(resolver => setTimeout(resolver, milisegundos));

async function conReintento(etiqueta, operacion, intentos = 4) {
  let ultimo;
  for (let intento = 1; intento <= intentos; intento++) {
    const resultado = await operacion();
    if (resultado.ok) return resultado;
    ultimo = resultado;
    if (resultado.estado < 500 && resultado.estado !== 429) break;
    await esperar(intento * 1500);
  }
  throw new Error(`${etiqueta}: ${ultimo.estado} ${JSON.stringify(ultimo.datos)}`);
}

async function crearUsuario(email, telefono = null, confirmarTelefono = true) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const alta = await conReintento(`crear ${email}`, () => api('/auth/v1/admin/users', {
    metodo: 'POST',
    servicio: true,
    cuerpo: {
      email,
      password: clave,
      email_confirm: true,
      ...(telefono ? { phone: telefono, phone_confirm: confirmarTelefono } : {}),
    },
  }));
  usuariosCreados.push({ id: alta.datos.id, email });
  const sesion = await conReintento(`login ${email}`, () => api('/auth/v1/token?grant_type=password', {
    metodo: 'POST', token: ANON, cuerpo: { email, password: clave },
  }));
  return { id: alta.datos.id, email, token: sesion.datos.access_token, telefono };
}

async function montar(usuario, nombre) {
  const id = crypto.randomUUID();
  const alta = await rest('/organizaciones', {
    token: usuario.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: { id, nombre },
  });
  if (!alta.ok) throw new Error(`crear organizacion: ${JSON.stringify(alta.datos)}`);
  organizacionesCreadas.push(id);
  return id;
}

// crearUsuarioTelefonoNoConfirmado ya no hace falta: crearUsuario(email, telefono,
// false) cubre el mismo caso (telefono cargado, sin confirmar en Auth).

async function estadoCandidato(organizacionId, usuarioId, invitacionId) {
  const [miembros, vinculos, invitacion] = await Promise.all([
    rest(`/miembros?select=id&organizacion_id=eq.${organizacionId}&usuario_id=eq.${usuarioId}`, { servicio: true }),
    rest(`/vinculos_chat?select=id&usuario_id=eq.${usuarioId}`, { servicio: true }),
    rest(`/invitaciones?select=usada_en,usada_por&id=eq.${invitacionId}`, { servicio: true }),
  ]);
  return {
    miembros: miembros.datos || [],
    vinculos: vinculos.datos || [],
    invitacion: invitacion.datos?.[0],
  };
}

const sello = Date.now();
const sufijoTelefono = String(sello).slice(-7);
const telefonoPrueba = indice => `+549${String(300 + indice).slice(-3)}${sufijoTelefono}`;
const sinMas = telefono => telefono.replace(/^\+/, '');
const claveDe = telefono => telefono.replace(/^\+?549?/, '').slice(-10);
const identificadorDe = telefono => `${claveDe(telefono)}@whatsapp`;
const codigoPrueba = indice => `${String(sello).slice(-10)}${String(indice).padStart(2, '0')}`;
const CANAL = 'whatsapp';

async function limpiar() {
  seccion('Limpieza');
  const organizaciones = await Promise.allSettled(
    [...organizacionesCreadas].reverse().map(async id => {
      const resultado = await rest(`/organizaciones?id=eq.${id}`, { metodo: 'DELETE', servicio: true });
      if (!resultado.ok) throw new Error(`organizacion ${id}: ${resultado.estado}`);
      return id;
    }),
  );
  for (const resultado of organizaciones) {
    if (resultado.status === 'rejected') {
      fallas.push('Limpieza de organizacion');
      console.log(`  \x1b[31mFALLA\x1b[0m ${resultado.reason}`);
    }
  }

  const usuarios = await Promise.allSettled(
    [...usuariosCreados].reverse().map(async usuario => {
      const resultado = await api(`/auth/v1/admin/users/${usuario.id}`, { metodo: 'DELETE', servicio: true });
      if (!resultado.ok) throw new Error(`usuario ${usuario.email}: ${resultado.estado}`);
    }),
  );
  for (const resultado of usuarios) {
    if (resultado.status === 'rejected') {
      fallas.push('Limpieza de usuario');
      console.log(`  \x1b[31mFALLA\x1b[0m ${resultado.reason}`);
    }
  }
  console.log('  datos de prueba procesados');
}

async function redFormatoAuth() {
  console.log('\x1b[1mRED enfocado: telefono Auth argentino sin signo mas\x1b[0m');
  const telefono = telefonoPrueba(0);
  const usuario = await crearUsuario(`red-formato-auth-${sello}@flota.test`, telefono);
  const dueno = await crearUsuario(`red-dueno-${sello}@flota.test`);
  const organizacionId = await montar(dueno, `RED formato Auth ${sello}`);
  const invitacion = await rpc('crear_invitacion', {
    p_organizacion_id: organizacionId,
    p_rol: 'administrador',
    p_telefono: telefono,
  }, { token: dueno.token });
  if (!invitacion.ok) throw new Error(`crear invitacion: ${JSON.stringify(invitacion.datos)}`);

  const canje = await rpc('canjear_por_telefono', {
    p_telefono_verificado: sinMas(telefono),
    p_usuario_id: usuario.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefono),
  }, { servicio: true });
  ok('Auth sin + y afirmacion equivalente se canonicalizan',
     canje.ok && canje.datos?.usuario_id === usuario.id,
     canje.datos?.details || JSON.stringify(canje.datos));
}

async function bateriaCompleta() {
  console.log(`\x1b[1mVerificacion del alta de usuarios contra ${URL_BASE}\x1b[0m`);
  const duenoA = await crearUsuario(`alta-dueno-a-${sello}@flota.test`);
  const duenoB = await crearUsuario(`alta-dueno-b-${sello}@flota.test`);
  const orgA = await montar(duenoA, `Alta A ${sello}`);
  const orgB = await montar(duenoB, `Alta B ${sello}`);

  seccion('0. Normalizacion de telefonos existente');
  const variantes = [
    ['+54 9 351 123-4567', '3511234567'],
    ['0351 15 123 4567', '3511234567'],
    ['3511234567', '3511234567'],
    ['351 15 1234567', '3511234567'],
    ['00549 351 1234567', '3511234567'],
    ['+54 11 4444 5555', '1144445555'],
    ['011 15 4444 5555', '1144445555'],
  ];
  for (const [entrada, esperado] of variantes) {
    const resultado = await rpc('clave_telefono', { p_telefono: entrada }, { servicio: true });
    ok(`clave_telefono conserva ${entrada} -> ${esperado}`,
       resultado.datos === esperado, JSON.stringify(resultado.datos));
  }

  seccion('1. Invitaciones argentinas y permisos');
  const telefonoPrincipal = telefonoPrueba(1);
  const invitacionPrincipal = await rpc('crear_invitacion', {
    p_organizacion_id: orgA,
    p_rol: 'administrador',
    p_telefono: telefonoPrincipal,
  }, { token: duenoA.token });
  ok('Un propietario autenticado crea una invitacion argentina',
     invitacionPrincipal.ok && /^[0-9A-HJKMNP-TV-Z]{12}$/.test(invitacionPrincipal.datos?.codigo || ''),
     JSON.stringify(invitacionPrincipal.datos));

  const sinContacto = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_rol: 'operador',
  }, { token: duenoA.token });
  ok('Crear invitacion exige telefono o email', !sinContacto.ok, JSON.stringify(sinContacto.datos));

  const invitacionAjena = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_rol: 'operador', p_email: `ajena-${sello}@flota.test`,
  }, { token: duenoB.token });
  ok('Otro propietario no puede invitar a la organizacion ajena',
     !invitacionAjena.ok, JSON.stringify(invitacionAjena.datos));

  const clavePrincipal = claveDe(telefonoPrincipal);
  const invitacionDuplicada = await rpc('crear_invitacion', {
    p_organizacion_id: orgA,
    p_rol: 'lector',
    p_telefono: `0${clavePrincipal.slice(0, 3)} 15 ${clavePrincipal.slice(3)}`,
  }, { token: duenoA.token });
  ok('Dos formatos argentinos del mismo numero no crean invitaciones pendientes duplicadas',
     !invitacionDuplicada.ok, JSON.stringify(invitacionDuplicada.datos));

  for (const [etiqueta, telefono] of [
    ['extranjero', '+12025550123'],
    ['malformado', `alias-${sinMas(telefonoPrueba(9))}`],
  ]) {
    const resultado = await rpc('crear_invitacion', {
      p_organizacion_id: orgA,
      p_rol: 'lector',
      p_telefono: telefono,
    }, { token: duenoA.token });
    ok(`Crear invitacion rechaza telefono ${etiqueta} antes de insertar`,
       !resultado.ok && resultado.datos?.details === 'telefono_invitacion_invalido',
       JSON.stringify(resultado.datos));
  }

  const propietario = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_rol: 'propietario', p_email: `propietario-${sello}@flota.test`,
  }, { token: duenoA.token });
  ok('Las invitaciones nunca crean propietarios',
     !propietario.ok && propietario.datos?.details === 'rol_invitacion_invalido',
     JSON.stringify(propietario.datos));

  const argumentosIdentidad = {
    p_usuario_id: duenoA.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
    p_telefono_afirmado: telefonoPrincipal,
    p_nombre_mostrado: null,
  };
  const funcionesInternas = [
    ['validar_identidad_chat', argumentosIdentidad],
    ['aplicar_invitacion', {
      p_invitacion_id: invitacionPrincipal.datos?.invitacion_id,
      p_usuario_id: duenoA.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefonoPrincipal),
      p_nombre_mostrado: null,
      p_telefono_verificado: telefonoPrincipal,
    }],
    ['canjear_por_telefono', {
      p_telefono_verificado: telefonoPrincipal,
      p_usuario_id: duenoA.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefonoPrincipal),
    }],
    ['canjear_invitacion', {
      p_codigo: invitacionPrincipal.datos?.codigo,
      p_usuario_id: duenoA.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefonoPrincipal),
    }],
  ];
  for (const [funcion, argumentos] of funcionesInternas) {
    const [anonimo, autenticado] = await Promise.all([
      rpc(funcion, argumentos, { token: ANON }),
      rpc(funcion, argumentos, { token: duenoA.token }),
    ]);
    ok(`${funcion}: PUBLIC/anon/authenticated no tienen EXECUTE`,
       !anonimo.ok && !autenticado.ok,
       `${anonimo.estado}/${autenticado.estado}`);
  }
  const crearAnon = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_email: `anon-${sello}@flota.test`,
  }, { token: ANON });
  ok('crear_invitacion conserva EXECUTE solo para authenticated',
     !crearAnon.ok && invitacionPrincipal.ok, `${crearAnon.estado}`);

  seccion('2. Ambos caminos aceptan Auth confirmado y representaciones equivalentes');
  const usuarioTelefonoMas = await crearUsuario(`alta-telefono-mas-${sello}@flota.test`, telefonoPrincipal);
  const canjeMas = await rpc('canjear_por_telefono', {
    p_telefono_verificado: telefonoPrincipal,
    p_usuario_id: usuarioTelefonoMas.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
    p_nombre_mostrado: ' Telefono mas ',
  }, { servicio: true });
  ok('Canje por telefono acepta afirmacion con + equivalente a Auth',
     canjeMas.ok && canjeMas.datos?.organizacion_id === orgA,
     JSON.stringify(canjeMas.datos));

  const canjeRepetido = await rpc('canjear_por_telefono', {
    p_telefono_verificado: telefonoPrincipal,
    p_usuario_id: usuarioTelefonoMas.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  ok('La invitacion por telefono es de un solo uso', !canjeRepetido.ok,
     JSON.stringify(canjeRepetido.datos));

  const vinculoMas = await rest(
    `/vinculos_chat?select=telefono,telefono_clave,identificador_externo,jid_crudo,nombre_mostrado&usuario_id=eq.${usuarioTelefonoMas.id}`,
    { servicio: true },
  );
  ok('El vinculo guarda telefono canonico, clave e identificador; JID crudo queda nulo',
     vinculoMas.datos?.[0]?.telefono === `+54${claveDe(telefonoPrincipal)}`
       && vinculoMas.datos?.[0]?.telefono_clave === claveDe(telefonoPrincipal)
       && vinculoMas.datos?.[0]?.identificador_externo === identificadorDe(telefonoPrincipal)
       && vinculoMas.datos?.[0]?.jid_crudo === null
       && vinculoMas.datos?.[0]?.nombre_mostrado === 'Telefono mas',
     JSON.stringify(vinculoMas.datos));

  const telefonoSinMas = telefonoPrueba(2);
  const usuarioSinMas = await crearUsuario(`alta-telefono-sin-mas-${sello}@flota.test`, telefonoSinMas);
  const invitacionSinMas = await rpc('crear_invitacion', {
    p_organizacion_id: orgA, p_rol: 'lector', p_telefono: telefonoSinMas,
  }, { token: duenoA.token });
  const canjeSinMas = await rpc('canjear_por_telefono', {
    p_telefono_verificado: sinMas(telefonoSinMas),
    p_usuario_id: usuarioSinMas.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoSinMas),
  }, { servicio: true });
  ok('Canje por telefono acepta afirmacion sin + equivalente a Auth',
     invitacionSinMas.ok && canjeSinMas.ok, JSON.stringify(canjeSinMas.datos));

  const telefonoCodigo = telefonoPrueba(3);
  const usuarioCodigo = await crearUsuario(`alta-codigo-${sello}@flota.test`, telefonoCodigo);
  const invitacionCodigo = await rpc('crear_invitacion', {
    p_organizacion_id: orgB, p_rol: 'operador', p_email: `codigo-${sello}@flota.test`,
  }, { token: duenoB.token });
  const canjeCodigo = await rpc('canjear_invitacion', {
    p_codigo: invitacionCodigo.datos?.codigo,
    p_usuario_id: usuarioCodigo.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoCodigo),
  }, { servicio: true });
  ok('Canje por codigo deriva telefono confirmado desde Auth',
     canjeCodigo.ok && canjeCodigo.datos?.organizacion_id === orgB,
     JSON.stringify(canjeCodigo.datos));

  seccion('2.1. RLS y operaciones del vinculo conservan el contrato anterior');
  const organizacionesVisibles = await rest('/organizaciones?select=id,nombre', {
    token: usuarioTelefonoMas.token,
  });
  ok('El miembro ve su organizacion y no la ajena',
     organizacionesVisibles.datos?.some(organizacion => organizacion.id === orgA)
       && !organizacionesVisibles.datos?.some(organizacion => organizacion.id === orgB),
     JSON.stringify(organizacionesVisibles.datos));

  const crearFlota = await rest('/flotas', {
    token: usuarioTelefonoMas.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: { organizacion_id: orgA, nombre: 'Flota nueva' },
  });
  ok('El administrador invitado puede crear flotas en su organizacion',
     crearFlota.ok, JSON.stringify(crearFlota.datos));

  const [vinculosAnonimos, vinculosAutenticados] = await Promise.all([
    rest('/vinculos_chat?select=*', { token: ANON }),
    rest('/vinculos_chat?select=*', { token: usuarioTelefonoMas.token }),
  ]);
  ok('vinculos_chat no entrega filas a anon ni authenticated',
     (!vinculosAnonimos.ok || vinculosAnonimos.datos?.length === 0)
       && (!vinculosAutenticados.ok || vinculosAutenticados.datos?.length === 0),
     `${vinculosAnonimos.estado}/${vinculosAutenticados.estado}`);

  const contexto = await rpc('contexto_chat', {
    p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  ok('contexto_chat devuelve identidad, organizacion activa y rol sin chat_id de Telegram',
     contexto.datos?.vinculado === true
       && contexto.datos?.canal === CANAL
       && contexto.datos?.identificador_externo === identificadorDe(telefonoPrincipal)
       && contexto.datos?.organizacion_activa?.id === orgA
       && contexto.datos?.organizacion_activa?.rol === 'administrador'
       && !('chat_id' in (contexto.datos || {})),
     JSON.stringify(contexto.datos));

  const contextoDesconocido = await rpc('contexto_chat', {
    p_canal: CANAL, p_identificador_externo: '0000000001@whatsapp',
  }, { servicio: true });
  const contextoCliente = await rpc('contexto_chat', {
    p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { token: usuarioTelefonoMas.token });
  ok('contexto_chat devuelve vinculado:false para desconocidos y no es ejecutable por clientes',
     contextoDesconocido.datos?.vinculado === false && !contextoCliente.ok,
     `${JSON.stringify(contextoDesconocido.datos)} ${contextoCliente.estado}`);

  const cambioIlegal = await rpc('cambiar_organizacion_activa', {
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
    p_organizacion_id: orgB,
  }, { servicio: true });
  ok('No se puede activar una organizacion sin membresia', !cambioIlegal.ok,
     JSON.stringify(cambioIlegal.datos));

  const segundaInvitacion = await rpc('crear_invitacion', {
    p_organizacion_id: orgB, p_rol: 'lector', p_email: `segunda-${sello}@flota.test`,
  }, { token: duenoB.token });
  const segundoCanje = await rpc('canjear_invitacion', {
    p_codigo: segundaInvitacion.datos?.codigo,
    p_usuario_id: usuarioTelefonoMas.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  const contextoDos = await rpc('contexto_chat', {
    p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  ok('El canje por codigo agrega la segunda organizacion y la deja activa',
     segundoCanje.ok && contextoDos.datos?.organizaciones?.length === 2
       && contextoDos.datos?.organizacion_activa?.id === orgB,
     JSON.stringify(contextoDos.datos));

  const cambioValido = await rpc('cambiar_organizacion_activa', {
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoPrincipal),
    p_organizacion_id: orgA,
  }, { servicio: true });
  ok('Un miembro puede volver a una organizacion propia', cambioValido.ok,
     JSON.stringify(cambioValido.datos));

  const desvinculado = await rpc('desvincular_chat', {
    p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  const contextoDesvinculado = await rpc('contexto_chat', {
    p_canal: CANAL, p_identificador_externo: identificadorDe(telefonoPrincipal),
  }, { servicio: true });
  const membresiasPersistentes = await rest('/organizaciones?select=id', {
    token: usuarioTelefonoMas.token,
  });
  ok('Desvincular elimina el chat pero conserva ambas membresias',
     desvinculado.datos === true && contextoDesvinculado.datos?.vinculado === false
       && membresiasPersistentes.datos?.length === 2,
     JSON.stringify(membresiasPersistentes.datos));

  const [invitacionesA, invitacionesB] = await Promise.all([
    rest('/invitaciones?select=organizacion_id', { token: duenoA.token }),
    rest('/invitaciones?select=organizacion_id', { token: duenoB.token }),
  ]);
  ok('RLS de invitaciones limita cada propietario a sus organizaciones',
     invitacionesA.datos?.length > 0
       && invitacionesA.datos.every(invitacion => invitacion.organizacion_id === orgA)
       && invitacionesB.datos?.length > 0
       && invitacionesB.datos.every(invitacion => invitacion.organizacion_id === orgB),
     `${JSON.stringify(invitacionesA.datos)} ${JSON.stringify(invitacionesB.datos)}`);

  const invitacionInventada = await rest('/invitaciones', {
    token: duenoA.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: {
      organizacion_id: orgA,
      codigo: 'AAAAAAAAAAAA',
      telefono: telefonoPrueba(9),
      rol: 'administrador',
      expira_en: '2099-01-01T00:00:00Z',
    },
  });
  ok('Los clientes no insertan invitaciones con codigos elegidos a mano',
     !invitacionInventada.ok, JSON.stringify(invitacionInventada.datos));

  seccion('3. Auth ausente, no confirmado, extranjero y afirmaciones invalidas no mutan');
  const casosRechazo = [
    {
      nombre: 'usuario Auth inexistente',
      usuario: { id: crypto.randomUUID() },
      telefono: telefonoPrueba(10),
      detalle: 'telefono_auth_no_confirmado',
    },
    {
      nombre: 'telefono Auth ausente',
      usuario: await crearUsuario(`alta-sin-telefono-${sello}@flota.test`),
      telefono: telefonoPrueba(11),
      detalle: 'telefono_auth_no_confirmado',
    },
    {
      nombre: 'telefono Auth no confirmado',
      usuario: await crearUsuario(`alta-no-confirmado-${sello}@flota.test`, telefonoPrueba(12), false),
      telefono: telefonoPrueba(12),
      detalle: 'telefono_auth_no_confirmado',
    },
    {
      nombre: 'telefono Auth no argentino',
      usuario: await crearUsuario(`alta-extranjero-${sello}@flota.test`, '+12025550123'),
      telefono: '+12025550123',
      detalle: 'telefono_auth_invalido',
    },
  ];

  for (const [indice, caso] of casosRechazo.entries()) {
    const invitacion = await rpc('crear_invitacion', {
      p_organizacion_id: orgA, p_email: `rechazo-${indice}-${sello}@flota.test`,
    }, { token: duenoA.token });
    const resultado = await rpc('canjear_invitacion', {
      p_codigo: invitacion.datos?.codigo,
      p_usuario_id: caso.usuario.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(caso.telefono),
    }, { servicio: true });
    const estado = await estadoCandidato(orgA, caso.usuario.id, invitacion.datos?.invitacion_id);
    ok(`${caso.nombre} se rechaza sin mutacion`,
       !resultado.ok && resultado.datos?.details === caso.detalle
         && estado.miembros.length === 0 && estado.vinculos.length === 0
         && estado.invitacion?.usada_en === null,
       `${JSON.stringify(resultado.datos)} ${JSON.stringify(estado)}`);
  }

  const telefonoAfirmacion = telefonoPrueba(20);
  const usuarioAfirmacion = await crearUsuario(`alta-afirmacion-${sello}@flota.test`, telefonoAfirmacion);
  for (const [nombre, afirmado, detalle] of [
    ['afirmacion malformada', `alias-${sinMas(telefonoAfirmacion)}`, 'telefono_afirmado_invalido'],
    ['afirmacion argentina distinta', telefonoPrueba(21), 'telefono_no_coincide_con_auth'],
  ]) {
    const invitacion = await rpc('crear_invitacion', {
      p_organizacion_id: orgA, p_email: `${nombre.replaceAll(' ', '-')}-${sello}@flota.test`,
    }, { token: duenoA.token });
    const resultado = await rpc('canjear_por_telefono', {
      p_telefono_verificado: afirmado,
      p_usuario_id: usuarioAfirmacion.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefonoAfirmacion),
    }, { servicio: true });
    const estado = await estadoCandidato(orgA, usuarioAfirmacion.id, invitacion.datos?.invitacion_id);
    ok(`${nombre} falla antes de mutar`,
       !resultado.ok && resultado.datos?.details === detalle
         && estado.miembros.length === 0 && estado.vinculos.length === 0
         && estado.invitacion?.usada_en === null,
       JSON.stringify(resultado.datos));
  }

  seccion('4. Identificadores, nombres e invitaciones no disponibles');
  const telefonoCanonico = telefonoPrueba(30);
  const usuarioCanonico = await crearUsuario(`alta-canonico-${sello}@flota.test`, telefonoCanonico);
  for (const [indice, identificador] of [
    `raw-${sello}@s.whatsapp.net`,
    identificadorDe(telefonoPrueba(31)),
  ].entries()) {
    const invitacion = await rpc('crear_invitacion', {
      p_organizacion_id: orgA, p_email: `canonico-${indice}-${sello}@flota.test`,
    }, { token: duenoA.token });
    const resultado = await rpc('canjear_invitacion', {
      p_codigo: invitacion.datos?.codigo,
      p_usuario_id: usuarioCanonico.id,
      p_canal: CANAL,
      p_identificador_externo: identificador,
    }, { servicio: true });
    const estado = await estadoCandidato(orgA, usuarioCanonico.id, invitacion.datos?.invitacion_id);
    ok(`Identificador no canonico ${indice + 1} se rechaza sin mutar`,
       !resultado.ok && resultado.datos?.details === 'identificador_no_canonico'
         && estado.miembros.length === 0 && estado.vinculos.length === 0
         && estado.invitacion?.usada_en === null,
       JSON.stringify(resultado.datos));
  }

  for (const [indice, caso] of [
    { nombre: 'un caracter', entrada: ' X ', valido: true, esperado: 'X' },
    { nombre: '120 caracteres', entrada: 'N'.repeat(120), valido: true, esperado: 'N'.repeat(120) },
    { nombre: 'vacio', entrada: '   ', valido: false },
    { nombre: '121 caracteres', entrada: 'N'.repeat(121), valido: false },
  ].entries()) {
    const telefono = telefonoPrueba(40 + indice);
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
    const vinculo = await rest(`/vinculos_chat?select=nombre_mostrado&usuario_id=eq.${usuario.id}`, { servicio: true });
    const estado = await estadoCandidato(orgA, usuario.id, invitacion.datos?.invitacion_id);
    ok(`Nombre ${caso.nombre}: ${caso.valido ? 'persiste exacto tras btrim' : 'falla sin mutar'}`,
       caso.valido
         ? resultado.ok && vinculo.datos?.[0]?.nombre_mostrado === caso.esperado
         : !resultado.ok && resultado.datos?.details === 'nombre_fuera_de_rango'
           && estado.miembros.length === 0 && estado.vinculos.length === 0
           && estado.invitacion?.usada_en === null,
       JSON.stringify(resultado.datos));
  }

  const telefonoEstados = telefonoPrueba(50);
  const usuarioEstados = await crearUsuario(`alta-estados-${sello}@flota.test`, telefonoEstados);
  for (const [indice, estado] of [
    { nombre: 'anulada', anulada: true, expira_en: new Date(Date.now() + 86_400_000).toISOString() },
    { nombre: 'vencida', anulada: false, expira_en: new Date(Date.now() - 86_400_000).toISOString() },
    {
      nombre: 'usada', anulada: false, expira_en: new Date(Date.now() + 86_400_000).toISOString(),
      usada_en: new Date().toISOString(), usada_por: duenoA.id,
    },
  ].entries()) {
    const { nombre, ...datosEstado } = estado;
    const alta = await rest('/invitaciones', {
      servicio: true,
      metodo: 'POST',
      prefer: 'return=representation',
      cuerpo: {
        organizacion_id: orgA,
        codigo: codigoPrueba(60 + indice),
        email: `estado-${indice}-${sello}@flota.test`,
        rol: 'lector',
        ...datosEstado,
      },
    });
    if (!alta.ok) throw new Error(`crear invitacion ${nombre}: ${JSON.stringify(alta.datos)}`);
    const invitacion = alta.datos?.[0];
    const resultado = await rpc('canjear_invitacion', {
      p_codigo: invitacion?.codigo,
      p_usuario_id: usuarioEstados.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefonoEstados),
    }, { servicio: true });
    const candidato = await estadoCandidato(orgA, usuarioEstados.id, invitacion?.id);
    ok(`Invitacion ${nombre} se revalida y no muta`,
       !resultado.ok && resultado.datos?.details === 'invitacion_no_disponible'
         && candidato.invitacion !== undefined
         && candidato.miembros.length === 0 && candidato.vinculos.length === 0,
       JSON.stringify(resultado.datos));
  }

  seccion('5. Alias extranjeros heredados no se canjean');
  const telefonoAlias = telefonoPrueba(60);
  const usuarioAlias = await crearUsuario(`alta-alias-${sello}@flota.test`, telefonoAlias);
  const altaAlias = await rest('/invitaciones', {
    servicio: true,
    metodo: 'POST',
    prefer: 'return=representation',
    cuerpo: {
      organizacion_id: orgA,
      codigo: codigoPrueba(70),
      telefono: `+1555${claveDe(telefonoAlias)}`,
      rol: 'lector',
      expira_en: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  if (!altaAlias.ok) throw new Error(`crear invitacion alias: ${JSON.stringify(altaAlias.datos)}`);
  const invitacionAlias = altaAlias.datos?.[0];
  const canjeAliasTelefono = await rpc('canjear_por_telefono', {
    p_telefono_verificado: telefonoAlias,
    p_usuario_id: usuarioAlias.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoAlias),
  }, { servicio: true });
  const canjeAliasCodigo = await rpc('canjear_invitacion', {
    p_codigo: invitacionAlias?.codigo,
    p_usuario_id: usuarioAlias.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoAlias),
  }, { servicio: true });
  const estadoAlias = await estadoCandidato(orgA, usuarioAlias.id, invitacionAlias?.id);
  ok('Ni telefono ni codigo canjean una invitacion extranjera heredada por sufijo',
     !canjeAliasTelefono.ok && canjeAliasTelefono.datos?.details === 'invitacion_no_disponible'
       && !canjeAliasCodigo.ok && canjeAliasCodigo.datos?.details === 'invitacion_no_disponible'
       && estadoAlias.miembros.length === 0 && estadoAlias.vinculos.length === 0
       && estadoAlias.invitacion?.usada_en === null,
     `${JSON.stringify(canjeAliasTelefono.datos)} ${JSON.stringify(canjeAliasCodigo.datos)}`);

  seccion('6. Colision y contencion atomica');
  const telefonoColision = telefonoPrueba(70);
  const usuarioColision = await crearUsuario(`alta-colision-${sello}@flota.test`, telefonoColision);
  const vinculoAjeno = await rest('/vinculos_chat', {
    servicio: true,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: {
      usuario_id: duenoA.id,
      canal: CANAL,
      identificador_externo: identificadorDe(telefonoColision),
      jid_crudo: null,
      organizacion_activa_id: orgA,
    },
  });
  if (!vinculoAjeno.ok) throw new Error(`crear vinculo de colision: ${JSON.stringify(vinculoAjeno.datos)}`);
  const invitacionColision = await rpc('crear_invitacion', {
    p_organizacion_id: orgB, p_email: `colision-${sello}@flota.test`,
  }, { token: duenoB.token });
  const canjeColision = await rpc('canjear_invitacion', {
    p_codigo: invitacionColision.datos?.codigo,
    p_usuario_id: usuarioColision.id,
    p_canal: CANAL,
    p_identificador_externo: identificadorDe(telefonoColision),
  }, { servicio: true });
  const estadoColision = await estadoCandidato(orgB, usuarioColision.id, invitacionColision.datos?.invitacion_id);
  ok('La colision falla con identidad_en_uso antes de toda mutacion',
     !canjeColision.ok && canjeColision.datos?.details === 'identidad_en_uso'
       && estadoColision.miembros.length === 0 && estadoColision.vinculos.length === 0
       && estadoColision.invitacion?.usada_en === null,
     JSON.stringify(canjeColision.datos));

  const orgCarrera = await montar(duenoA, `Carrera ${sello}`);
  const invitacionCarrera = await rpc('crear_invitacion', {
    p_organizacion_id: orgCarrera, p_email: `carrera-${sello}@flota.test`,
  }, { token: duenoA.token });
  const telefonoCarreraA = telefonoPrueba(80);
  const telefonoCarreraB = telefonoPrueba(81);
  const usuarioCarreraA = await crearUsuario(`alta-carrera-a-${sello}@flota.test`, telefonoCarreraA);
  const usuarioCarreraB = await crearUsuario(`alta-carrera-b-${sello}@flota.test`, telefonoCarreraB);
  const candidatos = [
    [usuarioCarreraA, telefonoCarreraA],
    [usuarioCarreraB, telefonoCarreraB],
  ];
  const resultados = await Promise.all(Array.from({ length: 20 }, (_, indice) => {
    const [usuario, telefono] = candidatos[indice % candidatos.length];
    return rpc('canjear_invitacion', {
      p_codigo: invitacionCarrera.datos?.codigo,
      p_usuario_id: usuario.id,
      p_canal: CANAL,
      p_identificador_externo: identificadorDe(telefono),
    }, { servicio: true });
  }));
  const exitos = resultados.filter(resultado => resultado.ok);
  const estadoInvitacionCarrera = await rest(
    `/invitaciones?select=usada_en,usada_por&id=eq.${invitacionCarrera.datos?.invitacion_id}`,
    { servicio: true },
  );
  const ids = `${usuarioCarreraA.id},${usuarioCarreraB.id}`;
  const [miembrosCarrera, vinculosCarrera] = await Promise.all([
    rest(`/miembros?select=usuario_id&organizacion_id=eq.${orgCarrera}&usuario_id=in.(${ids})`, { servicio: true }),
    rest(`/vinculos_chat?select=usuario_id&usuario_id=in.(${ids})`, { servicio: true }),
  ]);
  const ganador = estadoInvitacionCarrera.datos?.[0]?.usada_por;
  const perdedor = [usuarioCarreraA.id, usuarioCarreraB.id].find(id => id !== ganador);
  ok('La contencion deja un unico ganador, miembro y vinculo; el perdedor no muta',
     exitos.length === 1 && estadoInvitacionCarrera.datos?.[0]?.usada_en !== null
       && miembrosCarrera.datos?.length === 1 && vinculosCarrera.datos?.length === 1
       && !miembrosCarrera.datos?.some(fila => fila.usuario_id === perdedor)
       && !vinculosCarrera.datos?.some(fila => fila.usuario_id === perdedor),
     `${exitos.length} ${JSON.stringify(estadoInvitacionCarrera.datos)}`);

  seccion('7. Superficie obsoleta');
  const altaObsoleta = await rpc('registrar_organizacion', {
    p_nombre: `Alta obsoleta ${sello}`,
    p_telefono_admin: telefonoPrueba(90),
    p_email_admin: `obsoleta-${sello}@flota.test`,
    p_cuit: '30712345678',
  }, { servicio: true });
  ok('El RPC registrar_organizacion de seis argumentos no existe',
     !altaObsoleta.ok && ['PGRST202', '42883'].includes(altaObsoleta.datos?.code),
     JSON.stringify(altaObsoleta.datos));

  seccion('8. Finalizador de alta por landing (0019)');

  const noAutenticado = await rpc('finalizar_alta_landing', {}, { token: ANON });
  ok('Sin sesion de usuario no se puede finalizar el alta', !noAutenticado.ok,
     `estado ${noAutenticado.estado} ${JSON.stringify(noAutenticado.datos)}`);

  const telefonoSinConfirmar = telefonoPrueba(101);
  const usuarioSinConfirmar = await crearUsuario(
    `alta-landing-sinconfirmar-${sello}@flota.test`, telefonoSinConfirmar, false,
  );
  const sinConfirmar = await rpc('finalizar_alta_landing', {}, { token: usuarioSinConfirmar.token });
  ok('Un telefono sin confirmar no finaliza el alta',
     !sinConfirmar.ok && sinConfirmar.datos?.details === 'telefono_no_verificado',
     JSON.stringify(sinConfirmar.datos));

  const telefonoLanding = telefonoPrueba(100);
  const usuarioLanding = await crearUsuario(`alta-landing-${sello}@flota.test`, telefonoLanding);
  const primeraFinalizacion = await rpc('finalizar_alta_landing', {}, { token: usuarioLanding.token });
  ok('Un telefono confirmado sin membresia ni invitacion se autoregistra',
     primeraFinalizacion.ok && primeraFinalizacion.datos?.estado === 'registrado'
       && primeraFinalizacion.datos?.organizacion?.nombre === 'Mi flota'
       && primeraFinalizacion.datos?.flota?.nombre === 'Principal'
       && primeraFinalizacion.datos?.vinculo?.identificador_externo === identificadorDe(telefonoLanding)
       && primeraFinalizacion.datos?.vinculo?.jid_crudo === null,
     JSON.stringify(primeraFinalizacion.datos));
  if (primeraFinalizacion.ok && primeraFinalizacion.datos?.organizacion?.id) {
    organizacionesCreadas.push(primeraFinalizacion.datos.organizacion.id);
  }

  const reintentoFinalizacion = await rpc('finalizar_alta_landing', {}, { token: usuarioLanding.token });
  ok('El reintento devuelve estado existente con los mismos IDs que el alta',
     reintentoFinalizacion.ok && reintentoFinalizacion.datos?.estado === 'existente'
       && reintentoFinalizacion.datos?.organizacion?.id === primeraFinalizacion.datos?.organizacion?.id
       && reintentoFinalizacion.datos?.flota?.id === primeraFinalizacion.datos?.flota?.id
       && reintentoFinalizacion.datos?.vinculo?.id === primeraFinalizacion.datos?.vinculo?.id,
     JSON.stringify(reintentoFinalizacion.datos));

  const soloUnaVinculacion = await rest(
    `/vinculos_chat?select=id&usuario_id=eq.${usuarioLanding.id}`, { servicio: true },
  );
  ok('El reintento no crea un segundo vinculo', soloUnaVinculacion.datos?.length === 1,
     JSON.stringify(soloUnaVinculacion.datos));

  seccion('9. Colision de identidad en el finalizador');

  const telefonoColisionLanding = telefonoPrueba(102);
  const identificadorColisionLanding = identificadorDe(telefonoColisionLanding);
  const vinculoAjenoLanding = await rest('/vinculos_chat', {
    servicio: true, metodo: 'POST', prefer: 'return=minimal',
    cuerpo: {
      usuario_id: duenoB.id,
      canal: CANAL,
      identificador_externo: identificadorColisionLanding,
      jid_crudo: null,
      telefono: telefonoColisionLanding,
      organizacion_activa_id: orgB,
    },
  });
  if (!vinculoAjenoLanding.ok) {
    throw new Error(`vinculo de colision landing: ${JSON.stringify(vinculoAjenoLanding.datos)}`);
  }

  const usuarioColisionLanding = await crearUsuario(
    `alta-landing-colision-${sello}@flota.test`, telefonoColisionLanding,
  );
  const colisionLanding = await rpc('finalizar_alta_landing', {}, { token: usuarioColisionLanding.token });
  ok('Un telefono ya vinculado a otro usuario falla con identidad_en_uso',
     !colisionLanding.ok && colisionLanding.datos?.details === 'identidad_en_uso',
     JSON.stringify(colisionLanding.datos));

  const sinMembresiaColisionLanding = await rest(
    `/miembros?select=id&usuario_id=eq.${usuarioColisionLanding.id}`, { servicio: true },
  );
  ok('La colision del finalizador no deja membresia',
     sinMembresiaColisionLanding.datos?.length === 0, JSON.stringify(sinMembresiaColisionLanding.datos));

  seccion('10. El finalizador canjea una invitacion pendiente por telefono');

  const orgLanding = await montar(duenoA, `Landing ${sello}`);
  const telefonoInvitacionLanding = telefonoPrueba(103);
  await rpc('crear_invitacion', {
    p_organizacion_id: orgLanding, p_rol: 'operador', p_telefono: telefonoInvitacionLanding,
  }, { token: duenoA.token });

  const usuarioInvitacionLanding = await crearUsuario(
    `alta-landing-invitado-${sello}@flota.test`, telefonoInvitacionLanding,
  );
  const invitacionFinalizada = await rpc('finalizar_alta_landing', {}, { token: usuarioInvitacionLanding.token });
  ok('Una invitacion pendiente por telefono se canjea desde el finalizador',
     invitacionFinalizada.ok && invitacionFinalizada.datos?.estado === 'invitacion_canjeada'
       && invitacionFinalizada.datos?.organizacion?.id === orgLanding,
     JSON.stringify(invitacionFinalizada.datos));

  const membresiaInvitacionLanding = await rest(
    `/miembros?select=rol&organizacion_id=eq.${orgLanding}&usuario_id=eq.${usuarioInvitacionLanding.id}`,
    { servicio: true },
  );
  ok('Queda con el rol de la invitacion canjeada',
     membresiaInvitacionLanding.datos?.[0]?.rol === 'operador',
     JSON.stringify(membresiaInvitacionLanding.datos));

  seccion('11. Reintentos concurrentes del finalizador son idempotentes');

  const orgCarreraLanding = await montar(duenoA, `Landing carrera ${sello}`);
  const telefonoCarreraLanding = telefonoPrueba(104);
  await rpc('crear_invitacion', {
    p_organizacion_id: orgCarreraLanding, p_rol: 'lector', p_telefono: telefonoCarreraLanding,
  }, { token: duenoA.token });

  const usuarioCarreraLanding = await crearUsuario(
    `alta-landing-carrera-${sello}@flota.test`, telefonoCarreraLanding,
  );

  const resultadosLanding = await Promise.all(
    Array.from({ length: 8 }, () => rpc('finalizar_alta_landing', {}, { token: usuarioCarreraLanding.token })),
  );
  const exitosLanding = resultadosLanding.filter(r => r.ok);
  ok('Todas las llamadas concurrentes del finalizador terminan OK',
     exitosLanding.length === resultadosLanding.length,
     JSON.stringify(resultadosLanding.map(r => r.datos)));

  const canjeadasLanding = exitosLanding.filter(r => r.datos?.estado === 'invitacion_canjeada');
  ok('Exactamente una llamada concurrente canjea la invitacion', canjeadasLanding.length === 1,
     `${canjeadasLanding.length} canjes`);

  const idsOrganizacionLanding = new Set(exitosLanding.map(r => r.datos?.organizacion?.id));
  const idsFlotaLanding = new Set(exitosLanding.map(r => r.datos?.flota?.id));
  const idsVinculoLanding = new Set(exitosLanding.map(r => r.datos?.vinculo?.id));
  ok('Todas las llamadas concurrentes devuelven la misma organizacion, flota y vinculo',
     idsOrganizacionLanding.size === 1 && idsFlotaLanding.size === 1 && idsVinculoLanding.size === 1,
     `${idsOrganizacionLanding.size} orgs, ${idsFlotaLanding.size} flotas, ${idsVinculoLanding.size} vinculos`);

  const vinculosCarreraLanding = await rest(
    `/vinculos_chat?select=id&usuario_id=eq.${usuarioCarreraLanding.id}`, { servicio: true },
  );
  ok('La carrera del finalizador deja un solo vinculo', vinculosCarreraLanding.datos?.length === 1,
     JSON.stringify(vinculosCarreraLanding.datos));
}

try {
  if (process.argv.includes('--solo-formato-auth')) {
    await redFormatoAuth();
  } else {
    await bateriaCompleta();
  }
} catch (error) {
  fallas.push('La bateria termino sin errores inesperados');
  console.error(`  \x1b[31mERROR\x1b[0m ${error.stack || error}`);
} finally {
  await limpiar();
}

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(falla => console.log(`  - ${falla}`));
  process.exitCode = 1;
}
