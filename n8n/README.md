# Telegram + n8n + ITV Córdoba

Este módulo agrega la consulta `/patente AB672VT` al proyecto. Usa n8n Cloud como
receptor de Telegram y un servicio Node con Playwright para interactuar con ITV.
El LLM recibe la operación visible, la resuelve y llama a la segunda herramienta.
El servidor mantiene la sesión del navegador y verifica la patente del resultado.

```text
Telegram Trigger → Preparar consulta → Es consulta → Agente → Responder Telegram
                                          └──────→ Ayuda ──→ Responder Telegram

Agente → iniciar_consulta_itv → operación + sesión
Agente → completar_consulta_itv(respuesta) → tabla verificada
```

## Relación con el backend existente

La elección de n8n para esta interfaz reemplaza la propuesta de webhook en Edge
Functions de `BOT.md` para este módulo. No se deben registrar dos webhooks sobre
el mismo bot. Las reglas de negocio y RLS del backend de flotas siguen en Postgres.

Este workflow no ofrece acceso a flotas ni registra ITV como deuda, cuota o pago.
Para sumar datos privados, primero hay que implementar los vínculos de Telegram
e invitaciones previstos en `BOT.md`. Cada consulta de negocio debe utilizar el
JWT del usuario. No conectar `service_role` a herramientas del agente.

## 1. Preparar el navegador

Requisitos: Node 22 o superior para este servicio y un host que ejecute Chromium.
n8n Cloud llama al servicio por HTTPS; no ejecuta este proceso dentro del nodo Code.

Desde la raíz:

```sh
npm ci
npm run browser:install --workspace=@flota/itv
```

Configurar `ITV_API_KEY` (secreto aleatorio de al menos 32 caracteres) en las
variables del host, luego `npm run itv:start`. Escucha por defecto en
`127.0.0.1:3000`; `HOST=0.0.0.0` sirve para contenedores detrás de un proxy HTTPS.
No guardar el secreto en archivos versionados ni en el prompt.

También se incluye `paquetes/itv/Dockerfile`, para construir desde la raíz:

```sh
docker build -f paquetes/itv/Dockerfile -t flota-itv .
docker run --rm -p 3000:3000 --env ITV_API_KEY flota-itv
```

El despliegue requiere una URL HTTPS alcanzable desde n8n Cloud. No hay un host
creado por este cambio. `/health` comprueba el proceso, no la disponibilidad de ITV.
Usar una réplica: las sesiones están en memoria, expiran en dos minutos y se
cierran tras enviar el formulario. Límite inicial: cuatro sesiones simultáneas,
una por contexto de chat/usuario. Un reinicio descarta las consultas pendientes.

## 2. Importar en n8n

Importar `telegram-itv.json` desde el editor. Se entrega **inactivo**, sin tokens,
credenciales, historial ni datos de ejecución. No activarlo junto al workflow
inicial que ya usa el mismo bot.

Configurar:

| Nodo | Configuración |
|---|---|
| Telegram Trigger y Responder Telegram | Seleccionar la credencial del bot creado con BotFather |
| Modelo OpenAI | Credencial OpenAI; o Gateway credits si la cuenta los ofrece. Modelo inicial `gpt-6-astra`, Responses API activada |
| iniciar_consulta_itv | Reemplazar el host `.invalid` por la URL del servicio desplegado |
| completar_consulta_itv | Reemplazar el mismo host, conservando `/itv/completar` |
| Ambas herramientas HTTP | Header Auth: nombre `Authorization`, valor `Bearer <ITV_API_KEY>` |

El modelo disponible depende de la cuenta y de la compatibilidad de su nodo.
No se ha ejecutado una llamada al modelo como parte de la prueba local. Para
cambiarlo, modificar el nodo; no alcanza con nombrarlo en el System Message.

`contexto_id` y `dominio` vienen de `Preparar consulta`, fuera del control del
LLM. Las únicas entradas elegidas por el modelo son el ID de sesión devuelto por
la herramienta y la respuesta aritmética. Cada ejecución recibe una actualización
de Telegram y no comparte memoria conversacional. Los grupos y mensajes sin
texto se descartan. Los mensajes distintos de `/patente DOMINIO` reciben ayuda
sin llamar al modelo.

## 3. Instrucción de sistema

La fuente editable es `system-message.txt`. Para incorporar cambios en el JSON:

```sh
npm run n8n:generar
```

El importador no actualiza automáticamente un workflow que ya existe: volver a
importar en un borrador o copiar el System Message al nodo Consultar ITV.
Mantener las autorizaciones que exija el proveedor de herramientas. Una
instrucción de sistema no puede eliminar restricciones del servicio utilizado.

## Contrato HTTP

Todas las llamadas de consulta requieren el header de autorización. Ejemplos
con valores ficticios, no respuestas reales del sitio:

```json
POST /itv/iniciar
{"dominio":"AB672VT","contexto_id":"123:456"}

{"estado_consulta":"operacion_pendiente","sesion_id":"UUID","dominio":"AB672VT","operacion":"8 - 5","expira_en_segundos":120,"fuente":"https://itvcordoba.com.ar/Historico.aspx"}

POST /itv/completar
{"sesion_id":"UUID","contexto_id":"123:456","respuesta":3}
```

Una respuesta correcta contiene `estado_consulta: encontrado`, `dominio`,
`fecha_inspeccion`, `vencimiento`, `estado_itv`, `fuente` y `consultado_en`.
Las fechas se conservan como texto de la fuente; no se adivina el siglo ni se
deduce el estado desde el reloj del servidor.

Errores: HTTP 400 por entrada inválida, 401 sin credencial, 404 para una sesión
desconocida o ajena, 410 para sesión expirada, 429 por capacidad y 502 por fallo
del sitio o resultado no verificable. No se informa «sin registros» ante una
tabla ausente: aún falta observar el mensaje real que usa ITV en ese caso.
No se reintenta automáticamente el formulario. La herramienta no acepta URL,
código ni selectores proporcionados por el modelo.

## Validación y límites

```sh
npm run itv:test
npm run verificar:tipos
```

Los tests usan un adaptador simulado: cubren normalización, las 200 formas de
operación, aislamiento entre contextos, expiración, límite concurrente,
autenticación y errores sin resultados inventados. No prueban la disponibilidad
del sitio ni la interpretación del modelo. Los selectores proceden de la prueba
manual del formulario; el adaptador Playwright usa el postback de ASP.NET y
debe verificarse contra el sitio antes de publicar.

Prueba de integración pendiente en n8n: conectar las tres credenciales/servicios,
ejecutar `/start`, luego `/patente AB672VT`, verificar ambas llamadas y comparar
el resultado con ITV. Probar también formato inválido, timeout y consultas
simultáneas de usuarios distintos. Verificar que ningún token aparezca en logs.

No se ejecutan migraciones, seeds ni verificaciones contra la base remota: este
cambio no toca el esquema ni tiene credenciales de Supabase. El módulo tampoco
crea una API oficial de ITV ni implica un acuerdo de acceso con el operador.

Referencias:
- [Tools Agent de n8n](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent)
- [OpenAI Chat Model](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai)
- [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
