import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsultasITV, normalizarDominio, leerOperacion, leerResultado } from '../src/consultas.mjs';
import { crearServidor } from '../src/server.mjs';

const contexto = '123:456';
function paginaFalsa(dominio = 'AB672VT') {
  let enviada = false;
  return { cerrada: false, respuesta: undefined,
    texto: async () => enviada ? `Última ITV del dominio: ${dominio}\nResuelva el captcha para continuar: 6 - 6` : 'Resuelva el captcha para continuar: 8 - 5',
    async enviar(valor) { this.respuesta = valor; enviada = true; },
    filas: async () => [['Fecha', 'Vencimiento', 'Estado'], ['31/07/26', '31/07/27', 'No Vencida']],
    async cerrar() { this.cerrada = true; },
  };
}

test('normaliza formatos de autos y motos sin corregir caracteres ambiguos', () => {
  for (const dominio of ['AB672VT', 'ABC123', '123ABC', 'A123ABC']) assert.equal(normalizarDominio(dominio.toLowerCase()), dominio);
  assert.equal(normalizarDominio(' ab-672 vt '), 'AB672VT');
  assert.throws(() => normalizarDominio('AB672V!'));
  assert.throws(() => normalizarDominio('AB672VТ')); // T cirílica
});

test('reconoce las 200 operaciones permitidas; rechaza formato desconocido', () => {
  for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) for (const op of ['+', '-']) {
    assert.equal(leerOperacion(`Resuelva el captcha para continuar: ${a} ${op} ${b}`), `${a} ${op} ${b}`);
  }
  assert.equal(leerOperacion('Resuelva el captcha para continuar: 0 − 9'), '0 - 9');
  assert.throws(() => leerOperacion('Resuelva el captcha para continuar: 1 + 10'));
  assert.throws(() => leerOperacion('Resuelva el captcha para continuar: 3 * 4'));
});

test('misma sesión, respuesta del modelo y captcha renovado no provocan otro envío', async () => {
  const pagina = paginaFalsa();
  const consultas = new ConsultasITV(async () => pagina);
  const inicio = await consultas.iniciar({ dominio: 'AB672VT', contexto_id: contexto });
  assert.equal(inicio.operacion, '8 - 5');
  const resultado = await consultas.completar({ ...inicio, contexto_id: contexto, respuesta: 3 });
  assert.equal(resultado.estado_itv, 'No Vencida');
  assert.equal(pagina.respuesta, 3);
  assert.ok(pagina.cerrada);
  await assert.rejects(consultas.completar({ ...inicio, contexto_id: contexto, respuesta: 3 }), { codigo: 'sesion_no_disponible' });
});

test('una sesión ajena no puede ser consumida y expira incluso con respuesta válida', async () => {
  let tiempo = 0;
  const pagina = paginaFalsa();
  const consultas = new ConsultasITV(async () => pagina, { ahora: () => tiempo, ttlMs: 10 });
  const inicio = await consultas.iniciar({ dominio: 'AB672VT', contexto_id: contexto });
  await assert.rejects(consultas.completar({ ...inicio, contexto_id: '789:999', respuesta: 3 }), { codigo: 'sesion_no_disponible' });
  assert.equal(pagina.cerrada, false);
  tiempo = 11;
  await assert.rejects(consultas.completar({ ...inicio, contexto_id: contexto, respuesta: 3 }), { codigo: 'sesion_expirada' });
  assert.ok(pagina.cerrada);
});

test('reserva capacidad durante la apertura y bloquea duplicados por contexto', async () => {
  let abrir;
  const consultas = new ConsultasITV(() => new Promise(resolve => { abrir = resolve; }), { maxSesiones: 1 });
  const primera = consultas.iniciar({ dominio: 'AB672VT', contexto_id: contexto });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(consultas.iniciar({ dominio: 'ABC123', contexto_id: '999:999' }), { codigo: 'ocupado' });
  abrir(paginaFalsa());
  await primera;
  await assert.rejects(consultas.iniciar({ dominio: 'ABC123', contexto_id: contexto }), { codigo: 'ocupado' });
  await consultas.cerrar();
});

test('no informa éxito con otra patente o con una tabla ausente', () => {
  assert.throws(() => leerResultado('AB672VT', 'Última ITV del dominio: ABC123', []), { codigo: 'resultado_no_verificado' });
  assert.throws(() => leerResultado('AB672VT', 'Última ITV del dominio: AB672VT', []), { codigo: 'resultado_no_verificado' });
});

test('acepta respuesta negativa sin calcularla en servidor y cierra al fallar', async () => {
  const pagina = paginaFalsa();
  pagina.enviar = async function(valor) { this.respuesta = valor; throw new Error('fallo interno con información privada'); };
  const consultas = new ConsultasITV(async () => pagina);
  const inicio = await consultas.iniciar({ dominio: 'AB672VT', contexto_id: contexto });
  await assert.rejects(consultas.completar({ ...inicio, contexto_id: contexto, respuesta: -9 }));
  assert.equal(pagina.respuesta, -9);
  assert.ok(pagina.cerrada);
});

test('HTTP exige autenticación y no revela errores internos', async t => {
  const clave = 'a'.repeat(40);
  const servidor = crearServidor({ iniciar: async () => { throw new Error('secreto'); } }, clave);
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const url = `http://127.0.0.1:${servidor.address().port}/itv/iniciar`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  const headers = { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', headers, body: '[]' })).status, 400);
  const resultado = await fetch(url, { method: 'POST', headers, body: '{}' });
  assert.equal(resultado.status, 502);
  assert.equal((await resultado.json()).codigo, 'sitio_no_disponible');
});
