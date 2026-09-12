// =============================================================================
// La capa que habla con Supabase: PostgREST y la API de Auth.
//
// Dos clientes y la diferencia entre ellos es la regla mas importante del bot
// (BOT.md, seccion 3):
//
//   servicio      -> service_role. Saltea RLS. SOLO para tareas de sistema:
//                    leer vinculos_telegram, el alta, despachar avisos.
//   comoUsuario() -> el JWT de la persona. TODO dato de negocio pasa por aca.
//                    Aunque el agente alucine un flota_id ajeno, RLS devuelve
//                    vacio en vez de datos de otra organizacion.
//
// Si alguna vez una consulta de negocio termina en `servicio`, el aislamiento
// entre organizaciones deja de estar garantizado por la base y pasa a depender
// de que el codigo del bot no tenga bugs. No es un intercambio que convenga.
// =============================================================================

import { CLAVE_ANON, CLAVE_SERVICIO, URL_SUPABASE } from './entorno.ts';

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  prefer?: string;
}

/**
 * Traduce el error a algo que se pueda leer en un chat.
 *
 * Los `raise exception` de las migraciones ya estan escritos en castellano y
 * pensados para que los lea una persona, asi que esos pasan tal cual. Los
 * codigos genericos de Postgres, no: "duplicate key value violates unique
 * constraint" no le dice nada a quien administra una flota.
 */
function mensajeLegible(estado: number, cuerpo: unknown): { texto: string; codigo?: string } {
  const d = (cuerpo ?? {}) as Record<string, string | undefined>;
  const codigo = d.code;
  const crudo = d.message ?? d.msg ?? d.error_description ?? d.error ?? '';

  switch (codigo) {
    case '42501':
      return { texto: 'No tenes permiso para hacer eso en esta organizacion.', codigo };
    case '23505':
      return { texto: 'Eso ya existe: la base no admite duplicados ahi.', codigo };
    case '23503':
      return { texto: 'Falta un dato relacionado: revisar el vehiculo, la flota o el tipo.', codigo };
    case '23514':
      return { texto: `Un valor no pasa las validaciones de la base. ${crudo}`.trim(), codigo };
    case '22P02':
      return { texto: 'Alguno de los datos tiene un formato que la base no entiende.', codigo };
  }

  if (crudo) return { texto: crudo, codigo };
  if (estado === 401 || estado === 403) {
    return { texto: 'La sesion no alcanza para esa operacion.', codigo };
  }
  return { texto: `La base respondio ${estado}.`, codigo };
}

function crearCliente(apikey: string, token: string) {
  async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
    const { metodo = 'GET', cuerpo, prefer } = opciones;

    const cabeceras: Record<string, string> = {
      apikey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (prefer) cabeceras.Prefer = prefer;

    const respuesta = await fetch(`${URL_SUPABASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

    const texto = await respuesta.text();
    let datos: unknown = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }

    if (!respuesta.ok) {
      const { texto: mensaje, codigo } = mensajeLegible(respuesta.status, datos);
      throw new ErrorApi(respuesta.status, mensaje, codigo);
    }

    return datos as T;
  }

  return {
    pedir,
    /** Tablas y vistas: `/vehiculos?dominio=eq.ABC123`. */
    rest: <T>(ruta: string, opciones?: Opciones) => pedir<T>(`/rest/v1${ruta}`, opciones),
    /** Funciones: `rpc('resumen_flota', { p_flota_id })`. */
    rpc: <T>(nombre: string, argumentos: Record<string, unknown> = {}) =>
      pedir<T>(`/rest/v1/rpc/${nombre}`, { metodo: 'POST', cuerpo: argumentos }),
    /** API de Auth: `/auth/v1/...`. */
    auth: <T>(ruta: string, opciones?: Opciones) => pedir<T>(`/auth/v1${ruta}`, opciones),
  };
}

export type Cliente = ReturnType<typeof crearCliente>;

/** service_role. Solo tareas de sistema. */
export const servicio = crearCliente(CLAVE_SERVICIO, CLAVE_SERVICIO);

/** El cliente con el que se consultan datos de negocio, y el unico. */
export const comoUsuario = (jwt: string): Cliente => crearCliente(CLAVE_ANON, jwt);
