import { randomUUID } from 'node:crypto';

export const FUENTE = 'https://itvcordoba.com.ar/Historico.aspx';

export class ErrorConsulta extends Error {
  constructor(codigo, mensaje, status = 400) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

export function normalizarDominio(valor) {
  if (typeof valor !== 'string') throw new ErrorConsulta('dominio_invalido', 'Ingresá una patente.');
  const dominio = valor.replace(/[\s-]/g, '').toUpperCase();
  // Autos y motos: formatos anterior y Mercosur.
  if (!/^(?:[A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2}|\d{3}[A-Z]{3}|[A-Z]\d{3}[A-Z]{3})$/.test(dominio)) {
    throw new ErrorConsulta('dominio_invalido', 'Revisá el formato de la patente.');
  }
  return dominio;
}

export function validarContexto(valor) {
  // El workflow lo obtiene de Telegram. Nunca lo elige el modelo.
  if (typeof valor !== 'string' || !/^-?\d{1,20}:\d{1,20}$/.test(valor)) {
    throw new ErrorConsulta('contexto_invalido', 'Falta el contexto de la consulta.');
  }
  return valor;
}

export function leerOperacion(texto) {
  const coincidencia = texto.match(/Resuelva\s+el\s+captcha\s+para\s+continuar:\s*(\d)\s*([+\-−])\s*(\d)(?!\d)/i);
  if (!coincidencia) throw new ErrorConsulta('formato_no_reconocido', 'El formulario de ITV cambió.', 502);
  return `${coincidencia[1]} ${coincidencia[2].replace('−', '-')} ${coincidencia[3]}`;
}

export function leerResultado(dominio, texto, filas) {
  const titulo = texto.match(/Última\s+ITV\s+del\s+dominio:\s*([A-Z0-9]+)/i);
  if (!titulo || titulo[1].toUpperCase() !== dominio) {
    // La falta de tabla no demuestra ausencia de registros. No adivinar.
    throw new ErrorConsulta('resultado_no_verificado', 'ITV no devolvió un resultado verificable para esta patente.', 502);
  }
  const encabezado = filas.findIndex(fila => fila.map(v => v.trim()).join('|') === 'Fecha|Vencimiento|Estado');
  const datos = filas[encabezado + 1];
  if (encabezado < 0 || datos?.length !== 3 || !/^\d{2}\/\d{2}\/(?:\d{2}|\d{4})$/.test(datos[0]) ||
      !/^\d{2}\/\d{2}\/(?:\d{2}|\d{4})$/.test(datos[1]) || !/^(?:No Vencida|Vencida)$/i.test(datos[2])) {
    throw new ErrorConsulta('resultado_no_verificado', 'La tabla de ITV tiene un formato no reconocido.', 502);
  }
  return {
    estado_consulta: 'encontrado', dominio,
    fecha_inspeccion: datos[0], vencimiento: datos[1], estado_itv: datos[2],
    fuente: FUENTE, consultado_en: new Date().toISOString(),
  };
}

// Conserva el navegador entre las dos llamadas del agente. Un solo proceso;
// para varias réplicas se necesita afinidad de sesión o un almacén compartido.
export class ConsultasITV {
  constructor(abrir, { ttlMs = 120_000, maxSesiones = 4, ahora = Date.now } = {}) {
    this.abrir = abrir;
    this.ttlMs = ttlMs;
    this.maxSesiones = maxSesiones;
    this.ahora = ahora;
    this.sesiones = new Map();
  }

  async descartar(id) {
    const sesion = this.sesiones.get(id);
    if (!sesion) return;
    this.sesiones.delete(id);
    await sesion.pagina?.cerrar().catch(() => {});
  }

  async limpiar() {
    for (const [id, sesion] of this.sesiones) {
      if (!sesion.ocupada && sesion.expira <= this.ahora()) await this.descartar(id);
    }
  }

  async iniciar({ dominio: valor, contexto_id }) {
    const dominio = normalizarDominio(valor);
    validarContexto(contexto_id);
    await this.limpiar();
    if (this.sesiones.size >= this.maxSesiones || [...this.sesiones.values()].some(s => s.contexto_id === contexto_id)) {
      throw new ErrorConsulta('ocupado', 'Ya hay una consulta en curso. Intentá nuevamente en un momento.', 429);
    }
    const sesion_id = randomUUID();
    const sesion = { contexto_id, dominio, ocupada: true, expira: this.ahora() + this.ttlMs };
    // Reservar antes de abrir el navegador para limitar llamadas concurrentes.
    this.sesiones.set(sesion_id, sesion);
    try {
      sesion.pagina = await this.abrir(dominio);
      const operacion = leerOperacion(await sesion.pagina.texto());
      sesion.ocupada = false;
      sesion.expira = this.ahora() + this.ttlMs;
      return { estado_consulta: 'operacion_pendiente', sesion_id, dominio, operacion,
        expira_en_segundos: Math.floor(this.ttlMs / 1000), fuente: FUENTE };
    } catch (error) {
      await this.descartar(sesion_id);
      throw error;
    }
  }

  async completar({ sesion_id, contexto_id, respuesta }) {
    validarContexto(contexto_id);
    const sesion = this.sesiones.get(sesion_id);
    if (!sesion || sesion.contexto_id !== contexto_id) {
      throw new ErrorConsulta('sesion_no_disponible', 'La sesión no está disponible.', 404);
    }
    if (sesion.ocupada) throw new ErrorConsulta('ocupado', 'La consulta está en curso.', 409);
    if (sesion.expira <= this.ahora()) {
      await this.descartar(sesion_id);
      throw new ErrorConsulta('sesion_expirada', 'La consulta expiró. Iniciá una nueva.', 410);
    }
    if (!Number.isInteger(respuesta) || respuesta < -9 || respuesta > 18) {
      throw new ErrorConsulta('respuesta_invalida', 'La respuesta debe ser un entero entre -9 y 18.');
    }
    sesion.ocupada = true;
    try {
      // La respuesta viene del modelo; no se calcula ni se usa eval en el servidor.
      await sesion.pagina.enviar(respuesta);
      const texto = await sesion.pagina.texto();
      const filas = await sesion.pagina.filas();
      return leerResultado(sesion.dominio, texto, filas);
    } finally {
      // No reintentar el mismo formulario ni conservar credenciales/cookies.
      await this.descartar(sesion_id);
    }
  }

  async cerrar() {
    await Promise.all([...this.sesiones.keys()].map(id => this.descartar(id)));
  }
}
