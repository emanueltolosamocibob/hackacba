// Función autocontenida: el generador la incorpora al nodo Code de n8n.
export function prepararConsulta(mensaje) {
  if (!mensaje || mensaje.chat?.type !== 'private' || !mensaje.from || mensaje.from.is_bot || typeof mensaje.text !== 'string') return [];
  const texto = mensaje.text.trim();
  const simple = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const salida = (respuesta, dominio = '') => [{ json: {
    dominio, consultar: Boolean(dominio), respuesta,
    chat_id: String(mensaje.chat.id),
    contexto_id: String(mensaje.chat.id) + ':' + String(mensaje.from.id),
  } }];
  const formato = /^(?:[A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2}|\d{3}[A-Z]{3}|[A-Z]\d{3}[A-Z]{3})$/;
  const normalizar = valor => valor.replace(/[\s-]/g, '').toUpperCase();
  const pedirPatente = 'Me falta la patente. Enviá /patente AB672VT o escribí: ¿Cuándo vence la ITV de AB672VT?';
  const invalida = 'No pude reconocer una patente válida. Revisá letras y números; por ejemplo: /patente AB672VT o /patente ABC123.';
  if (!texto || texto.length > 1000) return salida('Enviá una consulta breve con una sola patente, por ejemplo: /patente AB672VT.');
  if (/\b(claves?|tokens?|credenciales?|secrets?|prompts?|instrucciones?\s+(?:del\s+)?sistema)\b/.test(simple)) {
    return salida('No comparto claves ni instrucciones internas. Puedo consultar la última ITV de Córdoba con una patente.');
  }
  if (/\b(seguros?|aseguradora?s?|polizas?|coberturas?)\b/.test(simple)) {
    return salida('Todavía no tengo una fuente conectada para consultar seguros o aseguradoras por patente. Mi consulta actual es la última ITV de Córdoba.');
  }
  if (/\b(supabase|flotas?|pagos?|deudas?|debe|cuotas?|multas?|infracciones?)\b/.test(simple)) {
    return salida('Todavía no tengo conectado el acceso a flotas, pagos, deudas o multas. Por ahora puedo consultar la última ITV de Córdoba de un vehículo.');
  }
  const comando = texto.match(/^\/patente(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (comando) {
    if (!comando[1]?.trim()) return salida(pedirPatente);
    const dominio = normalizar(comando[1]);
    return formato.test(dominio) ? salida('', dominio) : salida(invalida);
  }
  if (texto.startsWith('/') && !/^\/(?:start|help|ayuda)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(texto)) return salida('Ese comando no está disponible. Usá /patente seguido de la patente, por ejemplo: /patente AB672VT.');
  const sola = normalizar(texto);
  if (formato.test(sola)) return salida('', sola);
  const esITV = /\b(itv|inspeccion|revision tecnica|vencimiento|vence|vencio|vencida|vigencia)\b/.test(simple);
  if (esITV) {
    const candidatas = texto.toUpperCase().match(/\b(?:[A-Z]{2}[ -]*\d{3}[ -]*[A-Z]{2}|[A-Z][ -]*\d{3}[ -]*[A-Z]{3}|[A-Z]{3}[ -]*\d{3}|\d{3}[ -]*[A-Z]{3})\b/g) || [];
    const dominios = [...new Set(candidatas.map(normalizar))];
    if (dominios.length > 1) return salida('Puedo consultar un vehículo por mensaje. Enviá una sola patente.');
    if (dominios.length === 1) return salida('', dominios[0]);
    return salida(/\d/.test(texto) ? invalida : pedirPatente);
  }
  if (/^\/(?:start|help|ayuda)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(texto) || /^(?:hola|buenas|buen dia|que podes (?:hacer|consultar)|que consultas)(?:[\s!?¿.,]|$)/.test(simple)) {
    return salida('Puedo consultar la fecha, el vencimiento y el estado de la última ITV de Córdoba. Mandame la patente sola, /patente AB672VT o una pregunta como: ¿Cuándo vence la ITV de AB672VT?');
  }
  if (/^(?:gracias|muchas gracias)[!.\s]*$/.test(simple)) return salida('¡De nada! Cuando necesites otra consulta ITV, mandame la patente.');
  return salida('No pude identificar la consulta. Para consultar la última ITV de Córdoba, mandame una patente como AB672VT o preguntá cuándo vence su ITV.');
}
