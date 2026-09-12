import { assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  type DependenciasHookSms,
  ErrorVerificacion,
  manejarHookSms,
  verificarHookSms,
} from '../_compartido/alta/hook-sms.ts';
import { evaluarCors } from '../_compartido/alta/cors.ts';
import { manejarFinalizarAltaLanding } from '../_compartido/alta/finalizador.ts';
import { crearProveedorOtpFalso } from '../_compartido/alta/mensajeria/falso.ts';

// ------------------------------------------------------------ helper de firma

const SECRETO = 'whsec_' + btoa('clave-de-prueba-0123456789');

async function firmarStandardWebhook(id: string, timestamp: string, cuerpo: string, secreto = SECRETO) {
  const sinPrefijo = secreto.slice('whsec_'.length);
  const clave = Uint8Array.from(atob(sinPrefijo), (c) => c.charCodeAt(0));
  const criptoClave = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const firma = await crypto.subtle.sign('HMAC', criptoClave, new TextEncoder().encode(`${id}.${timestamp}.${cuerpo}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(firma)))}`;
}

function cuerpoValido(otp = '123456') {
  return JSON.stringify({ user: { id: 'user-1', phone: '+5493511234567' }, sms: { otp } });
}

async function headersValidos(cuerpo: string, id = 'msg_1') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const firma = await firmarStandardWebhook(id, timestamp, cuerpo);
  return new Headers({ 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': firma });
}

// ------------------------------------------------------------- verificarHookSms

Deno.test('verificarHookSms acepta una firma valida y devuelve el payload', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo);
  const resultado = await verificarHookSms(cuerpo, headers, SECRETO);
  assertEquals(resultado.idEntrega, 'msg_1');
  assertEquals(resultado.payload.sms.otp, '123456');
  assertEquals(resultado.payload.user.phone, '+5493511234567');
});

Deno.test('verificarHookSms rechaza una firma incorrecta', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo);
  headers.set('webhook-signature', 'v1,ZmlybWFJbnZlbnRhZGE=');
  await assertRejects(() => verificarHookSms(cuerpo, headers, SECRETO), ErrorVerificacion);
});

Deno.test('verificarHookSms rechaza cabeceras faltantes', async () => {
  const cuerpo = cuerpoValido();
  await assertRejects(() => verificarHookSms(cuerpo, new Headers(), SECRETO), ErrorVerificacion);
});

Deno.test('verificarHookSms rechaza una firma con secreto equivocado', async () => {
  const cuerpo = cuerpoValido();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const firma = await firmarStandardWebhook('msg_x', timestamp, cuerpo, 'whsec_' + btoa('otro-secreto'));
  const headers = new Headers({ 'webhook-id': 'msg_x', 'webhook-timestamp': timestamp, 'webhook-signature': firma });
  await assertRejects(() => verificarHookSms(cuerpo, headers, SECRETO), ErrorVerificacion);
});

Deno.test('verificarHookSms rechaza una firma fuera de tolerancia (expirada)', async () => {
  const cuerpo = cuerpoValido();
  const id = 'msg_viejo';
  const timestamp = String(Math.floor(Date.now() / 1000) - 60 * 60);
  const firma = await firmarStandardWebhook(id, timestamp, cuerpo);
  const headers = new Headers({ 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': firma });
  await assertRejects(() => verificarHookSms(cuerpo, headers, SECRETO), ErrorVerificacion);
});

Deno.test('verificarHookSms rechaza un payload que no cumple el esquema', async () => {
  const cuerpo = JSON.stringify({ user: { id: 'x' } });
  const headers = await headersValidos(cuerpo, 'msg_mal_formado');
  await assertRejects(() => verificarHookSms(cuerpo, headers, SECRETO), ErrorVerificacion);
});

Deno.test('verificarHookSms rechaza un cuerpo que no es JSON', async () => {
  const cuerpo = 'esto no es json';
  const headers = await headersValidos(cuerpo, 'msg_no_json');
  await assertRejects(() => verificarHookSms(cuerpo, headers, SECRETO), ErrorVerificacion);
});

// -------------------------------------------------------------- manejarHookSms

function depsBase(overrides: Partial<DependenciasHookSms> = {}): DependenciasHookSms {
  return {
    secreto: SECRETO,
    proveedor: crearProveedorOtpFalso(),
    senal: new AbortController().signal,
    reservar: () => Promise.resolve({ estado: 'procesar' }),
    cerrar: () => Promise.resolve(),
    ...overrides,
  };
}

Deno.test('manejarHookSms manda el OTP cuando la reserva dice procesar', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo, 'msg_ok');
  const proveedor = crearProveedorOtpFalso();

  const resultado = await manejarHookSms(cuerpo, headers, depsBase({ proveedor }));

  assertEquals(resultado.status, 200);
  assertEquals(resultado.cuerpo, {});
  assertEquals(proveedor.llamadas.length, 1);
  assertEquals(proveedor.llamadas[0].telefonoE164, '+5493511234567');
});

Deno.test('manejarHookSms no llama al proveedor ante un webhook-id duplicado', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo, 'msg_dup');
  const proveedor = crearProveedorOtpFalso();

  const resultado = await manejarHookSms(
    cuerpo,
    headers,
    depsBase({ proveedor, reservar: () => Promise.resolve({ estado: 'duplicada' }) }),
  );

  assertEquals(resultado.status, 200);
  assertEquals(resultado.cuerpo, {});
  assertEquals(proveedor.llamadas.length, 0);
});

Deno.test('manejarHookSms responde 429 con retry-after cuando esta limitado', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo, 'msg_limitado');
  const proveedor = crearProveedorOtpFalso();

  const resultado = await manejarHookSms(
    cuerpo,
    headers,
    depsBase({ proveedor, reservar: () => Promise.resolve({ estado: 'limitada' }) }),
  );

  assertEquals(resultado.status, 429);
  assertEquals(resultado.encabezados?.['retry-after'], '900');
  assertEquals(proveedor.llamadas.length, 0);
});

Deno.test('manejarHookSms responde 503 generico cuando el proveedor esta caido', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo, 'msg_caido');
  const proveedor = crearProveedorOtpFalso({ resultado: { estado: 'no_disponible', reintentable: true } });
  let cerradoComo: string | undefined;

  const resultado = await manejarHookSms(
    cuerpo,
    headers,
    depsBase({
      proveedor,
      cerrar: (_id, estado) => {
        cerradoComo = estado;
        return Promise.resolve();
      },
    }),
  );

  assertEquals(resultado.status, 503);
  assertEquals(cerradoComo, 'fallida');
});

Deno.test('manejarHookSms rechaza un webhook mal firmado antes de tocar la reserva', async () => {
  const cuerpo = cuerpoValido();
  const headers = await headersValidos(cuerpo, 'msg_firma_mala');
  headers.set('webhook-signature', 'v1,ZmlybWFJbnZlbnRhZGE=');
  let reservado = false;

  const resultado = await manejarHookSms(
    cuerpo,
    headers,
    depsBase({ reservar: () => { reservado = true; return Promise.resolve({ estado: 'procesar' }); } }),
  );

  assertEquals(resultado.status, 401);
  assertEquals(reservado, false);
});

Deno.test('manejarHookSms nunca deja el OTP en la respuesta (ningun camino)', async () => {
  const otp = '998877';
  const cuerpo = cuerpoValido(otp);

  const caminos = [
    { id: 'msg_redact_ok', deps: depsBase() },
    { id: 'msg_redact_dup', deps: depsBase({ reservar: () => Promise.resolve({ estado: 'duplicada' }) }) },
    { id: 'msg_redact_lim', deps: depsBase({ reservar: () => Promise.resolve({ estado: 'limitada' }) }) },
    {
      id: 'msg_redact_caido',
      deps: depsBase({ proveedor: crearProveedorOtpFalso({ resultado: { estado: 'no_disponible', reintentable: true } }) }),
    },
  ];

  for (const { id, deps } of caminos) {
    const headers = await headersValidos(cuerpo, id);
    const resultado = await manejarHookSms(cuerpo, headers, deps);
    const serializado = JSON.stringify(resultado);
    assertEquals(serializado.includes(otp), false, `el camino ${id} filtro el OTP`);
  }
});

// ------------------------------------------------------------------------ CORS

const ORIGENES = ['http://localhost:5173', 'http://127.0.0.1:5173'];

Deno.test('CORS refleja exactamente el origen permitido y marca Vary', () => {
  const r = evaluarCors('http://localhost:5173', ORIGENES);
  assertEquals(r.permitido, true);
  assertEquals(r.encabezados['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assertEquals(r.encabezados['Vary'], 'Origin');
});

Deno.test('CORS rechaza un origen no listado', () => {
  const r = evaluarCors('https://evil.example', ORIGENES);
  assertEquals(r.permitido, false);
  assertEquals(r.encabezados['Access-Control-Allow-Origin'], undefined);
});

Deno.test('CORS rechaza el origen "null"', () => {
  const r = evaluarCors('null', ORIGENES);
  assertEquals(r.permitido, false);
});

Deno.test('CORS rechaza un origen ausente', () => {
  const r = evaluarCors(null, ORIGENES);
  assertEquals(r.permitido, false);
});

Deno.test('CORS jamas emite comodin', () => {
  for (const origen of [...ORIGENES, 'https://evil.example', null, 'null']) {
    const r = evaluarCors(origen, ORIGENES);
    assertNotEquals(r.encabezados['Access-Control-Allow-Origin'], '*');
  }
});

// ---------------------------------------------------------- finalizar-alta-landing

Deno.test('el finalizador exige un bearer y lo reenvia tal cual (nunca service_role)', async () => {
  let recibido: string | undefined;

  const resultado = await manejarFinalizarAltaLanding('POST', ORIGENES[0], 'Bearer token-de-prueba', {
    origenesPermitidos: ORIGENES,
    llamarFinalizador(bearer) {
      recibido = bearer;
      return Promise.resolve({ estado: 'registrado' });
    },
  });

  assertEquals(resultado.status, 200);
  assertEquals(recibido, 'token-de-prueba');
});

Deno.test('el finalizador rechaza sin bearer sin llamar al RPC', async () => {
  let llamado = false;

  const resultado = await manejarFinalizarAltaLanding('POST', ORIGENES[0], null, {
    origenesPermitidos: ORIGENES,
    llamarFinalizador() {
      llamado = true;
      return Promise.resolve({});
    },
  });

  assertEquals(resultado.status, 401);
  assertEquals(llamado, false);
});

Deno.test('el finalizador rechaza un origen no exacto sin llamar al RPC', async () => {
  let llamado = false;

  const resultado = await manejarFinalizarAltaLanding('POST', 'https://evil.example', 'Bearer x', {
    origenesPermitidos: ORIGENES,
    llamarFinalizador() {
      llamado = true;
      return Promise.resolve({});
    },
  });

  assertEquals(resultado.status, 403);
  assertEquals(llamado, false);
});

Deno.test('el finalizador traduce identidad_en_uso a 409', async () => {
  const resultado = await manejarFinalizarAltaLanding('POST', ORIGENES[0], 'Bearer x', {
    origenesPermitidos: ORIGENES,
    llamarFinalizador() {
      return Promise.reject({ estadoHttp: 422, detalle: 'identidad_en_uso' });
    },
  });

  assertEquals(resultado.status, 409);
  assertEquals(resultado.cuerpo.error, 'identidad_en_uso');
});

Deno.test('el finalizador traduce un JWT rechazado por PostgREST a sesion_invalida', async () => {
  const resultado = await manejarFinalizarAltaLanding('POST', ORIGENES[0], 'Bearer vencido', {
    origenesPermitidos: ORIGENES,
    llamarFinalizador() {
      return Promise.reject({ estadoHttp: 401 });
    },
  });

  assertEquals(resultado.status, 401);
  assertEquals(resultado.cuerpo.error, 'sesion_invalida');
});
