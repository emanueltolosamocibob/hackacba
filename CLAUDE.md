# Contexto del proyecto

Control de las obligaciones de pago de cada vehículo de una o más flotas:
impuesto automotor de Rentas Córdoba, tasa municipal, seguro, VTV, GNC, multas.
El problema no es contabilidad, es **no perder un vencimiento**.

**Estado: el backend está terminado y verificado. No hay interfaz todavía.**
La próxima etapa es un bot de Telegram; más adelante, una Mini App en React + TS.

- [README.md](README.md) — modelo de datos y puesta en marcha
- [BOT.md](BOT.md) — la guía para construir el bot: superficie de la API, alta
  de usuarios, despacho de avisos

---

## Convenciones

- **Todo en español**: tablas, columnas, tipos, funciones, vistas y nombres de
  variables en los scripts.
- **Sin acentos ni `ñ` en los identificadores** (`vehiculos`, `anio`, `periodo`).
  Rompen la generación de tipos y los clientes. En comentarios y textos, sí.
- Tablas en plural, columnas en singular. FK: `<tabla_singular>_id`.
- Marcas de tiempo `creado_en` / `actualizado_en`; fechas de calendario `fecha_*`.
- Importes `numeric(14,2)`, nunca punto flotante.

---

## Trampas de este proyecto

Cosas que ya costaron un bug acá. Vale la pena leerlas antes de tocar la base.

**1. No hay Docker en esta máquina.** `supabase start`, `supabase db reset` y
`supabase test db` no funcionan: Docker Desktop no arranca (sockets AF_UNIX
huérfanos, error 1920). Se trabaja contra el proyecto en la nube con
`supabase db push`, y se verifica con `npm run verificar:todo`. Por eso no hay
tests pgTAP.

**2. Nunca `current_date` para una fecha de negocio.** El servidor corre en UTC
y Argentina es UTC-3: entre las 21:00 y las 24:00 locales van por días distintos.
Usar `hoy_en_organizacion(organizacion_id)`. Ver la migración `0007`.

**3. Una función nueva nace sin permisos.** Supabase concede `EXECUTE` a `anon`
por defecto; la migración `0011` revoca eso y hace los `GRANT` uno por uno. Si
agregás una función que el cliente deba llamar, **escribí el `GRANT` explícito**
o no va a andar. Y si es interna, no le pongas ninguno.

**4. Las vistas necesitan `with (security_invoker = true)`.** Sin eso corren con
los permisos de su dueño y saltean el RLS de las tablas base: filtran datos entre
organizaciones.

**5. Las FK entre tablas del inquilino son compuestas** `(id, organizacion_id)`.
Es lo que impide referenciar filas de otra organización aunque RLS fallara.
Mantener el patrón en tablas nuevas.

**6. "Vencido" no se guarda.** `vencimientos.estado` es solo liquidación; la
condición de vencido se deriva en `v_vencimientos_estado`. No agregar un campo
`vencido`: queda desactualizado el mismo día.

**7. El cliente nunca consulta datos de negocio con `service_role`.** Con el JWT
del usuario, RLS es la última línea de defensa. `service_role` es solo para
tareas de sistema: cron, despacho de avisos y el alta de usuarios.

**8. Los teléfonos se normalizan en la base.** El prefijo `15` de celular va en
el medio, después del código de área: comparar por los últimos dígitos no
alcanza. Usar `clave_telefono()`, no reimplementarlo. Ver la migración `0015`.

---

## Comandos

```bash
npm run db:push          # aplicar migraciones al proyecto en la nube
npm run db:estado        # ver qué migraciones están aplicadas
npm run db:tipos         # regenerar paquetes/compartido/src/tipos.ts
npm run demo             # datos de demostración (--recrear para rehacerlos)
npm run verificar:todo   # las tres baterías + chequeo de tipos
```

`.env` (gitignored) tiene `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`. No commitearlo ni imprimirlo.

**Antes de dar por terminado cualquier cambio que toque la base, correr
`npm run verificar:todo`.** Son 122 comprobaciones y ya cazaron cuatro bugs
reales; si una falla, es información, no ruido.

Al agregar una migración, sumar su verificación al script que corresponda en
`supabase/tests/`. Los scripts crean sus propios datos y se limpian solos.

---

## Cómo está organizado

```
supabase/migrations/   0001-0015, en orden. El encabezado de cada una explica
                       por qué existe; las 0007+ documentan el bug que corrigen
supabase/tests/        verificar.mjs (66) · verificar-alta.mjs (50)
                       verificar-realtime.mjs (6)
supabase/semillas/     demo.mjs — flota realista de Córdoba
paquetes/compartido/   tipos generados del esquema + esquemas zod + helpers
```

No hay `supabase/functions/`: **no hay Edge Functions y es a propósito**. Toda la
lógica se expresa en Postgres y `pg_cron` llama a `tarea_diaria()` sin
intermediarios. La primera va a ser el webhook de Telegram.
