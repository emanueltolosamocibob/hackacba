// =============================================================================
// Verificacion extremo a extremo contra el proyecto Supabase vinculado.
//
// Sustituye a los tests pgTAP mientras Docker no funcione en esta maquina:
// `supabase test db` necesita el stack local. A cambio, esta version es mas
// fiel para lo que mas importa -- usuarios reales, JWT reales y PostgREST real
// -- que es exactamente como va a pegarle el cliente.
//
//   node --env-file=.env supabase/tests/verificar.mjs
// =============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON     = process.env.SUPABASE_ANON_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Correr con: node --env-file=.env supabase/tests/verificar.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------- utilidades

let pasadas = 0;
const fallas = [];

function ok(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log(`  \x1b[32mOK\x1b[0m   ${nombre}`);
  } else {
    fallas.push(nombre);
    console.log(`  \x1b[31mFALLA\x1b[0m ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  }
}

function seccion(titulo) {
  console.log(`\n\x1b[1m${titulo}\x1b[0m`);
}

async function api(ruta, { token, metodo = 'GET', cuerpo, prefer, servicio = false } = {}) {
  const cabeceras = {
    apikey: servicio ? SERVICE : ANON,
    Authorization: `Bearer ${servicio ? SERVICE : token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) cabeceras.Prefer = prefer;

  const r = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: r.status, ok: r.ok, datos };
}

const rest = (ruta, opciones) => api(`/rest/v1${ruta}`, opciones);
const rpc  = (fn, args, opciones) =>
  api(`/rest/v1/rpc/${fn}`, { metodo: 'POST', cuerpo: args, ...opciones });

async function crearUsuario(email) {
  const clave = `Prueba-${crypto.randomUUID()}`;
  const alta = await api('/auth/v1/admin/users', {
    metodo: 'POST',
    servicio: true,
    cuerpo: { email, password: clave, email_confirm: true },
  });
  if (!alta.ok) throw new Error(`No se pudo crear ${email}: ${JSON.stringify(alta.datos)}`);

  const sesion = await api('/auth/v1/token?grant_type=password', {
    metodo: 'POST',
    servicio: false,
    token: ANON,
    cuerpo: { email, password: clave },
  });
  if (!sesion.ok) throw new Error(`No se pudo autenticar ${email}: ${JSON.stringify(sesion.datos)}`);

  return { id: alta.datos.id, email, token: sesion.datos.access_token };
}

// Arma una organizacion completa: org, catalogo, flota y un vehiculo.
async function montarOrganizacion(usuario, { nombreOrg, nombreFlota, dominio }) {
  const orgId = crypto.randomUUID();

  const alta = await rest('/organizaciones', {
    token: usuario.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: { id: orgId, nombre: nombreOrg },
  });
  if (!alta.ok) throw new Error(`alta de organizacion: ${JSON.stringify(alta.datos)}`);

  await rpc('sembrar_catalogo_cordoba', { p_organizacion_id: orgId }, { token: usuario.token });

  const flotaId = crypto.randomUUID();
  const altaFlota = await rest('/flotas', {
    token: usuario.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: { id: flotaId, organizacion_id: orgId, nombre: nombreFlota },
  });
  if (!altaFlota.ok) throw new Error(`alta de flota: ${JSON.stringify(altaFlota.datos)}`);

  const vehiculoId = crypto.randomUUID();
  const altaVeh = await rest('/vehiculos', {
    token: usuario.token,
    metodo: 'POST',
    prefer: 'return=minimal',
    cuerpo: {
      id: vehiculoId, organizacion_id: orgId, flota_id: flotaId,
      dominio, marca: 'Ford', modelo: 'Focus', anio: 2019,
    },
  });
  if (!altaVeh.ok) throw new Error(`alta de vehiculo: ${JSON.stringify(altaVeh.datos)}`);

  const tipos = await rest(
    `/tipos_obligacion?organizacion_id=eq.${orgId}&select=id,codigo`,
    { token: usuario.token },
  );

  return { orgId, flotaId, vehiculoId, tipos: Object.fromEntries((tipos.datos || []).map(t => [t.codigo, t.id])) };
}

// ------------------------------------------------------------------ escenario

const sello = Date.now();
console.log(`\x1b[1mVerificacion contra ${URL_BASE}\x1b[0m`);

const usuarioA = await crearUsuario(`prueba-a-${sello}@flota.test`);
const usuarioB = await crearUsuario(`prueba-b-${sello}@flota.test`);

seccion('1. Alta de organizacion y trigger de propietario');

const a = await montarOrganizacion(usuarioA, {
  nombreOrg: `Flota A ${sello}`, nombreFlota: 'Cordoba Capital', dominio: 'AAA111',
});
const b = await montarOrganizacion(usuarioB, {
  nombreOrg: `Flota B ${sello}`, nombreFlota: 'Rio Cuarto', dominio: 'BBB222',
});

const orgsA = await rest('/organizaciones?select=id,nombre', { token: usuarioA.token });
ok('El creador queda como propietario y ve su organizacion',
   orgsA.datos?.length === 1 && orgsA.datos[0].id === a.orgId,
   JSON.stringify(orgsA.datos));

const miembrosA = await rest(`/miembros?select=rol&organizacion_id=eq.${a.orgId}`, { token: usuarioA.token });
ok('El rol asignado es propietario',
   miembrosA.datos?.[0]?.rol === 'propietario', JSON.stringify(miembrosA.datos));

ok('El catalogo de Cordoba quedo sembrado (6 tipos)',
   Object.keys(a.tipos).length === 6, Object.keys(a.tipos).join(','));

seccion('2. Aislamiento entre organizaciones (RLS)');

const vehiculosA = await rest('/vehiculos?select=dominio', { token: usuarioA.token });
ok('A ve solo sus vehiculos',
   vehiculosA.datos?.length === 1 && vehiculosA.datos[0].dominio === 'AAA111',
   JSON.stringify(vehiculosA.datos));

const fisgoneo = await rest(`/vehiculos?select=dominio&organizacion_id=eq.${b.orgId}`, { token: usuarioA.token });
ok('A filtrando explicitamente por la organizacion de B no obtiene nada',
   Array.isArray(fisgoneo.datos) && fisgoneo.datos.length === 0,
   JSON.stringify(fisgoneo.datos));

const orgsDeA = await rest('/organizaciones?select=id', { token: usuarioA.token });
ok('A no ve la organizacion de B',
   !(orgsDeA.datos || []).some(o => o.id === b.orgId));

const intruso = await rest('/vehiculos', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: b.orgId, flota_id: b.flotaId, dominio: 'XXX999' },
});
ok('A no puede insertar un vehiculo en la organizacion de B',
   !intruso.ok, `estado ${intruso.estado}`);

const anon = await rest('/vehiculos?select=dominio', { token: ANON });
ok('Un anonimo no ve ningun vehiculo',
   Array.isArray(anon.datos) && anon.datos.length === 0, JSON.stringify(anon.datos));

seccion('3. Motor de vencimientos: frecuencia bimestral');

const reglaBimestral = crypto.randomUUID();
const altaRegla = await rest('/reglas_vencimiento', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: reglaBimestral, organizacion_id: a.orgId, vehiculo_id: a.vehiculoId,
    tipo_obligacion_id: a.tipos.seguro, frecuencia: 'bimestral',
    dia_vencimiento: 10, mes_inicio: 1, monto_estimado: 50000,
    vigente_desde: '2026-01-01', vigente_hasta: '2026-12-31',
  },
});
ok('Se crea la regla bimestral', altaRegla.ok, JSON.stringify(altaRegla.datos));

const gen1 = await rpc('generar_vencimientos',
  { p_regla_id: reglaBimestral, p_horizonte_meses: 12 }, { token: usuarioA.token });
ok('Genera 6 cuotas en el anio', gen1.datos === 6, `devolvio ${JSON.stringify(gen1.datos)}`);

const cuotas = await rest(
  `/vencimientos?select=periodo,numero_cuota,fecha_vencimiento&vehiculo_id=eq.${a.vehiculoId}` +
  `&tipo_obligacion_id=eq.${a.tipos.seguro}&order=fecha_vencimiento`,
  { token: usuarioA.token });

const esperadas = ['2026-01-10','2026-03-10','2026-05-10','2026-07-10','2026-09-10','2026-11-10'];
ok('Las fechas caen en los meses impares, dia 10',
   JSON.stringify((cuotas.datos || []).map(c => c.fecha_vencimiento)) === JSON.stringify(esperadas),
   JSON.stringify((cuotas.datos || []).map(c => c.fecha_vencimiento)));

ok('La numeracion de cuota es 1..6',
   JSON.stringify((cuotas.datos || []).map(c => c.numero_cuota)) === JSON.stringify([1,2,3,4,5,6]),
   JSON.stringify((cuotas.datos || []).map(c => c.numero_cuota)));

const gen2 = await rpc('generar_vencimientos',
  { p_regla_id: reglaBimestral, p_horizonte_meses: 12 }, { token: usuarioA.token });
ok('Re-correr el motor es idempotente (0 nuevas)', gen2.datos === 0, `devolvio ${JSON.stringify(gen2.datos)}`);

seccion('4. Fin de mes: dia 31 en meses que no lo tienen');

const reglaFinDeMes = crypto.randomUUID();
await rest('/reglas_vencimiento', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: reglaFinDeMes, organizacion_id: a.orgId, vehiculo_id: a.vehiculoId,
    tipo_obligacion_id: a.tipos.vtv, frecuencia: 'mensual',
    dia_vencimiento: 31, mes_inicio: 1, monto_estimado: 1000,
    vigente_desde: '2026-01-01', vigente_hasta: '2026-06-30',
  },
});
await rpc('generar_vencimientos', { p_regla_id: reglaFinDeMes, p_horizonte_meses: 12 }, { token: usuarioA.token });

const finDeMes = await rest(
  `/vencimientos?select=fecha_vencimiento&vehiculo_id=eq.${a.vehiculoId}` +
  `&tipo_obligacion_id=eq.${a.tipos.vtv}&order=fecha_vencimiento`,
  { token: usuarioA.token });

const fechasFdM = (finDeMes.datos || []).map(v => v.fecha_vencimiento);
ok('Febrero 2026 (no bisiesto) recorta a 28', fechasFdM[1] === '2026-02-28', fechasFdM[1]);
ok('Abril recorta a 30', fechasFdM[3] === '2026-04-30', fechasFdM[3]);
ok('Enero se queda en 31', fechasFdM[0] === '2026-01-31', fechasFdM[0]);

seccion('5. Calendario explicito: las 5 cuotas de Rentas');

const reglaRentas = crypto.randomUUID();
await rest('/reglas_vencimiento', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: {
    id: reglaRentas, organizacion_id: a.orgId, vehiculo_id: a.vehiculoId,
    tipo_obligacion_id: a.tipos.impuesto_automotor_pcial, frecuencia: 'anual',
    dia_vencimiento: 15, meses_cuotas: [2, 4, 6, 8, 10], monto_estimado: 48000,
    vigente_desde: '2026-01-01', vigente_hasta: '2026-12-31',
  },
});
const genRentas = await rpc('generar_vencimientos',
  { p_regla_id: reglaRentas, p_horizonte_meses: 12 }, { token: usuarioA.token });
ok('meses_cuotas manda sobre la frecuencia: 5 cuotas', genRentas.datos === 5,
   `devolvio ${JSON.stringify(genRentas.datos)}`);

const cuotasRentas = await rest(
  `/vencimientos?select=fecha_vencimiento,numero_cuota&vehiculo_id=eq.${a.vehiculoId}` +
  `&tipo_obligacion_id=eq.${a.tipos.impuesto_automotor_pcial}&order=fecha_vencimiento`,
  { token: usuarioA.token });
ok('Caen en feb, abr, jun, ago, oct',
   JSON.stringify((cuotasRentas.datos || []).map(c => c.fecha_vencimiento)) ===
   JSON.stringify(['2026-02-15','2026-04-15','2026-06-15','2026-08-15','2026-10-15']),
   JSON.stringify((cuotasRentas.datos || []).map(c => c.fecha_vencimiento)));

seccion('6. Estado derivado: vencido no se guarda, se calcula');

const vista = await rest(
  `/v_vencimientos_estado?select=periodo,estado,estado_efectivo,dias_para_vencer` +
  `&vehiculo_id=eq.${a.vehiculoId}&tipo_obligacion_id=eq.${a.tipos.seguro}&order=fecha_vencimiento`,
  { token: usuarioA.token });

const enero = (vista.datos || []).find(v => v.periodo === '2026-01');
const noviembre = (vista.datos || []).find(v => v.periodo === '2026-11');
ok('Enero 2026 figura como vencido', enero?.estado_efectivo === 'vencido', JSON.stringify(enero));
ok('Pero su estado guardado sigue siendo pendiente', enero?.estado === 'pendiente', JSON.stringify(enero));
ok('Noviembre 2026 sigue pendiente', noviembre?.estado_efectivo === 'pendiente', JSON.stringify(noviembre));
ok('dias_para_vencer es negativo para el vencido', (enero?.dias_para_vencer ?? 0) < 0, String(enero?.dias_para_vencer));

seccion('7. Pagos parciales y transicion de estado');

const objetivo = (cuotas.datos || []).find(c => c.periodo === '2026-01');
const idObjetivo = (await rest(
  `/vencimientos?select=id&vehiculo_id=eq.${a.vehiculoId}` +
  `&tipo_obligacion_id=eq.${a.tipos.seguro}&periodo=eq.2026-01`,
  { token: usuarioA.token })).datos?.[0]?.id;

await rest(`/vencimientos?id=eq.${idObjetivo}`, {
  token: usuarioA.token, metodo: 'PATCH', prefer: 'return=minimal',
  cuerpo: { monto_real: 10000 },
});

await rest('/pagos', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: a.orgId, vencimiento_id: idObjetivo, monto: 4000, fecha_pago: '2026-01-09' },
});
let estado = (await rest(`/vencimientos?select=estado&id=eq.${idObjetivo}`, { token: usuarioA.token })).datos?.[0];
ok('Un pago de 4000 sobre 10000 deja el vencimiento en parcial',
   estado?.estado === 'parcial', JSON.stringify(estado));

await rest('/pagos', {
  token: usuarioA.token, metodo: 'POST', prefer: 'return=minimal',
  cuerpo: { organizacion_id: a.orgId, vencimiento_id: idObjetivo, monto: 6000, fecha_pago: '2026-01-10' },
});
estado = (await rest(`/vencimientos?select=estado&id=eq.${idObjetivo}`, { token: usuarioA.token })).datos?.[0];
ok('Completar los 10000 lo deja en pagado', estado?.estado === 'pagado', JSON.stringify(estado));

const pagos = await rest(`/pagos?select=id&vencimiento_id=eq.${idObjetivo}`, { token: usuarioA.token });
await rest(`/pagos?id=eq.${pagos.datos[0].id}`, {
  token: usuarioA.token, metodo: 'PATCH', prefer: 'return=minimal',
  cuerpo: { anulado: true, motivo_anulacion: 'prueba de reversion' },
});
estado = (await rest(`/vencimientos?select=estado&id=eq.${idObjetivo}`, { token: usuarioA.token })).datos?.[0];
ok('Anular un pago lo devuelve a parcial', estado?.estado === 'parcial', JSON.stringify(estado));

seccion('8. Rollup por flota');

const resumen = await rest(
  `/resumenes_flota?select=*&flota_id=eq.${a.flotaId}`, { token: usuarioA.token });
const rf = resumen.datos?.[0];
ok('Existe el resumen de la flota', !!rf, JSON.stringify(resumen.datos));
ok('Cuenta 1 vehiculo', rf?.total_vehiculos === 1, String(rf?.total_vehiculos));
ok('Cuenta vencidos > 0', (rf?.cantidad_vencidos ?? 0) > 0, String(rf?.cantidad_vencidos));
ok('Acumula monto vencido > 0', Number(rf?.monto_vencido ?? 0) > 0, String(rf?.monto_vencido));

const resumenB = await rest(`/resumenes_flota?select=flota_id`, { token: usuarioA.token });
ok('A no ve el resumen de la flota de B',
   !(resumenB.datos || []).some(r => r.flota_id === b.flotaId));

seccion('9. Reportes');

const gastos = await rpc('reporte_gastos', {
  p_organizacion_id: a.orgId, p_desde: '2026-01-01', p_hasta: '2026-12-31', p_agrupar_por: 'tipo',
}, { token: usuarioA.token });
ok('reporte_gastos devuelve el pago vigente',
   Array.isArray(gastos.datos) && gastos.datos.length === 1 && Number(gastos.datos[0].monto) === 6000,
   JSON.stringify(gastos.datos));

const gastosMal = await rpc('reporte_gastos', {
  p_organizacion_id: a.orgId, p_desde: '2026-01-01', p_hasta: '2026-12-31', p_agrupar_por: 'inventado',
}, { token: usuarioA.token });
ok('reporte_gastos rechaza un agrupamiento invalido', !gastosMal.ok, `estado ${gastosMal.estado}`);

const gastosDeB = await rpc('reporte_gastos', {
  p_organizacion_id: b.orgId, p_desde: '2026-01-01', p_hasta: '2026-12-31', p_agrupar_por: 'tipo',
}, { token: usuarioA.token });
ok('A pidiendo el reporte de B obtiene vacio (RLS dentro de la funcion)',
   Array.isArray(gastosDeB.datos) && gastosDeB.datos.length === 0, JSON.stringify(gastosDeB.datos));

const resumenFn = await rpc('resumen_flota', { p_flota_id: a.flotaId }, { token: usuarioA.token });
ok('resumen_flota trae proximos vencimientos',
   Array.isArray(resumenFn.datos?.proximos) && resumenFn.datos.proximos.length > 0,
   JSON.stringify(resumenFn.datos?.proximos?.length));

const detalle = await rpc('detalle_vehiculo', { p_vehiculo_id: a.vehiculoId }, { token: usuarioA.token });
ok('detalle_vehiculo trae la ficha y su historial',
   detalle.datos?.vehiculo?.dominio === 'AAA111' && detalle.datos?.vencimientos?.length > 0,
   JSON.stringify(detalle.datos?.vehiculo));

seccion('10. Link de pago');

const idRentas = (await rest(
  `/vencimientos?select=id&vehiculo_id=eq.${a.vehiculoId}` +
  `&tipo_obligacion_id=eq.${a.tipos.impuesto_automotor_pcial}&periodo=eq.2026-04`,
  { token: usuarioA.token })).datos?.[0]?.id;

const link = await rpc('link_de_pago', { p_vencimiento_id: idRentas }, { token: usuarioA.token });
ok('Devuelve la URL oficial de Rentas',
   typeof link.datos?.url === 'string' && link.datos.url.includes('rentascordoba.gob.ar'),
   link.datos?.url);
ok('Incluye dominio, periodo e importe',
   link.datos?.dominio === 'AAA111' && link.datos?.periodo === '2026-04' && Number(link.datos?.monto) === 48000,
   JSON.stringify(link.datos));
ok('Marca que el importe todavia no esta confirmado',
   link.datos?.monto_confirmado === false, String(link.datos?.monto_confirmado));

seccion('11. Baja de vehiculo: anula futuros, respeta la deuda pasada');

// El hoy que importa es el de Cordoba, no el del servidor (UTC): entre las
// 21:00 y las 24:00 locales van por dias distintos.
const hoyCordoba = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' });
console.log(`       (hoy en Cordoba: ${hoyCordoba} / hoy en UTC: ${new Date().toISOString().slice(0, 10)})`);

const antes = await rest(
  `/vencimientos?select=id,fecha_vencimiento,estado&vehiculo_id=eq.${a.vehiculoId}&order=fecha_vencimiento`,
  { token: usuarioA.token });
const vencidasImpagas = (antes.datos || []).filter(
  v => v.fecha_vencimiento < hoyCordoba && ['pendiente','parcial'].includes(v.estado)).length;

const baja = await rest(`/vehiculos?id=eq.${a.vehiculoId}`, {
  token: usuarioA.token, metodo: 'PATCH', prefer: 'return=minimal',
  cuerpo: { estado: 'vendido', fecha_baja: hoyCordoba },
});
ok('El PATCH de baja es aceptado', baja.ok, `estado ${baja.estado} ${JSON.stringify(baja.datos)}`);

const trasBaja = await rest(`/vehiculos?select=estado,fecha_alta,fecha_baja&id=eq.${a.vehiculoId}`,
  { token: usuarioA.token });
console.log(`       (vehiculo tras el PATCH: ${JSON.stringify(trasBaja.datos?.[0])})`);

const despues = await rest(
  `/vencimientos?select=fecha_vencimiento,estado&vehiculo_id=eq.${a.vehiculoId}&order=fecha_vencimiento`,
  { token: usuarioA.token });
const futurasVivas = (despues.datos || []).filter(
  v => v.fecha_vencimiento > hoyCordoba && ['pendiente','parcial'].includes(v.estado)).length;
const pasadasVivas = (despues.datos || []).filter(
  v => v.fecha_vencimiento < hoyCordoba && ['pendiente','parcial'].includes(v.estado)).length;

ok('No queda ninguna cuota futura impaga', futurasVivas === 0, `quedaron ${futurasVivas}`);
ok('Las cuotas pasadas impagas siguen adeudadas',
   pasadasVivas === vencidasImpagas && pasadasVivas > 0,
   `antes ${vencidasImpagas}, despues ${pasadasVivas}`);

const reglasTrasBaja = await rest(
  `/reglas_vencimiento?select=activa&vehiculo_id=eq.${a.vehiculoId}`, { token: usuarioA.token });
ok('Las reglas del vehiculo quedaron desactivadas',
   (reglasTrasBaja.datos || []).every(r => r.activa === false),
   JSON.stringify(reglasTrasBaja.datos));

seccion('12. Avisos');

const reglasAviso = await rest(
  `/reglas_aviso?select=tipo_obligacion_id,dias_antes,dias_despues&organizacion_id=eq.${a.orgId}`,
  { token: usuarioA.token });
ok('La organizacion nace con su regla de aviso general',
   reglasAviso.datos?.length === 1 && reglasAviso.datos[0].tipo_obligacion_id === null,
   JSON.stringify(reglasAviso.datos));

const encolados = await rpc('programar_avisos',
  { p_organizacion_id: a.orgId, p_ventana_dias: 7 }, { token: usuarioA.token });
ok('programar_avisos corre sin error', encolados.ok, JSON.stringify(encolados.datos));

// Hay cuotas de 2026-09-10 y 2026-10-15 vivas: alguna tiene que caer dentro de
// la ventana de avisos. Cero encolados significaria que el sistema no avisa.
ok('Encola al menos un aviso', Number(encolados.datos) > 0,
   `encolo ${JSON.stringify(encolados.datos)}`);

const avisos = await rest(
  `/avisos?select=clave_regla,programado_para,enviado_en&order=programado_para`,
  { token: usuarioA.token });
ok('La cola de avisos es legible y no esta vacia',
   Array.isArray(avisos.datos) && avisos.datos.length > 0, JSON.stringify(avisos.datos));
ok('Los avisos encolados estan pendientes de despacho',
   (avisos.datos || []).every(v => v.enviado_en === null), JSON.stringify(avisos.datos));

const reEncolados = await rpc('programar_avisos',
  { p_organizacion_id: a.orgId, p_ventana_dias: 7 }, { token: usuarioA.token });
ok('Re-correrla no duplica avisos', Number(reEncolados.datos) === 0,
   `encolo ${JSON.stringify(reEncolados.datos)}`);

seccion('13. Importacion masiva');

const importado = await rpc('importar_vehiculos', {
  p_organizacion_id: a.orgId,
  p_flota_id: a.flotaId,
  p_filas: [
    { dominio: 'AB123CD', marca: 'Toyota', modelo: 'Hilux', anio: '2021', tipo: 'camioneta' },
    { dominio: 'AAA111',  marca: 'Duplicado' },
    { dominio: 'MAL',     marca: 'Invalido' },
  ],
}, { token: usuarioA.token });

ok('Importa la fila valida', importado.datos?.importados === 1, JSON.stringify(importado.datos));
ok('Reporta las 2 filas con error', importado.datos?.con_errores === 2, JSON.stringify(importado.datos?.errores));
ok('No aborta la importacion por una fila mala', importado.datos?.procesadas === 3, JSON.stringify(importado.datos));

seccion('14. Comprobantes en Storage');

// Convencion de rutas del bucket: <organizacion_id>/<vencimiento_id>/<archivo>
// El primer segmento es el que gobierna el acceso.
async function subir(token, ruta, contenido, tipo = 'application/pdf') {
  const r = await fetch(`${URL_BASE}/storage/v1/object/comprobantes/${ruta}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': tipo },
    body: contenido,
  });
  return { ok: r.ok, estado: r.status, texto: await r.text() };
}

async function bajar(token, ruta) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/comprobantes/${ruta}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  return { ok: r.ok, estado: r.status, bytes: r.ok ? (await r.arrayBuffer()).byteLength : 0 };
}

// PDF minimo valido, suficiente para ejercitar el bucket.
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const rutaA = `${a.orgId}/${idObjetivo}/comprobante.pdf`;

const subida = await subir(usuarioA.token, rutaA, pdf);
ok('A sube un comprobante a la carpeta de su organizacion', subida.ok,
   `estado ${subida.estado} ${subida.texto.slice(0, 160)}`);

const propia = await bajar(usuarioA.token, rutaA);
ok('A puede volver a bajarlo', propia.ok && propia.bytes === pdf.length,
   `estado ${propia.estado}, ${propia.bytes} bytes`);

const ajena = await bajar(usuarioB.token, rutaA);
ok('B no puede bajar el comprobante de A', !ajena.ok, `estado ${ajena.estado}`);

const anonima = await bajar(ANON, rutaA);
ok('Un anonimo tampoco', !anonima.ok, `estado ${anonima.estado}`);

const invasion = await subir(usuarioA.token, `${b.orgId}/intruso.pdf`, pdf);
ok('A no puede subir a la carpeta de B', !invasion.ok, `estado ${invasion.estado}`);

const tipoMalo = await subir(
  usuarioA.token, `${a.orgId}/${idObjetivo}/nota.txt`,
  Buffer.from('texto plano'), 'text/plain');
ok('El bucket rechaza un tipo de archivo no permitido', !tipoMalo.ok, `estado ${tipoMalo.estado}`);

// Dejar el comprobante enlazado al pago, que es el flujo real.
const pagoVigente = (await rest(
  `/pagos?select=id&vencimiento_id=eq.${idObjetivo}&anulado=is.false&limit=1`,
  { token: usuarioA.token })).datos?.[0];
if (pagoVigente) {
  const enlace = await rest(`/pagos?id=eq.${pagoVigente.id}`, {
    token: usuarioA.token, metodo: 'PATCH', prefer: 'return=minimal',
    cuerpo: { comprobante_url: rutaA },
  });
  ok('El comprobante queda enlazado al pago', enlace.ok, `estado ${enlace.estado}`);
}

seccion('15. Superficie de la API: lo interno sigue siendo interno');

// Supabase concede EXECUTE a anon y authenticated por defecto sobre cada
// funcion nueva. Este bloque existe porque una vez se colo: tarea_diaria()
// quedo llamable por anon. Que no vuelva a pasar en silencio.

const INTERNAS = [
  ['tarea_diaria', {}],
  ['recalcular_resumen_flota', { p_flota_id: a.flotaId }],
  ['estado_segun_pagos', { p_vencimiento_id: idObjetivo, p_total: 1, p_estado_actual: 'pendiente' }],
];

for (const [fn, args] of INTERNAS) {
  const comoAnon = await rpc(fn, args, { token: ANON });
  ok(`anon no puede ejecutar ${fn}()`, comoAnon.estado === 401 || comoAnon.estado === 403,
     `estado ${comoAnon.estado}`);

  const comoUsuario = await rpc(fn, args, { token: usuarioA.token });
  ok(`un usuario autenticado tampoco puede ejecutar ${fn}()`,
     comoUsuario.estado === 401 || comoUsuario.estado === 403, `estado ${comoUsuario.estado}`);
}

// Y las que si son publicas tienen que seguir andando para un usuario.
const publica = await rpc('resumen_flota', { p_flota_id: a.flotaId }, { token: usuarioA.token });
ok('las funciones de consulta siguen disponibles para el usuario', publica.ok, `estado ${publica.estado}`);

// programar_avisos escribe: no puede dejar que A toque la organizacion de B.
const avisosAjenos = await rpc('programar_avisos',
  { p_organizacion_id: b.orgId, p_ventana_dias: 7 }, { token: usuarioA.token });
ok('A no puede programar avisos en la organizacion de B', !avisosAjenos.ok,
   `estado ${avisosAjenos.estado}`);

// -------------------------------------------------------------------- limpieza

seccion('Limpieza');

// Los objetos de Storage no cascadean con el borrado de la organizacion.
for (const ruta of [rutaA]) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/comprobantes/${ruta}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  console.log(`  comprobante: ${r.ok ? 'borrado' : 'quedo (' + r.status + ')'}`);
}

// Las organizaciones primero: el borrado cascadea a flotas, vehiculos,
// vencimientos y pagos, y deja la base como estaba.
for (const [etiqueta, orgId] of [['A', a.orgId], ['B', b.orgId]]) {
  const r = await rest(`/organizaciones?id=eq.${orgId}`, { metodo: 'DELETE', servicio: true });
  console.log(`  organizacion ${etiqueta}: ${r.ok ? 'borrada' : 'quedo (' + r.estado + ')'}`);
}

for (const u of [usuarioA, usuarioB]) {
  const r = await api(`/auth/v1/admin/users/${u.id}`, { metodo: 'DELETE', servicio: true });
  console.log(`  usuario ${u.email}: ${r.ok ? 'borrado' : 'quedo (' + r.estado + ')'}`);
}

// -------------------------------------------------------------------- resumen

console.log(`\n${'='.repeat(60)}`);
if (fallas.length === 0) {
  console.log(`\x1b[32m${pasadas} verificaciones OK, 0 fallas\x1b[0m`);
} else {
  console.log(`\x1b[31m${pasadas} OK, ${fallas.length} FALLAS\x1b[0m`);
  fallas.forEach(f => console.log(`  - ${f}`));
}
process.exit(fallas.length === 0 ? 0 : 1);
