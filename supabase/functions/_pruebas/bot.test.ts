import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { clasificarEvento, interpretarTexto, secretoValido, telefonoDesdeChatId, mensajeFlota, mensajeLinkPago } from '../_compartido/bot/webhook.ts';
import { extraerDominio, esComandoFlota } from '../_compartido/bot/dominio.ts';
import { normalizarMuni } from '../_compartido/bot/fuentes/muni.ts';
import { normalizarPeaje } from '../_compartido/bot/fuentes/peaje.ts';
import { rentasCba, itv } from '../_compartido/bot/fuentes/estaticas.ts';
import { formatearReporte } from '../_compartido/bot/respuestas.ts';
import type { ResultadoConsulta } from '../_compartido/bot/fuentes/consulta.ts';

const fixtureMuni = JSON.parse(await Deno.readTextFile(new URL('./fixtures/muni-ah827br.json', import.meta.url)));

// ------------------------------------------------------------- secretoValido

Deno.test('secretoValido acepta el secreto exacto', () => {
  assertEquals(secretoValido('abc123', 'abc123'), true);
});

Deno.test('secretoValido rechaza secreto distinto o ausente', () => {
  assertEquals(secretoValido('otro', 'abc123'), false);
  assertEquals(secretoValido(null, 'abc123'), false);
  assertEquals(secretoValido('ab', 'abc123'), false);
});

// ------------------------------------------------------------- clasificarEvento

Deno.test('clasificarEvento ignora fromMe', () => {
  const r = clasificarEvento({ event: 'message', payload: { id: '1', from: '549@c.us', fromMe: true, body: 'hola' } });
  assertEquals(r, { tipo: 'ignorar', razon: 'from_me' });
});

Deno.test('clasificarEvento ignora grupos', () => {
  const r = clasificarEvento({ event: 'message', payload: { id: '1', from: '12345@g.us', body: 'hola' } });
  assertEquals(r, { tipo: 'ignorar', razon: 'grupo' });
});

Deno.test('clasificarEvento ignora eventos que no son mensaje (recibos, estados)', () => {
  const r = clasificarEvento({ event: 'message.ack', payload: { id: '1', from: '549@c.us', body: 'x' } });
  assertEquals(r.tipo, 'ignorar');
});

Deno.test('clasificarEvento ignora mensajes sin texto', () => {
  const r = clasificarEvento({ event: 'message', payload: { id: '1', from: '5493511234567@c.us', body: '' } });
  assertEquals(r, { tipo: 'ignorar', razon: 'no_texto' });
});

Deno.test('clasificarEvento procesa un mensaje de texto valido', () => {
  const r = clasificarEvento({ event: 'message', payload: { id: 'msg1', from: '5493511234567@c.us', body: 'AB123CD' } });
  assertEquals(r, { tipo: 'procesar', idMensaje: 'msg1', telefono: '+5493511234567', texto: 'AB123CD' });
});

Deno.test('telefonoDesdeChatId soporta @c.us y @s.whatsapp.net', () => {
  assertEquals(telefonoDesdeChatId('5493511234567@c.us'), '+5493511234567');
  assertEquals(telefonoDesdeChatId('5493511234567@s.whatsapp.net'), '+5493511234567');
  assertEquals(telefonoDesdeChatId('123@c.us'), null);
});

// ------------------------------------------------------------- extraerDominio

Deno.test('extraerDominio reconoce Mercosur y formato viejo, con espacios o minusculas', () => {
  assertEquals(extraerDominio('mi patente es ab123cd'), 'AB123CD');
  assertEquals(extraerDominio('AB 123 CD'), 'AB123CD');
  assertEquals(extraerDominio('abc123'), 'ABC123');
  assertEquals(extraerDominio('hola como andas'), null);
});

Deno.test('esComandoFlota reconoce variantes', () => {
  assertEquals(esComandoFlota('flota'), true);
  assertEquals(esComandoFlota('Mis Vehiculos'), true);
  assertEquals(esComandoFlota('mis autos'), true);
  assertEquals(esComandoFlota('AB123CD'), false);
});

// ------------------------------------------------------------- interpretarTexto

Deno.test('interpretarTexto: no registrado siempre manda a alta', () => {
  assertEquals(interpretarTexto('AB123CD', false), { accion: 'sin_registrar' });
});

Deno.test('interpretarTexto: registrado con patente consulta ese dominio', () => {
  assertEquals(interpretarTexto('dale, AB123CD', true), { accion: 'consultar_dominio', dominio: 'AB123CD' });
});

Deno.test('interpretarTexto: registrado con "flota" lista vehiculos', () => {
  assertEquals(interpretarTexto('flota', true), { accion: 'listar_flota' });
});

Deno.test('interpretarTexto: registrado sin patente ni comando pide ayuda', () => {
  assertEquals(interpretarTexto('hola', true), { accion: 'ayuda' });
});

Deno.test('interpretarTexto: "link de pago", "pagar" y variantes sin acentos/mayusculas piden el link', () => {
  assertEquals(interpretarTexto('link de pago', true), { accion: 'link_pago' });
  assertEquals(interpretarTexto('Pagar', true), { accion: 'link_pago' });
  assertEquals(interpretarTexto('PAGÁR MUNI', true), { accion: 'link_pago' });
  assertEquals(interpretarTexto('link', true), { accion: 'link_pago' });
});

Deno.test('mensajeLinkPago repite la patente en su propia linea', () => {
  const texto = mensajeLinkPago('AH827BR');
  assertEquals(texto.includes('AH827BR'), true);
  assertEquals(texto.includes('https://tributariomuni.cordoba.gob.ar/automotor'), true);
});

Deno.test('mensajeFlota lista dominios o avisa que esta vacia', () => {
  assertEquals(mensajeFlota([]), 'Todavía no tenés vehículos cargados. Mandame una patente para agregar el primero.');
  assertEquals(mensajeFlota(['AB123CD']), 'Tu flota:\n• AB123CD');
});

// ------------------------------------------------------------- normalizarMuni

Deno.test('normalizarMuni mapea multas reales de AH827BR sin exponer el nombre del titular', () => {
  const r = normalizarMuni(fixtureMuni);
  assertEquals(r.id, 'muni_cordoba');
  assertEquals(r.estado, 'ok');
  assertEquals(r.obligaciones.length, 2);
  assertEquals(r.obligaciones[0].tipo, 'multa');
  assertEquals(r.obligaciones[0].concepto, 'NO ABONAR ESTACIONAMIENTO TARIFADO');
  assertEquals(r.obligaciones[0].referencia, 'F0223966');
  assertEquals(r.obligaciones[0].importe, '13276.80');
  assertEquals(r.obligaciones[0].moneda, 'ARS');
  assertEquals(r.obligaciones[0].origen, { fuente: 'muni_cordoba', idOrigen: '308148037' });
  assertEquals(r.obligaciones[1].importe, '19747.20');
  for (const o of r.obligaciones) {
    assertEquals(JSON.stringify(o).includes('nombre'), false);
  }
});

Deno.test('normalizarMuni: status.success false es sin_datos', () => {
  const r = normalizarMuni({ status: { success: false } });
  assertEquals(r.estado, 'sin_datos');
  assertEquals(r.obligaciones.length, 0);
});

// ------------------------------------------------------------- normalizarPeaje

Deno.test('normalizarPeaje detecta el caso sin infracciones (unico observado)', () => {
  const html = '<div class="alert alert-success">El dominio no posee infracciones impagas.</div>';
  const r = normalizarPeaje(html);
  assertEquals(r.estado, 'ok');
  assertEquals(r.metodo, 'parser');
  assertEquals(r.obligaciones.length, 0);
});

Deno.test('normalizarPeaje: markup desconocido deriva a requiere_usuario, nunca inventa un parser', () => {
  const html = '<div class="cdls-form"><table>...algo nunca visto...</table></div>';
  const r = normalizarPeaje(html);
  assertEquals(r.estado, 'requiere_usuario');
  assertExists(r.url);
});

// ------------------------------------------------------------- adaptadores estaticos

Deno.test('rentasCba e itv nunca hacen red y por defecto piden intervencion del usuario', () => {
  assertEquals(rentasCba().estado, 'requiere_usuario');
  assertEquals(rentasCba().url, 'https://www.rentascordoba.gob.ar/emision/ver-y-pagar/automotor');
  assertEquals(itv().estado, 'requiere_usuario');
  assertEquals(itv().url, 'https://itvcordoba.com.ar/Historico.aspx');
});

Deno.test('rentasCba e itv en modo demo devuelven ok sin deuda, sin dejar de exponer el link real', () => {
  const rentas = rentasCba(true);
  assertEquals(rentas.estado, 'ok');
  assertEquals(rentas.obligaciones.length, 0);
  assertEquals(rentas.url, 'https://www.rentascordoba.gob.ar/emision/ver-y-pagar/automotor');
  const revision = itv(true);
  assertEquals(revision.estado, 'ok');
  assertEquals(revision.url, 'https://itvcordoba.com.ar/Historico.aspx');
});

// ------------------------------------------------------------- formatearReporte

Deno.test('formatearReporte nunca suma un total entre fuentes (el "total" de muni es solo de esa fuente) y repite la patente para los links', () => {
  const resultado: ResultadoConsulta = {
    patente: 'AH827BR',
    consultadoEn: '2026-09-12T22:46:00.000Z',
    fuentes: [normalizarMuni(fixtureMuni), normalizarPeaje('no posee infracciones impagas'), rentasCba(), itv()],
  };
  const texto = formatearReporte(resultado);
  assertEquals(texto.includes('AH827BR'), true);
  // No hay un total combinado: cada bloque de fuente informa por separado.
  assertEquals(texto.match(/total/gi)?.length, 1);
  assertEquals(texto.includes('*Municipalidad de Córdoba*'), true);
  assertEquals(texto.includes('F0223966'), true);
  assertEquals(texto.includes('Patente: AH827BR'), true);
  assertEquals(texto.includes('app.rentascordoba.gob.ar'), false);
});

Deno.test('formatearReporte en modo demo muestra "sin deuda"/"al dia" para rentas_cba/itv', () => {
  const resultado: ResultadoConsulta = {
    patente: 'AH827BR',
    consultadoEn: '2026-09-12T22:46:00.000Z',
    fuentes: [normalizarMuni(fixtureMuni), normalizarPeaje('no posee infracciones impagas'), rentasCba(true), itv(true)],
  };
  const texto = formatearReporte(resultado);
  assertEquals(texto.includes('sin deuda'), true);
  assertEquals(texto.includes('al día'), true);
  assertEquals(texto.includes('itvcordoba.com.ar'), true);
});
