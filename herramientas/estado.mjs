// =============================================================================
// Panel del estado actual de la base, contra los datos de demostracion.
//
// Sirve para ver de un vistazo que hay adentro sin abrir el Studio, y como
// ejemplo vivo de la API que va a usar el bot: cada seccion es una consulta
// o un RPC real.
//
//   npm run estado
// =============================================================================

const U = process.env.SUPABASE_URL;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: S, Authorization: `Bearer ${S}`, 'Content-Type': 'application/json' };

const get = async r => (await fetch(`${U}/rest/v1${r}`, { headers: h })).json();
const rpc = async (f, a) => (await fetch(`${U}/rest/v1/rpc/${f}`, {
  method: 'POST', headers: h, body: JSON.stringify(a),
})).json();

const plata = n => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const linea = t => console.log(`\n\x1b[1m\x1b[36m${t}\x1b[0m\n${'─'.repeat(74)}`);

const [org] = await get(`/organizaciones?select=id,nombre,zona_horaria&nombre=like.*demo*`);
const hoy = await rpc('hoy_en_organizacion', { p_organizacion_id: org.id });

console.log(`\x1b[1m${org.nombre}\x1b[0m`);
console.log(`${org.zona_horaria} · hoy es ${hoy} (en UTC ya es ${new Date().toISOString().slice(0, 10)})`);

// ---------------------------------------------------------------------------
linea('ESTADO DE LA FLOTA   (una fila por flota, precalculada)');

const flotas = await get(`/flotas?select=id,nombre&organizacion_id=eq.${org.id}&order=nombre`);
console.log('  Flota              Unid.  Vencidos          Adeudado    Por vencer 30d   Proximo');
for (const f of flotas) {
  const [r] = await get(`/resumenes_flota?select=*&flota_id=eq.${f.id}`);
  console.log(
    `  ${f.nombre.padEnd(18)} ${String(r.total_vehiculos).padStart(4)}  ` +
    `${String(r.cantidad_vencidos).padStart(8)}  ${plata(r.monto_vencido).padStart(16)}  ` +
    `${plata(r.monto_por_vencer_30d).padStart(14)}   ${r.proximo_vencimiento}`);
}

// ---------------------------------------------------------------------------
linea('LO QUE ESTA VENCIDO   (estado derivado, no guardado)');

const vencidos = await get(
  `/v_vencimientos_estado?organizacion_id=eq.${org.id}&estado_efectivo=eq.vencido` +
  `&select=dominio,tipo_nombre,periodo,fecha_vencimiento,monto_vigente,dias_para_vencer` +
  `&order=fecha_vencimiento&limit=8`);

console.log('  Dominio   Concepto                        Periodo  Vence        Atraso   Importe');
for (const v of vencidos) {
  console.log(
    `  ${v.dominio.padEnd(9)} ${v.tipo_nombre.slice(0, 30).padEnd(31)} ${v.periodo}  ` +
    `${v.fecha_vencimiento}  ${String(Math.abs(v.dias_para_vencer) + 'd').padStart(6)}  ` +
    `${plata(v.monto_vigente).padStart(9)}`);
}

const totalVencidos = await get(
  `/v_vencimientos_estado?organizacion_id=eq.${org.id}&estado_efectivo=eq.vencido&select=id`);
console.log(`  ... ${totalVencidos.length} vencidos en total`);

// ---------------------------------------------------------------------------
linea('LO QUE VIENE   (proximos 15 dias)');

const proximos = await get(
  `/v_vencimientos_estado?organizacion_id=eq.${org.id}` +
  `&estado_efectivo=in.(pendiente,parcial)&dias_para_vencer=gte.0&dias_para_vencer=lte.15` +
  `&select=dominio,tipo_nombre,fecha_vencimiento,dias_para_vencer,monto_vigente,estado_efectivo` +
  `&order=fecha_vencimiento&limit=8`);

console.log('  Dominio   Concepto                        Vence         Faltan   Importe    Estado');
for (const v of proximos) {
  console.log(
    `  ${v.dominio.padEnd(9)} ${v.tipo_nombre.slice(0, 30).padEnd(31)} ${v.fecha_vencimiento}  ` +
    `${String(v.dias_para_vencer + 'd').padStart(6)}  ${plata(v.monto_vigente).padStart(9)}  ` +
    `${v.estado_efectivo}`);
}

// ---------------------------------------------------------------------------
linea('GASTO REAL POR CONCEPTO   (pagos, no deuda)');

const porTipo = await rpc('reporte_gastos', {
  p_organizacion_id: org.id, p_desde: '2026-01-01', p_hasta: hoy, p_agrupar_por: 'tipo',
});
console.log('  Concepto                              Pagos        Total');
for (const g of porTipo) {
  console.log(`  ${g.etiqueta.slice(0, 36).padEnd(37)} ${String(g.cantidad).padStart(5)}  ${plata(g.monto).padStart(11)}`);
}
console.log(`  ${''.padEnd(37)} ${''.padStart(5)}  ${plata(porTipo.reduce((a, g) => a + Number(g.monto), 0)).padStart(11)}`);

linea('GASTO POR MES');
const porMes = await rpc('reporte_gastos', {
  p_organizacion_id: org.id, p_desde: '2026-01-01', p_hasta: hoy, p_agrupar_por: 'mes',
});
const maximo = Math.max(...porMes.map(m => Number(m.monto)));
for (const m of porMes.sort((a, b) => a.clave.localeCompare(b.clave))) {
  const barra = '█'.repeat(Math.round((Number(m.monto) / maximo) * 34));
  console.log(`  ${m.clave}  ${plata(m.monto).padStart(11)}  ${barra}`);
}

// ---------------------------------------------------------------------------
linea('FICHA DE UN VEHICULO   (lo que responderia /vehiculo AB123CD)');

const [veh] = await get(`/vehiculos?select=id,dominio&organizacion_id=eq.${org.id}&dominio=eq.AB123CD`);
const ficha = await rpc('detalle_vehiculo', { p_vehiculo_id: veh.id });
const v = ficha.vehiculo;
console.log(`  ${v.dominio} · ${v.marca} ${v.modelo} ${v.anio} · ${v.tipo} · flota "${v.flota}"`);
console.log(`  Total pagado historico: ${plata(ficha.total_pagado)}`);
console.log(`  Vencimientos registrados: ${ficha.vencimientos.length}`);
console.log('\n  Ultimos movimientos:');
for (const c of ficha.vencimientos.slice(0, 6)) {
  console.log(`    ${c.fecha_vencimiento}  ${c.tipo.slice(0, 30).padEnd(31)} ${plata(c.monto).padStart(9)}  ${c.estado_efectivo}`);
}

// ---------------------------------------------------------------------------
linea('LINK DE PAGO   (lo que responderia /pagar)');

const [aPagar] = await get(
  `/v_vencimientos_estado?organizacion_id=eq.${org.id}&tipo_codigo=eq.impuesto_automotor_pcial` +
  `&estado_efectivo=eq.pendiente&select=id&limit=1`);
const link = await rpc('link_de_pago', { p_vencimiento_id: aPagar.id });
console.log(`  Vehiculo:   ${link.dominio}`);
console.log(`  Concepto:   ${link.tipo} (${link.organismo})`);
console.log(`  Periodo:    ${link.periodo}  ·  cuota ${link.numero_cuota}  ·  vence ${link.fecha_vencimiento}`);
console.log(`  Importe:    ${plata(link.monto)} ${link.monto_confirmado ? '(confirmado)' : '(estimado, falta la boleta)'}`);
console.log(`  URL:        ${link.url}`);

// ---------------------------------------------------------------------------
linea('COLA DE AVISOS   (lo que el bot tiene que despachar)');

const avisos = await get(`/avisos?select=clave_regla,programado_para,enviado_en&organizacion_id=eq.${org.id}`);
const porClave = {};
avisos.forEach(a => (porClave[a.clave_regla] = (porClave[a.clave_regla] || 0) + 1));
const orden = k => (k.startsWith('d-') && k !== 'd-0' ? -parseInt(k.slice(2)) : k === 'd-0' ? 0 : parseInt(k.slice(2)));
const etiqueta = k => k === 'd-0' ? 'el dia del vencimiento'
  : k.startsWith('d-') ? `${k.slice(2)} dias antes` : `${k.slice(2)} dias despues`;

for (const [k, n] of Object.entries(porClave).sort((a, b) => orden(a[0]) - orden(b[0]))) {
  console.log(`  ${k.padEnd(6)} ${etiqueta(k).padEnd(26)} ${String(n).padStart(3)} avisos  ${'▪'.repeat(n)}`);
}
console.log(`  ${''.padEnd(33)} ${String(avisos.length).padStart(3)} en total, ` +
            `${avisos.filter(a => !a.enviado_en).length} pendientes de despacho`);

console.log('');
