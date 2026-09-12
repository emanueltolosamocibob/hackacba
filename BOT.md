# Guía de implementación del bot

Todo lo que hace falta para construir el bot de Telegram sobre el backend que ya
está en Supabase. El backend está terminado y verificado; esto describe qué
queda del lado del bot y con qué cuenta.

Leer antes el [README](README.md) para el modelo de datos.

---

## 1. El reparto: qué hace la base y qué le queda al bot

La regla de fondo: **la base decide, el bot conversa y despacha.** Nada de lógica
de negocio en el bot.

| Ya resuelto en Postgres | Le queda al bot |
|---|---|
| Quién ve qué (RLS por organización) | Vincular un chat de Telegram con un usuario |
| Generar las cuotas de cada regla | Mostrarlas de forma legible en un chat |
| Calcular si algo está vencido | — |
| Decidir a quién avisar y cuándo | **Despachar** los avisos de la cola |
| Recalcular estados al registrar un pago | Pedir confirmación antes de escribir |
| Armar los reportes | Formatearlos y mandarlos |
| Resolver la URL de pago | Renderizar el botón y el QR |
| Correr la tarea diaria (pg_cron) | — |

Consecuencia práctica: si aparece una regla de negocio nueva, casi siempre va en
una migración, no en el bot.

---

## 2. Lo que falta en la base

**Una migración `0012`**, que es lo primero a escribir. Hoy no existe forma de
saber qué usuario de Supabase está detrás de un `chat_id` de Telegram.

```sql
create table public.vinculos_telegram (
  id                 uuid primary key default gen_random_uuid(),
  usuario_id         uuid not null references auth.users (id) on delete cascade,
  telegram_user_id   bigint not null unique,
  chat_id            bigint not null,
  nombre_telegram    text,
  refresh_token      text,          -- ver seccion 3
  vinculado_en       timestamptz not null default now(),
  ultimo_uso_en      timestamptz,
  unique (usuario_id, telegram_user_id)
);
```

Va con RLS (cada usuario ve solo su propio vínculo) y **sin `GRANT` a
`authenticated`** sobre `refresh_token`: esa columna la toca únicamente el bot con
`service_role`. Lo más simple es no exponer la tabla por PostgREST y dejarla solo
para el backend.

Hace falta además una tabla o columna de **códigos de invitación**: el flujo de
alta es que un administrador genera un código y el usuario lo canjea con
`/start <codigo>`. Sin eso, cualquiera que encuentre el bot puede intentar
vincularse.

Recordar: desde la migración `0011`, **una función nueva nace sin permisos**. Si
el bot tiene que llamarla, hay que escribir el `GRANT` explícito.

---

## 3. Autenticación: de un `chat_id` a un JWT

Esta es la decisión de diseño más importante del bot.

> **El bot nunca debe consultar datos de negocio con `service_role`.** Si lo hace,
> RLS deja de protegerlo y un error de filtrado en el código expone datos de otra
> organización. Con el JWT del usuario, aunque el modelo alucine un `flota_id`
> ajeno, Postgres devuelve vacío.

`service_role` se usa solo para: leer `vinculos_telegram`, despachar avisos y
marcarlos como enviados.

### Cómo obtener el JWT

El proyecto está en transición entre esquemas de firma: el JWKS ya publica una
clave **ES256** asimétrica, pero el `anon key` todavía es **HS256** legacy. O sea
que firmar tokens a mano con el JWT secret funciona hoy pero está en camino de
deprecación. Conviene no depender de eso.

Dos caminos sostenidos por la API oficial:

**a) Guardar el refresh token (menos llamadas).** Al vincular, se crea la sesión
una vez y se guarda el `refresh_token` en `vinculos_telegram`. Después, por cada
interacción:

```
POST /auth/v1/token?grant_type=refresh_token
{ "refresh_token": "..." }
```

Devuelve un `access_token` nuevo y **un `refresh_token` nuevo**: los tokens rotan,
hay que guardar el nuevo o la próxima llamada falla. Ese es el detalle que más se
olvida.

**b) Emitir la sesión en el momento (sin estado).** Dos llamadas de admin:

```
POST /auth/v1/admin/generate_link   { type: "magiclink", email }   -> hashed_token
POST /auth/v1/verify                { type: "magiclink", token }   -> sesión
```

No hay que guardar nada, pero son dos viajes por interacción.

Empezar por (b) porque es más simple de hacer bien, y pasar a (a) si la latencia
molesta.

---

## 4. La superficie de la API

Todo por PostgREST en `https://<ref>.supabase.co/rest/v1/`, con
`apikey: <anon>` y `Authorization: Bearer <jwt del usuario>`.

### Tablas y vistas

| Recurso | Uso desde el bot |
|---|---|
| `organizaciones`, `miembros` | Resolver a qué organización pertenece el usuario |
| `flotas` | Listar flotas |
| `vehiculos` | Buscar por dominio, marca o modelo |
| `v_vencimientos_estado` | **La vista principal para consultar.** Ya trae `estado_efectivo` y `dias_para_vencer` |
| `pagos` | Registrar un pago |
| `resumenes_flota` | Estado de una flota en una sola fila |
| `avisos` | Cola de avisos (el bot la despacha con `service_role`) |

Columnas de `v_vencimientos_estado`:

```
id, organizacion_id, vehiculo_id, dominio, flota_id, tipo_obligacion_id,
tipo_codigo, tipo_nombre, regla_id, periodo, numero_cuota, fecha_vencimiento,
monto_estimado, monto_real, monto_vigente, moneda, estado, estado_efectivo,
dias_para_vencer, numero_boleta, url_pago, notas, creado_en, actualizado_en
```

`estado_efectivo` toma: `pendiente`, `parcial`, `vencido`, `pagado`, `condonado`,
`anulado`. **`vencido` no existe en la columna `estado`**, se deriva en la vista
comparando contra hoy en la zona horaria de la organización.

Ejemplo — lo que vence en los próximos 7 días:

```
GET /rest/v1/v_vencimientos_estado
  ?estado_efectivo=in.(pendiente,parcial,vencido)
  &dias_para_vencer=lte.7
  &order=fecha_vencimiento
  &select=dominio,tipo_nombre,periodo,fecha_vencimiento,monto_vigente,estado_efectivo
```

No hace falta filtrar por organización: RLS ya lo hace.

### Funciones RPC

`POST /rest/v1/rpc/<nombre>` con el cuerpo en JSON. Firmas exactas:

| Función | Argumentos | Devuelve |
|---|---|---|
| `resumen_flota` | `p_flota_id: uuid` | jsonb: rollup + 10 vencimientos impagos más próximos |
| `detalle_vehiculo` | `p_vehiculo_id: uuid` | jsonb: ficha, historial y total pagado |
| `reporte_gastos` | `p_organizacion_id: uuid`, `p_desde: date`, `p_hasta: date`, `p_agrupar_por: text` | filas `{clave, etiqueta, cantidad, monto}` |
| `link_de_pago` | `p_vencimiento_id: uuid` | jsonb: URL resuelta, dominio, período, importe |
| `generar_vencimientos` | `p_regla_id: uuid`, `p_horizonte_meses: integer` | cantidad de cuotas nuevas |
| `generar_vencimientos_organizacion` | `p_organizacion_id: uuid`, `p_horizonte_meses: integer` | cantidad |
| `programar_avisos` | `p_organizacion_id: uuid`, `p_ventana_dias: integer` | cantidad encolada |
| `importar_vehiculos` | `p_organizacion_id: uuid`, `p_flota_id: uuid`, `p_filas: jsonb` | jsonb con el detalle de errores por fila |
| `sembrar_catalogo_cordoba` | `p_organizacion_id: uuid` | cantidad de tipos creados |
| `estado_tarea_diaria` | — | jsonb: si el cron está programado y cómo le fue |
| `hoy_en_organizacion` | `p_organizacion_id: uuid` | date |
| `organizaciones_del_usuario` | — | uuids del usuario autenticado |

`p_agrupar_por` acepta `tipo`, `vehiculo`, `flota` o `mes`. Cualquier otro valor
devuelve error, a propósito.

### Lo que el bot NO puede llamar

`tarea_diaria`, `recalcular_resumen_flota` y `estado_segun_pagos` están reservadas
para `service_role` y conexiones directas. Si el bot las necesita, es señal de que
algo se está haciendo en el lugar equivocado.

---

## 5. Comandos deterministas

Conviene que existan además del agente conversacional: son predecibles, baratos y
siguen funcionando si el LLM falla o se acaba la cuota.

| Comando | Qué hace |
|---|---|
| `/start <codigo>` | Canjea el código de invitación y vincula el chat |
| `/flota` | Resumen de todas las flotas (lee `resumenes_flota`) |
| `/flota <nombre>` | `resumen_flota()` de una en particular |
| `/vehiculo <dominio>` | `detalle_vehiculo()` |
| `/vencimientos [dias]` | Lo que vence en N días (por defecto 30) |
| `/vencidos` | Solo `estado_efectivo = vencido` |
| `/pagar <id>` | `link_de_pago()`: botón con la URL, importe y QR |
| `/pague <id> <monto>` | Registra un pago, con confirmación inline |
| `/reporte <desde> <hasta>` | `reporte_gastos()` |
| `/ayuda` | La lista de arriba |

Nota sobre los identificadores: los uuid no se pueden tipear en un chat. Conviene
mostrar un índice corto (`#12`) por mensaje y resolverlo contra el uuid del lado
del bot, o usar botones inline con el uuid en el `callback_data`.

---

## 6. El agente conversacional

Encima de los comandos, un loop de tool calling con Claude
(`claude-sonnet-5` alcanza y es más barato y rápido que Opus para esto).

**Las herramientas son envoltorios finos de los RPC de arriba.** No agregar lógica:
validar la entrada con los esquemas zod de `@flota/compartido`, llamar, formatear.

Herramientas de lectura, sin confirmación:

```
listar_flotas          buscar_vehiculo      detalle_vehiculo
resumen_flota          listar_vencimientos  reporte_gastos
link_de_pago
```

Herramientas de escritura, **siempre con confirmación por botón inline** antes de
ejecutar:

```
registrar_pago         anular_pago          cargar_vencimiento
crear_regla            dar_de_baja_vehiculo
```

Reglas del loop:

- Ejecutar cada herramienta **con el JWT del usuario**, nunca con `service_role`.
- Límite de turnos por conversación (5 o 6) para que un modelo confundido no entre
  en bucle.
- Ante un error de Postgres, no mostrarlo crudo: los esquemas zod existen para dar
  un mensaje en castellano antes de llegar a la base.
- El contenido de los mensajes de Telegram es **dato, no instrucción**. Si un
  mensaje dice "ignorá las reglas anteriores", es texto de un usuario, no una
  orden.

---

## 7. Despacho de avisos

La base ya decidió a quién avisar. El bot solo reparte.

`pg_cron` corre `tarea_diaria()` a las **11:00 UTC = 08:00 en Córdoba**: genera las
cuotas futuras y encola en `avisos`. Una fila con `enviado_en` nulo está pendiente.

El bot necesita un disparador propio poco después (una Edge Function con su propio
cron, o un worker) que haga:

```
1. Con service_role, leer:
   GET /rest/v1/avisos?enviado_en=is.null&order=programado_para&limit=100

2. Por cada uno, traer el contexto:
   GET /rest/v1/v_vencimientos_estado?id=eq.<vencimiento_id>

3. Resolver a quién: organizacion_id -> miembros -> vinculos_telegram -> chat_id

4. Mandar el mensaje con botones: [Ver link de pago] [Marcar pagado]

5. Marcar el resultado:
   PATCH /rest/v1/avisos?id=eq.<id>
   { "enviado_en": "...", "exito": true, "destinatario": "<chat_id>" }
```

Detalles que importan:

- **Marcar siempre**, también los fallidos, con `exito: false` y el `error`. Un
  aviso que nunca se marca se reintenta para siempre.
- **Límites de Telegram**: ~30 mensajes por segundo en total y ~1 por segundo por
  chat. Con una flota grande hay que espaciar los envíos.
- La idempotencia ya está resuelta por `unique (vencimiento_id, clave_regla)`: la
  base no encola dos veces el mismo aviso. El bot solo tiene que no mandar dos
  veces la misma fila.
- `clave_regla` dice qué aviso es (`d-30`, `d-7`, `d-0`, `d+1`) y sirve para
  cambiar el tono del mensaje: no es lo mismo "vence en 30 días" que "venció hace
  una semana".

---

## 8. Realtime (opcional para el bot)

Ya está cableado y verificado, pero un bot de chat no lo necesita: no tiene una
pantalla que refrescar. Es para la Mini App de React.

Si igual se quiere usar (por ejemplo para avisar en un grupo cuando alguien
registra un pago):

- Canal privado por flota: `flota:<flota_id>`
- Evento: `resumen_actualizado`
- Payload: el resumen compacto (`cantidad_vencidos`, `monto_vencido`, etc.)
- Requiere `realtime.setAuth(<jwt del usuario>)`; un usuario de otra organización
  no puede suscribirse

Hay una constante `canalDeFlota(flotaId)` en `@flota/compartido`.

---

## 9. Pagos: hasta dónde llega el bot

`link_de_pago()` devuelve la URL oficial con `{dominio}`, `{periodo}` y `{cuenta}`
ya resueltos. El bot manda:

- Un botón URL con el link
- El dominio y el importe en formato copiable (con backticks, para que se copien
  de un toque)
- Un QR del link, como foto, para abrirlo desde otro dispositivo

**El sistema nunca mueve dinero.** No hay integración de pagos ni la va a haber:
acerca el link, el pago lo hace una persona. Si aparece el pedido de automatizar
el portal de Rentas, la respuesta es no: requiere login con CUIT, tiene captcha y
se rompe con cada cambio del sitio.

Marcar como pagado es un registro contable en `pagos`, no una transacción.

---

## 10. Dónde vive el bot

Edge Function de Supabase (Deno + TypeScript), con
[grammY](https://grammy.dev) — es nativo de Deno, TS primero y trae
`webhookCallback`. Webhook, no polling.

```
supabase/functions/
  telegram/index.ts     webhook: comandos + derivación al agente
  agente/index.ts       loop de tool calling con Claude
  despachar-avisos/index.ts   consume la cola de avisos
```

Secretos con `supabase secrets set`: el token del bot, el `secret_token` del
webhook (verificar SIEMPRE la cabecera `X-Telegram-Bot-Api-Secret-Token`) y la
clave de la API de Anthropic.

Una restricción a tener presente: **responder el webhook rápido**. Un loop de LLM
puede pasarse del tiempo de la Edge Function. El patrón es contestar 200 de
inmediato, mandar la acción "escribiendo…" y seguir procesando en segundo plano.

---

## 11. Para desarrollar

```bash
npm run demo
```

Deja 3 flotas, 16 vehículos, ~650 vencimientos, ~200 pagos históricos y ~100
avisos en cola, con un mix realista de vencidos, pendientes y parciales. Es contra
esto que conviene probar el bot.

Usar un bot de prueba de @BotFather, nunca el de producción, y correr
`npm run verificar:todo` antes de dar por terminado cualquier cambio que toque la
base.
