// =============================================================================
// Datos de demostracion: una flota realista de Cordoba para desarrollar contra
// ella (sobre todo el bot, que necesita algo que consultar).
//
//   node --env-file=.env supabase/semillas/demo.mjs [email] [--recrear]
//
// Si se pasa un email de un usuario que ya existe, la organizacion queda a su
// nombre. Si no existe, se crea y se imprime una clave generada.
//
// No es seed.sql: ese solo corre con `supabase db reset` (necesita Docker) y
// ademas no puede crear usuarios de auth, sin los cuales no hay membresias ni
// se puede probar RLS.
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON     = process.env.SUPABASE_ANON_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan variables. Correr con: node --env-file=.env supabase/semillas/demo.mjs');
  process.exit(1);
}

const args     = process.argv.slice(2);
const recrear  = args.includes('--recrear');
const emailArg = args.find(a => !a.startsWith('--'));
const EMAIL    = emailArg ?? 'demo@flota.test';
const NOMBRE_ORG = 'Transportes del Centro (demo)';

const cab = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

async function api(ruta, { metodo = 'GET', cuerpo, prefer } = {}) {
  const r = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: prefer ? { ...cab, Prefer: prefer } : cab,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw new Error(`${metodo} ${ruta} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

const rest = (ruta, o) => api(`/rest/v1${ruta}`, o);
const rpc  = (fn, args) => api(`/rest/v1/rpc/${fn}`, { metodo: 'POST', cuerpo: args });

// ------------------------------------------------------------------- usuario

async function obtenerUsuario(email) {
  const lista = await api(`/auth/v1/admin/users?page=1&per_page=200`);
  const existente = (lista.users || []).find(u => u.email === email);
  if (existente) return { id: existente.id, creado: false };

  const clave = `demo-${crypto.randomUUID().slice(0, 12)}`;
  const nuevo = await api('/auth/v1/admin/users', {
    metodo: 'POST',
    cuerpo: { email, password: clave, email_confirm: true },
  });
  return { id: nuevo.id, creado: true, clave };
}

// -------------------------------------------------------------------- flota

// Dominios plausibles: viejos AAA123 y Mercosur AB123CD.
const AUTOS = [
  ['AB123CD', 'Toyota',    'Etios',    2021], ['AC456EF', 'Chevrolet', 'Onix',     2022],
  ['AD789GH', 'Renault',   'Logan',    2020], ['AE012IJ', 'Fiat',      'Cronos',   2021],
  ['MNP345',  'Volkswagen','Gol Trend',2016], ['NQR678',  'Peugeot',   '208',      2018],
  ['OST901',  'Ford',      'Ka',       2017], ['PUV234',  'Nissan',    'Versa',    2019],
];
const CAMIONETAS = [
  ['AF345KL', 'Toyota',    'Hilux',    2022], ['AG678MN', 'Ford',      'Ranger',   2021],
  ['AH901OP', 'Volkswagen','Amarok',   2020], ['QWX567',  'Chevrolet', 'S10',      2018],
  ['RYZ890',  'Renault',   'Kangoo',   2017],
];
const CAMIONES = [
  ['AI234QR', 'Mercedes-Benz', 'Accelo', 2019],
  ['SAB123',  'Iveco',         'Tector', 2015],
  ['TCD456',  'Scania',        'P310',   2016],
];

const FLOTAS = [
  { nombre: 'Remises Centro',  descripcion: 'Autos de servicio urbano en Cordoba capital', tipo: 'auto',      unidades: AUTOS,      municipal: true  },
  { nombre: 'Utilitarios',     descripcion: 'Camionetas de reparto y servicios',           tipo: 'camioneta', unidades: CAMIONETAS, municipal: true  },
  { nombre: 'Larga Distancia', descripcion: 'Camiones de transporte interurbano',          tipo: 'camion',    unidades: CAMIONES,   municipal: false },
];

// ------------------------------------------------------------------ escenario

console.log(`Sembrando "${NOMBRE_ORG}" en ${URL_BASE}\n`);

const previas = await rest(`/organizaciones?select=id,nombre&nombre=eq.${encodeURIComponent(NOMBRE_ORG)}`);
if (previas.length) {
  if (!recrear) {
    console.log(`Ya existe (${previas[0].id}). Para rehacerla desde cero:`);
    console.log('  node --env-file=.env supabase/semillas/demo.mjs --recrear');
    process.exit(0);
  }
  for (const o of previas) {
    await rest(`/organizaciones?id=eq.${o.id}`, { metodo: 'DELETE' });
    console.log(`  organizacion previa borrada (${o.id})`);
  }
}

const usuario = await obtenerUsuario(EMAIL);
console.log(`Usuario ${EMAIL}: ${usuario.creado ? 'creado' : 'ya existia'}`);

const orgId = crypto.randomUUID();
await rest('/organizaciones', {
  metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { id: orgId, nombre: NOMBRE_ORG, cuit: '30712345678' },
});
// El trigger de propietario solo actua con auth.uid(); aca escribe service_role.
await rest('/miembros', {
  metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: orgId, usuario_id: usuario.id, rol: 'propietario' },
});
await rpc('sembrar_catalogo_cordoba', { p_organizacion_id: orgId });

const tipos = Object.fromEntries(
  (await rest(`/tipos_obligacion?select=id,codigo&organizacion_id=eq.${orgId}`))
    .map(t => [t.codigo, t.id]),
);
console.log(`Organizacion ${orgId} con catalogo de ${Object.keys(tipos).length} tipos`);

// ---- Flotas y vehiculos ----------------------------------------------------

const vehiculos = [];
for (const f of FLOTAS) {
  const flotaId = crypto.randomUUID();
  await rest('/flotas', {
    metodo: 'POST', prefer: 'return=minimal',
    cuerpo: { id: flotaId, organizacion_id: orgId, nombre: f.nombre, descripcion: f.descripcion },
  });

  const lote = f.unidades.map(([dominio, marca, modelo, anio]) => ({
    id: crypto.randomUUID(),
    organizacion_id: orgId,
    flota_id: flotaId,
    dominio, marca, modelo, anio,
    tipo: f.tipo,
    fecha_alta: `${anio}-03-15`,
  }));
  await rest('/vehiculos', { metodo: 'POST', prefer: 'return=minimal', cuerpo: lote });

  lote.forEach(v => vehiculos.push({ ...v, municipal: f.municipal }));
  console.log(`  flota "${f.nombre}": ${lote.length} vehiculos`);
}

// ---- Reglas ----------------------------------------------------------------

const anio = new Date().getFullYear();
const reglas = [];

for (const v of vehiculos) {
  const base = { organizacion_id: orgId, vehiculo_id: v.id, vigente_desde: `${anio}-01-01` };

  // Impuesto automotor: 5 cuotas al anio, calendario explicito. El importe
  // sube con el valor del vehiculo, aproximado por tipo y antiguedad.
  const valorBase = v.tipo === 'camion' ? 180000 : v.tipo === 'camioneta' ? 95000 : 48000;
  const ajuste = Math.max(0.4, 1 - (anio - v.anio) * 0.07);
  reglas.push({
    ...base, tipo_obligacion_id: tipos.impuesto_automotor_pcial,
    frecuencia: 'anual', meses_cuotas: [2, 4, 6, 8, 10], dia_vencimiento: 15,
    monto_estimado: Math.round(valorBase * ajuste / 100) * 100,
  });

  reglas.push({
    ...base, tipo_obligacion_id: tipos.seguro,
    frecuencia: 'mensual', dia_vencimiento: 10, mes_inicio: 1,
    monto_estimado: v.tipo === 'camion' ? 145000 : v.tipo === 'camioneta' ? 88000 : 62000,
  });

  if (v.municipal) {
    reglas.push({
      ...base, tipo_obligacion_id: tipos.tasa_municipal_automotor,
      frecuencia: 'bimestral', dia_vencimiento: 20, mes_inicio: 1,
      monto_estimado: 12000,
    });
  }

  // RTO: anual para lo comercial, y el mes se reparte por dominio para que los
  // vencimientos no caigan todos juntos.
  reglas.push({
    ...base, tipo_obligacion_id: tipos.vtv,
    frecuencia: 'anual', dia_vencimiento: 28,
    mes_inicio: (v.dominio.charCodeAt(0) % 12) + 1,
    monto_estimado: v.tipo === 'camion' ? 42000 : 24000,
  });

  // GNC solo en los autos mas viejos, que es donde suele estar.
  if (v.tipo === 'auto' && v.anio <= 2018) {
    reglas.push({
      ...base, tipo_obligacion_id: tipos.gnc,
      frecuencia: 'semestral', dia_vencimiento: 5, mes_inicio: 3,
      monto_estimado: 35000,
    });
  }
}

// PostgREST exige que en un insert masivo todos los objetos tengan las mismas
// claves. Las reglas son heterogeneas (solo algunas llevan meses_cuotas), asi
// que se las lleva a una forma canonica antes de mandarlas.
const CLAVES_REGLA = [
  'organizacion_id', 'vehiculo_id', 'tipo_obligacion_id', 'frecuencia',
  'dia_vencimiento', 'mes_inicio', 'meses_cuotas', 'monto_estimado', 'vigente_desde',
];
const reglasNormalizadas = reglas.map(r =>
  Object.fromEntries(CLAVES_REGLA.map(k =>
    [k, k === 'mes_inicio' ? (r[k] ?? 1) : (r[k] ?? null)])));

await rest('/reglas_vencimiento', {
  metodo: 'POST', prefer: 'return=minimal', cuerpo: reglasNormalizadas,
});
console.log(`  ${reglas.length} reglas de vencimiento`);

// ---- Motor -----------------------------------------------------------------

const generados = await rpc('generar_vencimientos_organizacion', {
  p_organizacion_id: orgId, p_horizonte_meses: 12,
});
console.log(`  ${generados} vencimientos generados`);

// ---- Pagos históricos ------------------------------------------------------
//
// Se paga todo lo anterior a hace 2 meses. Lo reciente queda impago, para que
// el dataset tenga a la vez historial de gastos y alarmas vivas.

const hoy = new Date();
const corte = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1).toISOString().slice(0, 10);

const aPagar = await rest(
  `/vencimientos?select=id,monto_estimado,fecha_vencimiento&organizacion_id=eq.${orgId}` +
  `&fecha_vencimiento=lt.${corte}&estado=eq.pendiente&limit=2000`,
);

const medios = ['transferencia', 'debito_automatico', 'homebanking', 'rapipago'];
const pagos = aPagar.map((v, i) => ({
  organizacion_id: orgId,
  vencimiento_id: v.id,
  monto: v.monto_estimado,
  fecha_pago: v.fecha_vencimiento,
  medio_pago: medios[i % medios.length],
  referencia: `OP-${100000 + i}`,
}));

// El trigger de estado corre por fila; se manda en tandas para no hacer una
// unica transaccion enorme.
for (let i = 0; i < pagos.length; i += 100) {
  await rest('/pagos', { metodo: 'POST', prefer: 'return=minimal', cuerpo: pagos.slice(i, i + 100) });
}
console.log(`  ${pagos.length} pagos historicos registrados`);

// Un par de pagos parciales, para que exista ese estado en el dataset.
const parciales = await rest(
  `/vencimientos?select=id,monto_estimado&organizacion_id=eq.${orgId}` +
  `&estado=eq.pendiente&fecha_vencimiento=lt.${hoy.toISOString().slice(0, 10)}&limit=3`,
);
for (const v of parciales) {
  await rest('/pagos', {
    metodo: 'POST', prefer: 'return=minimal',
    cuerpo: {
      organizacion_id: orgId, vencimiento_id: v.id,
      monto: Math.round(v.monto_estimado * 0.4), medio_pago: 'efectivo',
      referencia: 'pago parcial',
    },
  });
}
console.log(`  ${parciales.length} vencimientos con pago parcial`);

// ---- Avisos ----------------------------------------------------------------

const encolados = await rpc('programar_avisos', { p_organizacion_id: orgId, p_ventana_dias: 7 });
console.log(`  ${encolados} avisos encolados`);

// ---- Resumen ---------------------------------------------------------------

const resumenes = await rest(`/resumenes_flota?select=*&organizacion_id=eq.${orgId}`);

console.log('\nEstado de las flotas:');
for (const r of resumenes) {
  const flota = (await rest(`/flotas?select=nombre&id=eq.${r.flota_id}`))[0];
  console.log(
    `  ${flota.nombre.padEnd(18)} ` +
    `${String(r.total_vehiculos).padStart(2)} unidades · ` +
    `${String(r.cantidad_vencidos).padStart(3)} vencidos ($${Number(r.monto_vencido).toLocaleString('es-AR')}) · ` +
    `${String(r.cantidad_pendientes).padStart(3)} por vencer · ` +
    `proximo ${r.proximo_vencimiento ?? '-'}`,
  );
}

console.log(`\nOrganizacion: ${orgId}`);
console.log(`Propietario:  ${EMAIL}`);
if (usuario.creado) {
  console.log(`Clave generada para la cuenta de demo: ${usuario.clave}`);
  console.log('(cuenta descartable de desarrollo; cambiala si la vas a usar en serio)');
}
