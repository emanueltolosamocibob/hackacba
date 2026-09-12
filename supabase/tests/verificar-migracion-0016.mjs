// =============================================================================
// Prueba historica de 0016 sobre un stack Supabase LOCAL y descartable.
//
// Uso:
//   SUPABASE_MIGRATION_TEST_URL=postgresql://...@127.0.0.1:puerto/postgres \
//     node supabase/tests/verificar-migracion-0016.mjs
//
// La URL es obligatoria y debe apuntar a loopback. El script DESTRUYE esa base,
// la lleva a 0015 y aplica los archivos 0016/0017 exactos. Nunca acepta una URL
// de nube ni usa el proyecto enlazado.
// =============================================================================

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRACION_0016 = path.join(RAIZ, 'supabase', 'migrations', '0016_vinculos_chat_neutral.sql');
const MIGRACION_0017 = path.join(RAIZ, 'supabase', 'migrations', '0017_remediar_vinculos_chat.sql');
const HASH_0016 = 'a72d871113841cf44a8bad15eeea719a442a3946b07d1d96d485a193e8796c0f';
const URL_PRUEBA = process.env.SUPABASE_MIGRATION_TEST_URL;

if (!URL_PRUEBA) {
  console.error('Falta SUPABASE_MIGRATION_TEST_URL. Debe ser una base Supabase local y descartable.');
  process.exit(1);
}

let url;
try {
  url = new URL(URL_PRUEBA);
} catch {
  console.error('SUPABASE_MIGRATION_TEST_URL no es una URL PostgreSQL valida.');
  process.exit(1);
}

const hostLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !hostLoopback) {
  console.error('Rechazado: la prueba historica solo puede destruir una base PostgreSQL en loopback.');
  process.exit(1);
}

function ejecutar(argumentos, { aceptarFallo = false, proyecto = RAIZ } = {}) {
  const resultado = spawnSync('npx', ['--yes', 'supabase', ...argumentos], {
    cwd: proyecto,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (resultado.error) throw resultado.error;
  if (!aceptarFallo && resultado.status !== 0) {
    throw new Error(`${argumentos.join(' ')} fallo:\n${resultado.stderr || resultado.stdout}`);
  }
  return resultado;
}

async function crearProyectoTemporal() {
  const proyecto = await mkdtemp(path.join(os.tmpdir(), 'hackacba-migracion-0016-'));
  const supabase = path.join(proyecto, 'supabase');
  const migraciones = path.join(supabase, 'migrations');
  await mkdir(migraciones, { recursive: true });
  await copyFile(path.join(RAIZ, 'supabase', 'config.toml'), path.join(supabase, 'config.toml'));

  const archivos = (await readdir(path.join(RAIZ, 'supabase', 'migrations')))
    .filter(nombre => /^00(0[1-9]|1[0-5])_.+\.sql$/.test(nombre));
  for (const archivo of archivos) {
    await copyFile(
      path.join(RAIZ, 'supabase', 'migrations', archivo),
      path.join(migraciones, archivo),
    );
  }
  return proyecto;
}

function reiniciarEn0015(proyecto) {
  ejecutar(['db', 'reset', '--db-url', URL_PRUEBA, '--version', '0015', '--no-seed'], { proyecto });
}

async function agregarMigracion(proyecto, archivo) {
  await copyFile(archivo, path.join(proyecto, 'supabase', 'migrations', path.basename(archivo)));
}

function aplicarPendientes(proyecto, aceptarFallo = false) {
  return ejecutar(['migration', 'up', '--db-url', URL_PRUEBA], { aceptarFallo, proyecto });
}

function consultar(proyecto, sql) {
  return ejecutar(['db', 'query', '--db-url', URL_PRUEBA, '--output', 'csv', sql], { proyecto }).stdout.trim();
}

const contenido0016 = await readFile(MIGRACION_0016);
const hash0016 = createHash('sha256').update(contenido0016).digest('hex');
if (hash0016 !== HASH_0016) throw new Error(`0016 no es el archivo aplicado: ${hash0016}`);

console.log('\x1b[1mPrueba historica local de 0016\x1b[0m');

const proyecto = await crearProyectoTemporal();
try {
  reiniciarEn0015(proyecto);
  await agregarMigracion(proyecto, MIGRACION_0016);
  aplicarPendientes(proyecto);
  await agregarMigracion(proyecto, MIGRACION_0017);
  aplicarPendientes(proyecto);
  console.log('  \x1b[32mOK\x1b[0m   0016 exacta y 0017 aplican sobre una base vacia en 0015');

  reiniciarEn0015(proyecto);
  consultar(proyecto, `insert into auth.users (id, aud, role, email)
    values ('00000000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'historia-0016@local.test')`);
  consultar(proyecto, `insert into public.vinculos_telegram (usuario_id, telegram_user_id, chat_id)
    values ('00000000-0000-4000-8000-000000000016', 16, 16)`);

  const intento = aplicarPendientes(proyecto, true);
  if (intento.status === 0) throw new Error('0016 debio abortar al encontrar una fila heredada');

  const conservaFila = consultar(proyecto, `select
    (to_regclass('public.vinculos_telegram') is not null)::text as tabla,
    count(*)::text as filas from public.vinculos_telegram`);
  if (!conservaFila.includes('true') || !conservaFila.includes('1')) {
    throw new Error(`0016 aborto, pero no conservo tabla y fila: ${conservaFila}`);
  }

  console.log('  \x1b[32mOK\x1b[0m   Una fila heredada confirmada hace abortar 0016 sin perder tabla ni datos');
  console.log('  \x1b[32mOK\x1b[0m   La prueba no atribuye a 0016 proteccion frente a escritores concurrentes');
} finally {
  await rm(proyecto, { recursive: true, force: true });
}
