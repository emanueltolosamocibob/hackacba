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
const ARCHIVO_0017 = '0017_remediar_vinculos_chat.sql';
const ARCHIVO_0018 = '0018_remediar_formato_telefono_auth.sql';
const HASH_0016 = 'a72d871113841cf44a8bad15eeea719a442a3946b07d1d96d485a193e8796c0f';
const HASH_0017 = '589fd8bb6c54e7e12577c82c9da5a1bc23fdc0031b0f47877e37d6a78e37f61b';
const HASH_0018 = 'c9c55f3a54d08317b1c903e32c9206e78fedb3cd597c652fc672ba76f0cb1e78';
const BYTES_0016 = 16_568;
const BYTES_0017 = 17_110;
const BYTES_0018 = 15_108;
const LINEAS_0016 = 487;
const LINEAS_0017 = 485;
const LINEAS_0018 = 428;

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

async function verificarArchivoAplicado({ archivo, hash, bytes, lineas }) {
  const contenido = await readFile(path.join(DIRECTORIO_MIGRACIONES, archivo));
  const texto = contenido.toString('utf8');
  const hashReal = createHash('sha256').update(contenido).digest('hex');
  const lineasReales = texto.split('\n').length - (texto.endsWith('\n') ? 1 : 0);

  ok(`${archivo.slice(0, 4)} conserva su SHA-256 aplicado`, hashReal === hash, hashReal);
  ok(`${archivo.slice(0, 4)} conserva su cantidad exacta de bytes`, contenido.byteLength === bytes,
     `${contenido.byteLength}`);
  ok(`${archivo.slice(0, 4)} conserva sus ${lineas} lineas`, lineasReales === lineas, `${lineasReales}`);
  return texto;
}

console.log('\x1b[1mVerificacion de la historia de migraciones\x1b[0m');

const texto0016 = await verificarArchivoAplicado({
  archivo: ARCHIVO_0016, hash: HASH_0016, bytes: BYTES_0016, lineas: LINEAS_0016,
});
await verificarArchivoAplicado({
  archivo: ARCHIVO_0017, hash: HASH_0017, bytes: BYTES_0017, lineas: LINEAS_0017,
});
await verificarArchivoAplicado({
  archivo: ARCHIVO_0018, hash: HASH_0018, bytes: BYTES_0018, lineas: LINEAS_0018,
});

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
