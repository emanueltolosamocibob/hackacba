import { readFileSync, writeFileSync } from 'node:fs';

const sistema = readFileSync(new URL('./system-message.txt', import.meta.url), 'utf8');
const nodo = (id, name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id, name, type, typeVersion, position, parameters, ...extra });
const edge = (node, type = 'main', index = 0) => ({ node, type, index });
const preparar = `const mensaje = $json.message;
// No responder en grupos ni procesar mensajes de otros bots.
if (!mensaje || mensaje.chat?.type !== 'private' || !mensaje.from || mensaje.from.is_bot || typeof mensaje.text !== 'string') return [];
const texto = mensaje.text.trim();
const match = texto.match(/^\\/patente(?:@[A-Za-z0-9_]+)?\\s+([A-Za-z0-9\\s-]+)$/i);
const dominio = match ? match[1].replace(/[\\s-]/g, '').toUpperCase() : '';
const valido = /^(?:[A-Z]{3}\\d{3}|[A-Z]{2}\\d{3}[A-Z]{2}|\\d{3}[A-Z]{3}|[A-Z]\\d{3}[A-Z]{3})$/.test(dominio);
return [{json: {
  dominio, consultar: valido,
  chat_id: String(mensaje.chat.id),
  contexto_id: String(mensaje.chat.id) + ':' + String(mensaje.from.id),
  respuesta: 'Hola. Consultá la última ITV de Córdoba con /patente AB672VT. No consulto seguros ni otras jurisdicciones.'
}}];`;

const httpBase = {
  method: 'POST', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendBody: true, specifyBody: 'json',
  options: { timeout: 120000, response: { response: { neverError: true, responseFormat: 'json' } } },
};

const workflow = {
  name: 'Telegram - ITV con agente y navegador',
  active: false,
  nodes: [
    nodo('telegram', 'Telegram Trigger', 'n8n-nodes-base.telegramTrigger', 1.2, [0, 0], { updates: ['message'], additionalFields: {} }),
    nodo('preparar', 'Preparar consulta', 'n8n-nodes-base.code', 2, [240, 0], { jsCode: preparar }),
    nodo('if', 'Es consulta', 'n8n-nodes-base.if', 2.2, [460, 0], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'consulta', leftValue: '={{ $json.consultar }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {},
    }),
    nodo('agent', 'Consultar ITV', '@n8n/n8n-nodes-langchain.agent', 3.1, [720, -140], {
      promptType: 'define', text: '=Consultá la última ITV para {{ $json.dominio }}.',
      options: { systemMessage: sistema, maxIterations: 4, returnIntermediateSteps: false },
    }, { onError: 'continueRegularOutput' }),
    nodo('model', 'Modelo OpenAI', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.3, [560, 150], {
      model: { __rl: true, mode: 'id', value: 'gpt-6-astra' }, responsesApiEnabled: true,
      options: { timeout: 60000, maxRetries: 1 },
    }),
    nodo('inicio', 'iniciar_consulta_itv', 'n8n-nodes-base.httpRequestTool', 4.3, [790, 150], {
      ...httpBase,
      toolDescription: 'Inicia una sola consulta ITV para el dominio validado por el workflow. Devuelve sesion_id y operacion aritmética visible. No requiere argumentos del modelo.',
      url: 'https://CONFIGURAR-SERVICIO-ITV.invalid/itv/iniciar',
      jsonBody: "={{ JSON.stringify({ dominio: $('Preparar consulta').item.json.dominio, contexto_id: $('Preparar consulta').item.json.contexto_id }) }}",
    }),
    nodo('completar', 'completar_consulta_itv', 'n8n-nodes-base.httpRequestTool', 4.3, [1020, 150], {
      ...httpBase,
      toolDescription: 'Completa la sesión devuelta por iniciar_consulta_itv con el resultado entero de su operación. Devuelve datos verificados o un error. Usar una sola vez.',
      url: 'https://CONFIGURAR-SERVICIO-ITV.invalid/itv/completar',
      jsonBody: "={{ JSON.stringify({ sesion_id: $fromAI('sesion_id', 'Identificador exacto devuelto por iniciar_consulta_itv', 'string'), respuesta: $fromAI('respuesta', 'Resultado entero de la operación visible, de -9 a 18', 'number'), contexto_id: $('Preparar consulta').item.json.contexto_id }) }}",
    }),
    nodo('respuesta', 'Responder Telegram', 'n8n-nodes-base.telegram', 1.2, [1230, -40], {
      resource: 'message', operation: 'sendMessage',
      chatId: "={{ $('Preparar consulta').item.json.chat_id }}",
      text: "={{ $json.error ? 'No pude completar la consulta. Intentá nuevamente más tarde.' : ($json.output || $json.respuesta || 'No pude completar la consulta.') }}",
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    }),
    nodo('nota', 'Configuracion requerida', 'n8n-nodes-base.stickyNote', 1, [0, -390], {
      content: '## Antes de activar\n1. Seleccionar la credencial de Telegram en ambos nodos.\n2. Conectar OpenAI (o Gateway si está disponible).\n3. Desplegar paquetes/itv y reemplazar las dos URLs .invalid.\n4. Seleccionar Header Auth: Authorization = Bearer <ITV_API_KEY> en ambas herramientas.\n5. Ver n8n/README.md. No usar el mismo bot en dos workflows activos.',
      width: 600, height: 280,
    }),
  ],
  connections: {
    'Telegram Trigger': { main: [[edge('Preparar consulta')]] },
    'Preparar consulta': { main: [[edge('Es consulta')]] },
    'Es consulta': { main: [[edge('Consultar ITV')], [edge('Responder Telegram')]] },
    'Consultar ITV': { main: [[edge('Responder Telegram')]] },
    'Modelo OpenAI': { ai_languageModel: [[edge('Consultar ITV', 'ai_languageModel')]] },
    iniciar_consulta_itv: { ai_tool: [[edge('Consultar ITV', 'ai_tool')]] },
    completar_consulta_itv: { ai_tool: [[edge('Consultar ITV', 'ai_tool')]] },
  },
  settings: { executionOrder: 'v1', timezone: 'America/Argentina/Cordoba', executionTimeout: 300 },
  pinData: {}, tags: [],
};

// El texto del agente es no confiable: escapar HTML antes de enviarlo a Telegram.
workflow.nodes.find(n => n.name === 'Responder Telegram').parameters.text =
  "={{ ($json.error ? 'No pude completar la consulta. Intentá nuevamente más tarde.' : ($json.output || $json.respuesta || 'No pude completar la consulta.')).slice(0, 3900).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}";

writeFileSync(new URL('./telegram-itv.json', import.meta.url), JSON.stringify(workflow, null, 2) + '\n');
console.log('Generado n8n/telegram-itv.json (inactivo y sin credenciales).');
