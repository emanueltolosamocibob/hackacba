import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { telefonoParaWaha, validarTelefonoArgentino } from '../_compartido/alta/telefono.ts';

Deno.test('acepta +54 9 mas diez digitos', () => {
  const r = validarTelefonoArgentino('+5493511234567');
  assertEquals(r?.e164, '+5493511234567');
  assertEquals(r?.digitosNacionales, '3511234567');
});

Deno.test('acepta +54 sin el 9 mas diez digitos', () => {
  const r = validarTelefonoArgentino('+543511234567');
  assertEquals(r?.e164, '+543511234567');
  assertEquals(r?.digitosNacionales, '3511234567');
});

Deno.test('acepta el numero sin el signo +', () => {
  const r = validarTelefonoArgentino('5493511234567');
  assertEquals(r?.e164, '+5493511234567');
});

Deno.test('acepta espacios sobrantes al principio y al final', () => {
  const r = validarTelefonoArgentino('  +5493511234567  ');
  assertEquals(r?.e164, '+5493511234567');
});

Deno.test('rechaza un codigo de pais que no es 54', () => {
  assertEquals(validarTelefonoArgentino('+551234567890'), null);
});

Deno.test('rechaza menos de diez digitos nacionales', () => {
  assertEquals(validarTelefonoArgentino('+5435112345'), null);
});

Deno.test('rechaza mas de diez digitos nacionales', () => {
  assertEquals(validarTelefonoArgentino('+54935112345678'), null);
});

Deno.test('rechaza texto que no es un telefono', () => {
  assertEquals(validarTelefonoArgentino('no-es-un-telefono'), null);
  assertEquals(validarTelefonoArgentino(''), null);
});

Deno.test('telefonoParaWaha siempre antepone 549, aunque el numero ya traiga el 9', () => {
  assertEquals(telefonoParaWaha('+5493511234567'), '5493511234567');
});

Deno.test('telefonoParaWaha antepone 549 aunque el numero no traiga el 9', () => {
  assertEquals(telefonoParaWaha('+543511234567'), '5493511234567');
});

Deno.test('telefonoParaWaha rechaza un telefono invalido', () => {
  assertEquals(telefonoParaWaha('no-es-un-telefono'), null);
});
