# Gestión de flota — backend

Control de las obligaciones de pago de cada vehículo de una o más flotas:
impuesto automotor de Rentas Córdoba, tasa municipal, seguro, VTV, GNC y multas.

El problema que resuelve no es contabilidad, es **no perder un vencimiento**.

Todo el esquema está en español: tablas, columnas, tipos, funciones y vistas.
Sin acentos ni `ñ` en los identificadores, porque rompen la generación de tipos
y los clientes.

## Modelo

```
Organización → Flota → Vehículo → Regla de vencimiento → Vencimiento → Pago
```

El desdoblamiento del último tramo es el punto: **el vencimiento existe antes que
el pago**. Si solo hubiera tabla de pagos, una cuota impaga sería una fila que no
existe, y no se podría consultar, ni resumir, ni avisar. Además habilita pagos
parciales y permite que la regla genere las cuotas sola.

| Tabla | Rol |
|---|---|
| `organizaciones` | Tenant. Raíz del aislamiento |
| `miembros` | Usuario × organización × rol |
| `flotas` · `vehiculos` | La flota y sus unidades |
| `tipos_obligacion` | Catálogo de conceptos a pagar, con su URL oficial de pago |
| `reglas_vencimiento` | La regla que genera cuotas |
| `vencimientos` | Las cuotas, con fecha e importe |
| `pagos` | Pagos aplicados (admite parciales) |
| `reglas_aviso` · `avisos` | Cuándo avisar, y la cola de avisos pendientes |
| `resumenes_flota` | Rollup precalculado por flota |
| `auditoria` | Quién cambió qué |

### Tres decisiones que conviene conocer antes de tocar nada

1. **"Vencido" no se guarda.** `vencimientos.estado` es solo el estado de
   liquidación. La condición de vencido se deriva en `v_vencimientos_estado`
   comparando contra hoy. Un campo mutable quedaría desactualizado.

2. **Ninguna fecha de negocio usa `current_date`.** El servidor corre en UTC y
   Argentina es UTC-3: entre las 21:00 y las 24:00 locales van por días
   distintos. Se usa `hoy_en_organizacion(organizacion_id)`. Ver la migración
   `0007`, que corrige justamente ese bug.

3. **Las claves foráneas entre tablas del tenant son compuestas**
   `(id, organizacion_id)`. Postgres impide referenciar filas de otra
   organización aunque RLS fallara.

4. **Una función nueva nace sin permisos.** Supabase concede `EXECUTE` a `anon`
   por defecto; la migración `0011` revoca eso y hace los `GRANT` uno por uno.
   Si agregás una función que el cliente deba llamar, escribí el `GRANT`
   explícito. Ver el porqué en el encabezado de esa migración.

## Puesta en marcha

Requiere Node 20+ y el CLI de Supabase. **No requiere Docker**: se trabaja
contra el proyecto en la nube.

```bash
supabase login
```

```bash
supabase link --project-ref TU_PROJECT_REF
```

Después, un `.env` en la raíz (está en `.gitignore`) con:

```
SUPABASE_URL=https://TU_REF.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

```bash
npm install && npm run db:push
```

## Verificación

No hay pgTAP porque `supabase test db` necesita el stack local en Docker. En su
lugar hay scripts que corren contra el proyecto real, con usuarios y JWT
reales — más fieles para lo que importa, que es cómo le va a pegar el cliente.

```bash
npm run verificar:todo
```

- `verificar` — 66 comprobaciones: aislamiento RLS entre organizaciones, motor
  de vencimientos (fin de mes, idempotencia, calendarios irregulares), estado
  derivado, pagos parciales y su reversión, rollups, reportes, link de pago,
  baja de vehículo, avisos, importación masiva, comprobantes en Storage y la
  superficie de permisos de las funciones (que lo interno siga siendo interno).
- `verificar:realtime` — 6 comprobaciones del camino completo: cambio en la
  base → trigger → rollup → `realtime.send()` → suscriptor autorizado (y el no
  autorizado rechazado).
- `verificar:tipos` — que `paquetes/compartido` compile contra el esquema real.

Los scripts crean sus propios datos y **se limpian solos**.

## Datos de demostración

Una flota realista de Córdoba: 3 flotas, 16 vehículos, 64 reglas, ~650
vencimientos, ~200 pagos históricos y una cola de avisos poblada. Sirve para
desarrollar el bot contra algo que se parezca a la realidad.

```bash
npm run demo
```

Para rehacerla desde cero: `npm run demo -- --recrear`. Si le pasás un email,
la organización queda a nombre de ese usuario.

No hay `seed.sql`: ese solo corre con `supabase db reset` (necesita Docker) y
además no puede crear usuarios de auth, sin los cuales no hay membresías ni se
puede ejercitar RLS.

## Tarea diaria

`pg_cron` corre `tarea_diaria()` a las 11:00 UTC = 08:00 en Córdoba: genera las
cuotas futuras y encola los avisos del día. Para ver si está andando:

```sql
select public.estado_tarea_diaria();
```

La tarea **encola** en `avisos`; el despacho lo hará la interfaz. Una fila con
`enviado_en` nulo está pendiente.

## Pagos

`link_de_pago(vencimiento_id)` devuelve la URL oficial con los marcadores
`{dominio}`, `{periodo}` y `{cuenta}` resueltos, más el importe y el período.

**El sistema nunca mueve dinero.** Acerca el link; el pago lo hace una persona.

## Pendiente

Solo la interfaz: bot de Telegram con agente conversacional, y más adelante una
Mini App en React + TypeScript. `paquetes/compartido` ya está listo para las
dos, con tipos generados del esquema real y esquemas zod de validación.

**No hay Edge Functions todavía, y es a propósito**: hasta acá toda la lógica se
expresa en Postgres, y `pg_cron` llama a `tarea_diaria()` sin intermediarios.
La primera Edge Function va a ser el webhook de Telegram.
