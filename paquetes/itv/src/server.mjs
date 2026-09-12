import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ConsultasITV, ErrorConsulta } from './consultas.mjs';

function autorizado(header, clave) {
  const recibido = Buffer.from(header ?? '');
  const esperado = Buffer.from(`Bearer ${clave}`);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

async function leerJSON(req) {
  let cuerpo = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new ErrorConsulta('solicitud_grande', 'Solicitud demasiado grande.', 413);
    cuerpo += chunk;
  }
  try {
    const valor = JSON.parse(cuerpo);
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error();
    return valor;
  } catch {
    throw new ErrorConsulta('json_invalido', 'Se esperaba un objeto JSON.');
  }
}

export function crearServidor(consultas, clave) {
  if (typeof clave !== 'string' || clave.length < 32) throw new Error('ITV_API_KEY debe contener al menos 32 caracteres.');
  return createServer(async (req, res) => {
    const responder = (status, datos) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(datos));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return responder(200, { estado: 'ok' });
      if (!autorizado(req.headers.authorization, clave)) {
        return responder(401, { estado_consulta: 'error', codigo: 'no_autorizado', mensaje: 'Acceso no autorizado.' });
      }
      if (req.method !== 'POST') return responder(405, { codigo: 'metodo_no_permitido' });
      if (!['/itv/iniciar', '/itv/completar'].includes(req.url)) return responder(404, { codigo: 'ruta_no_encontrada' });
      const cuerpo = await leerJSON(req);
      const datos = req.url === '/itv/iniciar' ? await consultas.iniciar(cuerpo) : await consultas.completar(cuerpo);
      responder(200, datos);
    } catch (error) {
      const conocido = error instanceof ErrorConsulta;
      responder(conocido ? error.status : 502, { estado_consulta: 'error',
        codigo: conocido ? error.codigo : 'sitio_no_disponible',
        mensaje: conocido ? error.message : 'No se pudo completar la consulta de ITV.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clave = process.env.ITV_API_KEY;
  if (!clave || clave.length < 32) throw new Error('Configurá ITV_API_KEY con al menos 32 caracteres.');
  const maxSesiones = Number(process.env.ITV_MAX_SESIONES ?? 4);
  if (!Number.isInteger(maxSesiones) || maxSesiones < 1 || maxSesiones > 20) {
    throw new Error('ITV_MAX_SESIONES debe ser un entero entre 1 y 20.');
  }
  const { crearNavegador } = await import('./navegador.mjs');
  const navegador = await crearNavegador();
  const consultas = new ConsultasITV(dominio => navegador.abrir(dominio), { maxSesiones });
  const servidor = crearServidor(consultas, clave);
  servidor.requestTimeout = 35_000;
  const limpieza = setInterval(() => consultas.limpiar().catch(() => {}), 15_000);
  limpieza.unref();
  servidor.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => {
    console.log('Servicio ITV iniciado.');
  });
  const cerrar = async () => {
    clearInterval(limpieza);
    servidor.close();
    await consultas.cerrar();
    await navegador.cerrar();
  };
  process.once('SIGTERM', cerrar);
  process.once('SIGINT', cerrar);
}
