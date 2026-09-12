# El bot de Telegram

El bot construido sobre el backend que ya está en Supabase: el reparto de
responsabilidades, cómo un chat obtiene un JWT, la superficie de la API que
consume, el despacho de avisos y cómo ponerlo en marcha.

Leer antes el [README](README.md) para el modelo de datos.

**Estado: escrito y sin desplegar.** El código está en `supabase/functions/`;
falta aplicar la migración `0016`, cargar los secretos y registrar el webhook.
Todo eso está en la [sección 11](#11-puesta-en-marcha).

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

## 2. El alta de usuarios (migraciones 0012-0015)

**El único perfil real del producto es la persona administrativa que paga.** No
hay choferes ni usuarios de consulta. Todo el alta está resuelto en la base.

### El flujo, de punta a punta

```
1. Vos, con service_role:
     registrar_organizacion('Transportes X', '+54 351 400 1234')
     -> crea la organizacion, le siembra el catalogo de Cordoba,
        le crea la regla de aviso, y deja una invitacion de propietario
        esperando ese numero

2. La persona abre el bot y toca "Compartir mi numero"
     (boton request_contact del teclado de Telegram)

3. El bot:
     a. VERIFICA que contact.user_id === message.from.id
     b. crea la cuenta de auth con ese telefono/email
     c. canjear_por_telefono(numero, usuario_id, telegram_user_id, chat_id)

4. Adentro, como propietario.
```

### Por qué por número y no por código

Telegram **garantiza** el número: con `request_contact` no es un campo que el
usuario tipea, es el número con el que se registró. Un código de invitación se
puede reenviar a quien no era; un número verificado, no. Y encaja con cómo piensa
un dueño de flota: no tiene códigos, tiene los teléfonos de su gente.

El canje por código (`canjear_invitacion`) sigue existiendo para cuando no tenés
el número, o para mandar un `t.me/<bot>?start=<codigo>` y listo.

> **El error que rompe todo.** El objeto `contact` de Telegram trae `user_id`
> **solo si el contacto es el del propio remitente**. Si el bot no comprueba
> `message.contact.user_id === message.from.id`, cualquiera reenvía la tarjeta de
> contacto de otra persona y entra como ella. Es una línea de código y es la
> diferencia entre un número verificado y uno declarado.

### Normalización de teléfonos

Ya está resuelta en la base: `+54 9 351 123-4567`, `0351 15 123 4567` y
`3511234567` son la misma línea y dan la misma clave. Contempla el código de
país, el `9` internacional, el `0` de larga distancia y el `15` de celular —que
va en el medio, después del código de área, y es lo que hace que comparar por los
últimos dígitos no alcance.

El bot no tiene que normalizar nada: manda el número tal como se lo dio Telegram.

### Tablas y funciones

| | |
|---|---|
| `invitaciones` | Códigos de un solo uso, con teléfono o email. Solo las ve un administrador de esa organización |
| `vinculos_telegram` | Qué usuario hay detrás de cada chat. **No se expone por PostgREST**: solo `service_role` |
| `registrar_organizacion(nombre, telefono, email?, cuit?, zona?)` | Alta completa. Solo `service_role` |
| `crear_invitacion(org, rol?, telefono?, email?, dias?)` | Invita. Por defecto `administrador`. Solo el servidor puede emitir `propietario` |
| `canjear_por_telefono(tel, usuario, tg_id, chat, nombre?)` | El alta por botón. Solo `service_role` |
| `canjear_invitacion(codigo, usuario, tg_id, chat, nombre?)` | El alta por código. Solo `service_role` |
| `contexto_telegram(tg_id)` | Quién es, sobre qué organización opera y a cuáles pertenece |
| `cambiar_organizacion_activa(tg_id, org)` | Verifica la membresía; no confía en el bot |
| `desvincular_telegram(tg_id)` | Suelta el chat. **No quita la membresía**: para echar a alguien se borra su fila de `miembros` |

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

**a) Guardar el refresh token (menos llamadas).** Al vincular se crea la sesión
una vez y se guarda el `refresh_token`. La tabla `vinculos_telegram` **no tiene
esa columna a propósito**: guardar una credencial de larga duración que todavía
no se usa es todo desventaja. Si se elige este camino, es un `ALTER TABLE`.
Después, por cada interacción:

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

**Se implementó (b)**, en `_compartido/sesion.ts`, con una tercera llamada para
resolver el email a partir del `usuario_id` que devuelve `contexto_telegram`. El
token se cachea en memoria del isolate hasta diez minutos antes de vencer, así
que las tres llamadas ocurren una vez por hora y no una vez por mensaje. Si el
isolate se recicla, se vuelve a emitir: se pierde latencia, no corrección.

Si esa latencia llega a molestar, el camino es (a), y es un `ALTER TABLE`.

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
| `crear_invitacion` | `p_organizacion_id: uuid`, `p_rol`, `p_telefono: text`, `p_email: text`, `p_dias_validez: integer` | jsonb con el código y su vencimiento |

`p_agrupar_por` acepta `tipo`, `vehiculo`, `flota` o `mes`. Cualquier otro valor
devuelve error, a propósito.

### Lo que el bot NO puede llamar

Con el JWT de un usuario no se pueden llamar: `tarea_diaria`,
`recalcular_resumen_flota` ni `estado_segun_pagos`.

Y con `service_role` (nunca con el del usuario): `registrar_organizacion`,
`canjear_por_telefono`, `canjear_invitacion`, `contexto_telegram`,
`cambiar_organizacion_activa` y `desvincular_telegram`. Son las del alta, y por
eso viven del lado del servidor.

---

## 5. Comandos deterministas

Conviene que existan además del agente conversacional: son predecibles, baratos y
siguen funcionando si el LLM falla o se acaba la cuota.

| Comando | Qué hace |
|---|---|
| `/start` | Pide el número con un botón `request_contact` y vincula el chat |
| `/start <codigo>` | Alternativa por código, para un enlace `t.me/<bot>?start=<codigo>` |
| `/flota` | Resumen de todas las flotas (lee `resumenes_flota`) |
| `/flota <nombre>` | `resumen_flota()` de una en particular |
| `/vehiculo <dominio>` | `detalle_vehiculo()` |
| `/vencimientos [dias]` | Lo que vence en N días (por defecto 30) |
| `/vencidos` | Solo `estado_efectivo = vencido` |
| `/pagar <codigo>` | `link_de_pago()`: botón con la URL, importe y QR |
| `/pague <codigo> <monto>` | Registra un pago, con confirmación inline |
| `/reporte <desde> <hasta>` | `reporte_gastos()` |
| `/organizacion [nombre]` | Ver o cambiar la organización activa |
| `/olvidar` | Vacía la memoria de la conversación |
| `/salir` | `desvincular_telegram()` |
| `/ayuda` | La lista de arriba |

**Sobre los identificadores.** Un uuid no se tipea en un chat. Se resolvió con
los **primeros seis caracteres hex del uuid**, no con un índice `#12`: el código
corto es estable —el mismo vencimiento tiene el mismo código en cualquier
listado y mañana también— y no obliga a guardar el mapa del último listado por
chat, que es justamente el tipo de estado que un isolate efímero pierde. Cuando
dos vencimientos comparten prefijo, el bot pide más caracteres.

Los botones inline, en cambio, llevan el uuid completo en el `callback_data`:
ahí entra y no hay nada que resolver.

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

**Cómo quedó la confirmación.** La herramienta de escritura no escribe: guarda
los argumentos en `acciones_pendientes` (migración `0016`) y manda un botón cuyo
`callback_data` lleva solo un código de doce caracteres. Los argumentos no
viajan por el cliente por dos razones: no entran —Telegram corta el
`callback_data` en 64 bytes y un motivo de anulación no cabe— y un dato que pasa
por el cliente se puede fabricar. La acción es de un solo uso, vence a los diez
minutos y solo la puede confirmar el mismo `telegram_user_id` que la pidió, que
es lo que impide que en un grupo uno apriete el botón de otro.

El modelo **nunca ve el uuid de un vencimiento ni de un vehículo**: recibe
códigos cortos y dominios, y el bot los resuelve antes de guardar la acción. Un
uuid alucinado no llega a la base.

---

## 7. Despacho de avisos

La base ya decidió a quién avisar. El bot solo reparte.

`pg_cron` corre `tarea_diaria()` a las **11:00 UTC = 08:00 en Córdoba**: genera las
cuotas futuras y encola en `avisos`. Una fila con `enviado_en` nulo está pendiente.

`despachar-avisos` es el disparador. Los tres pasos que en el diseño original
eran consultas del bot —el aviso, su vencimiento y a qué chats va— los resuelve
`avisos_pendientes()` (migración `0016`) en una sola llamada, en vez de tres por
aviso.

```
1. servicio.rpc('avisos_pendientes', { p_limite: 200 })
2. Agrupar por chat y componer un mensaje por chat
3. Enviar
4. PATCH /rest/v1/avisos?id=in.(...)  con enviado_en, exito, destinatario y error
```

Detalles que importan:

- **Marcar siempre**, también los fallidos, con `exito: false` y el `error`. Un
  aviso que nunca se marca se reintenta para siempre. Hasta "esta organización
  no tiene ningún Telegram vinculado" se escribe como fallo con su motivo.
- **Un mensaje por chat, no por aviso.** El primero de mes puede haber cuarenta
  cuotas de la misma flota: cuarenta mensajes seguidos son una notificación que
  nadie lee, y además chocan contra el límite de un mensaje por segundo por chat.
  Cuando el chat recibe uno solo, el mensaje lleva botones; cuando recibe varios
  en una lista, cada línea trae su código corto.
- **Se marca al final, no chat por chat.** Un aviso puede ir a varias personas:
  si se marcara en el medio, el envío que falló pisaría al que salió bien y el
  próximo despacho se lo mandaría de nuevo al primero. Alcanza con que haya
  llegado a alguien.
- **Límites de Telegram**: ~30 mensajes por segundo en total y ~1 por segundo por
  chat. Se espera 1,1 s solo entre partes de un mismo chat, y 60 ms entre chats.
- La idempotencia ya está resuelta por `unique (vencimiento_id, clave_regla)`: la
  base no encola dos veces el mismo aviso. El bot solo tiene que no mandar dos
  veces la misma fila.
- `clave_regla` dice qué aviso es (`d-30`, `d-7`, `d-0`, `d+1`) y cambia el tono
  del mensaje: no es lo mismo "vence en 30 días" que "venció hace una semana".

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

Edge Functions de Supabase (Deno + TypeScript). Webhook, no polling.

```
supabase/functions/
  telegram/index.ts            webhook: alta, comandos y botones
  agente/index.ts              loop de tool calling con Claude
  despachar-avisos/index.ts    consume la cola de avisos
  _compartido/
    entorno.ts      secretos, con un error claro si falta alguno
    rest.ts         los dos clientes: service_role y JWT de usuario
    sesion.ts       chat_id -> JWT, y el alta de la cuenta de auth
    negocio.ts      envoltorios finos de la API
    escrituras.ts   las cinco escrituras y su validación zod
    mensajes.ts     los mensajes compuestos que salen al chat
    telegram.ts     cliente de la API de Telegram
    formato.ts      importes, fechas y el código corto
    qr.ts           el QR del link de pago
  deno.json         el mapa de imports
```

**No se usa grammY.** El bot tiene un webhook, un puñado de comandos y unos
botones; el router y el middleware de un framework no compran nada frente a un
`switch` sobre `update.message.text`, y a cambio agregan una dependencia en el
camino crítico. La API de Telegram que se usa son siete métodos, en
`_compartido/telegram.ts`.

Secretos con `supabase secrets set`: el token del bot, el `secret_token` del
webhook (que la función verifica en su primera línea) y la clave de la API de
Anthropic. Las tres `SUPABASE_*` las inyecta la plataforma.

**Responder el webhook rápido**, porque Telegram reintenta el update si tarda, y
un reintento es un mensaje duplicado para la persona. Se contesta 200 apenas se
valida la cabecera y se sigue en segundo plano con `EdgeRuntime.waitUntil()`. El
agente vive en su propia función por lo mismo: se lo invoca por HTTP, contesta
202 al instante y corre el loop con su propio presupuesto de ejecución.

---

## 11. Puesta en marcha

Cuatro pasos. El primero toca la base; los otros tres, la plataforma.

**1. Aplicar la migración `0016`** (las dos tablas de estado del bot y
`avisos_pendientes`) y verificar:

```bash
npm run db:push
```

```bash
npm run verificar:todo
```

**2. Crear el bot y cargar los secretos.** El token sale de
[@BotFather](https://t.me/BotFather); usar uno de prueba, nunca el de
producción, mientras se desarrolla. El secreto del webhook lo inventás vos:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRETO_WEBHOOK=... ANTHROPIC_API_KEY=...
```

**3. Desplegar las tres funciones:**

```bash
npm run bot:desplegar
```

**4. Registrar el webhook** contra la función `telegram`. El `secret_token` es
el mismo valor de `TELEGRAM_SECRETO_WEBHOOK`:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -H "Content-Type: application/json" -d '{"url":"https://TU_REF.supabase.co/functions/v1/telegram","secret_token":"TU_SECRETO","allowed_updates":["message","callback_query"]}'
```

### El cron del despachador

`tarea_diaria()` encola a las 11:00 UTC. El despacho conviene unos minutos
después. No va en una migración porque necesita la URL del proyecto y la
service_role key, que son del despliegue y no del esquema — se corre una vez
desde el SQL editor:

```sql
select cron.schedule(
  'despachar-avisos',
  '10 11 * * *',
  $$
  select net.http_post(
    url     := 'https://TU_REF.supabase.co/functions/v1/despachar-avisos',
    headers := '{"Authorization": "Bearer TU_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

Para probarlo sin esperar al cron, la función admite un POST directo con la
service_role key, y `?limite=N` para acotar el lote.

### La primera organización

El alta la hace el servidor, no el bot (sección 2). Con `service_role`:

```sql
select public.registrar_organizacion('Transportes X', '+54 351 400 1234');
```

Después, esa persona abre el bot, toca **Compartir mi número** y entra como
propietaria.

### Qué queda sin verificar automáticamente

`npm run verificar:bot` cubre la migración `0016`: que nada de eso se vea desde
afuera, que una confirmación sea de un solo uso y de una sola persona, y que
`avisos_pendientes()` resuelva lo que el despachador da por hecho.

Lo que **no** cubre es el código de las Edge Functions: no hay tests de las
funciones, y probarlas de verdad quiere `deno check` (necesita Deno instalado) y
un bot de prueba de @BotFather contra `npm run demo`. Es el primer trabajo
pendiente si esto crece.

---

## 12. Para desarrollar

```bash
npm run demo
```

Deja 3 flotas, 16 vehículos, ~650 vencimientos, ~200 pagos históricos y ~100
avisos en cola, con un mix realista de vencidos, pendientes y parciales. Es contra
esto que conviene probar el bot.

Usar un bot de prueba de @BotFather, nunca el de producción, y correr
`npm run verificar:todo` antes de dar por terminado cualquier cambio que toque la
base.
