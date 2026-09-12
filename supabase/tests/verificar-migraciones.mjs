// =============================================================================
// Verifica invariantes de la historia de migraciones sin conectarse a la base.
// 0016 es historia aplicada e inmutable. Su guarda destructiva sin LOCK se
// conserva como incidente documentado, nunca como precedente para migraciones
// posteriores.
// =============================================================================

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRECTORIO_MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations');
const ARCHIVO_0016 = '0016_vinculos_chat_neutral.sql';
const HASH_0016 = 'a72d871113841cf44a8bad15eeea719a442a3946b07d1d96d485a193e8796c0f';
const BYTES_0016 = 16_568;
const LINEAS_0016 = 487;

let pasadas = 0;
const fallas = [];

function ok(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log(`  \x1b[32mOK\x1b[0m   ${nombre}`);
    return;
  }

  fallas.push(nombre);
  console.log(`  \x1b[31mFALLA\x1b[0m ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
}

function quitarComentarios(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function normalizarTabla(tabla) {
  return tabla.toLowerCase().replaceAll('"', '');
}

function dropsSinBloqueoExclusivo(sql) {
  const limpio = quitarComentarios(sql);
  const problemas = [];
  const patronDrop = /\bdrop\s+table\s+(?:if\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)/gim;

  for (const coincidencia of limpio.matchAll(patronDrop)) {
    const tabla = normalizarTabla(coincidencia[1]);
    const prefijo = limpio.slice(0, coincidencia.index);
    const ultimoLimite = Math.max(
      prefijo.toLowerCase().lastIndexOf('commit;'),
      prefijo.toLowerCase().lastIndexOf('rollback;'),
    );
    const transaccion = prefijo.slice(ultimoLimite + 1);
    const bloqueos = [...transaccion.matchAll(
      /\block\s+table\s+((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s+in\s+access\s+exclusive\s+mode\b/gim,
    )].map(item => normalizarTabla(item[1]));

    if (!bloqueos.includes(tabla)) problemas.push(tabla);
  }

  return problemas;
}

console.log('\x1b[1mVerificacion de la historia de migraciones\x1b[0m');

const contenido0016 = await readFile(path.join(DIRECTORIO_MIGRACIONES, ARCHIVO_0016));
const texto0016 = contenido0016.toString('utf8');
const hash0016 = createHash('sha256').update(contenido0016).digest('hex');
const lineas0016 = texto0016.split('\n').length - (texto0016.endsWith('\n') ? 1 : 0);

ok('0016 conserva su SHA-256 aplicado', hash0016 === HASH_0016, hash0016);
ok('0016 conserva su cantidad exacta de bytes', contenido0016.byteLength === BYTES_0016,
   `${contenido0016.byteLength}`);
ok('0016 conserva sus 487 lineas', lineas0016 === LINEAS_0016, `${lineas0016}`);
ok('El incidente de 0016 sigue visible y no se disfraza reescribiendo historia',
   dropsSinBloqueoExclusivo(texto0016).includes('public.vinculos_telegram'));

const archivosPosteriores = (await readdir(DIRECTORIO_MIGRACIONES))
  .filter(nombre => /^\d{4}_.+\.sql$/.test(nombre) && nombre > ARCHIVO_0016)
  .sort();

for (const archivo of archivosPosteriores) {
  const sql = await readFile(path.join(DIRECTORIO_MIGRACIONES, archivo), 'utf8');
  const problemas = dropsSinBloqueoExclusivo(sql);
  ok(`${archivo}: cada DROP TABLE tiene LOCK TABLE ... IN ACCESS EXCLUSIVE MODE previo`,
     problemas.length === 0, problemas.join(', '));
}

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(falla => console.log(`  - ${falla}`));
  process.exitCode = 1;
}
