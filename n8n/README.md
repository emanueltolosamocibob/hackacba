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
una por contexto de chat/usuario. `ITV_MAX_SESIONES` permite ajustar el límite
(1 a 20). Un reinicio descarta las consultas pendientes.

### Despliegue de prueba en Render

El servicio de esta sesión se desplegó desde una copia independiente del módulo
en el repositorio privado `BeEasy000/telegram-itv-service`, porque la cuenta
colaboradora no puede instalar la integración Render sobre `hackacba`.
URL: https://telegram-itv-service.onrender.com. Se verificó `/health` (200) y
rechazo sin clave (401). El workflow de n8n tiene ambas URLs y la credencial restringida al servicio.
La consulta completa con GPT-6 Astra y Telegram pasó el 2026-09-12:
AB672VT, inspección 31/07/26, vencimiento 31/07/27, estado No Vencida
(consultado en 2026-09-12T05:24:48.968Z). El workflow quedó publicado.

`hackacba` sigue siendo el proyecto principal. Esta copia incluye solamente
el módulo ITV; los cambios deben sincronizarse explícitamente. No copia datos ni
conecta Supabase. El acceso a flotas/pagos desde el bot requiere el vínculo de
usuarios y autenticación descritos arriba y en `BOT.md`.

La plantilla que sigue permite desplegar directamente desde `hackacba` si en el
futuro su propietario habilita la integración:

El `render.yaml` de la raíz prepara un servicio Docker Free desde la rama
`codex/n8n-telegram-itv`, con una instancia y una consulta simultánea.
Crear un Blueprint en Render, conectar únicamente este repositorio privado y
seleccionar esa rama. Revisar que el plan sea Free antes de crear el servicio.
La plantilla no incluye bases de datos, discos ni despliegues automáticos.

Render genera `ITV_API_KEY` como secreto aleatorio. Tras desplegar, copiar su
valor a una credencial Header Auth de n8n, sin guardarlo en el workflow exportado.
Usar el subdominio HTTPS asignado por Render para ambas herramientas; no hace
falta delegar `dcrzstudio.com.ar`. Comprobar primero `GET /health`.

El plan gratuito se suspende tras 15 minutos sin tráfico y puede tardar alrededor
de un minuto en arrancar. Las herramientas esperan hasta 120 segundos; configurar
el timeout total del workflow en 180 segundos (máximo observado en esta cuenta
de n8n Cloud) también si se importan los nodos
por portapapeles. El pegado no importa los ajustes globales del workflow.
Si el arranque y las llamadas del modelo exceden ese máximo, la ejecución puede
interrumpirse: hay que medirlo en la prueba real. Una suspensión o reinicio
invalida las sesiones pendientes. Esta configuración
sirve para una prueba con poco tráfico; aún hay que comprobar el consumo de
memoria de Chromium en la instancia. No se validó la imagen Docker localmente
porque el daemon Docker no está iniciado.

Referencias: [Blueprints](https://render.com/docs/blueprint-spec) y
[límites del plan gratuito](https://render.com/docs/free).

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
Las pruebas locales no llaman al modelo; GPT-6 Astra fue verificado en la
prueba real de n8n Gateway con las dos herramientas. Para
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
manual del formulario. La prueba real detectó un postback asíncrono de ASP.NET
UpdatePanel; se corrigió la espera para detectar respuesta POST y tabla visible.
El recorrido completo fue verificado antes de publicar.

Integración verificada en n8n: Telegram, Gateway y servicio autenticado;
`/start`, luego `/patente AB672VT`, ambas herramientas y respuesta real del sitio.
Un fallo del postback produjo un mensaje de error sin inventar estado ITV.
Pendiente: medir arranque en frío y carga simultánea de usuarios distintos.
No incluir tokens en logs.

No se ejecutan migraciones, seeds ni verificaciones contra la base remota: este
cambio no toca el esquema ni tiene credenciales de Supabase. El módulo tampoco
crea una API oficial de ITV ni implica un acuerdo de acceso con el operador.

Referencias:
- [Tools Agent de n8n](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent)
- [OpenAI Chat Model](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai)
- [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
