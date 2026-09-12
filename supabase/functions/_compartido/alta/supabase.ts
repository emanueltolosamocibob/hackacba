// =============================================================================
// Cliente minimo hacia PostgREST/RPC para las funciones de alta.
//
// No se reusa `_compartido/rest.ts`/`entorno.ts`: ese modulo exige, al
// cargarse, los secretos del bot de Telegram (TELEGRAM_BOT_TOKEN,
// TELEGRAM_SECRETO_WEBHOOK). Una funcion de alta no los tiene configurados y
// no deberia depender de ellos para arrancar ni para poder probarse.
//
// Los secretos se leen recien al invocar cada funcion (no al cargar el
// modulo): eso permite importar este archivo en tests sin que haga falta
// simular todo el entorno de una Edge Function.
// =============================================================================

function requerido(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) {
    throw new Error(`Falta el secreto ${nombre}. Definirlo con: supabase secrets set ${nombre}=...`);
  }
  return valor;
}

export class ErrorRpc extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly detalle?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorRpc';
  }
}

/**
 * Cabeceras de autenticacion contra PostgREST.
 *
 * Un JWT (tres partes) viaja como bearer con la apikey publica al lado. Una
 * clave nueva de Supabase (`sb_secret_...`, sin puntos) no es un JWT: si se
 * manda como bearer, PostgREST responde "Expected 3 parts in JWT". El gateway
 * la reconoce como `apikey` y con eso alcanza para actuar como service_role.
 */
function cabecerasDeAutenticacion(token: string): Record<string, string> {
  const esJwt = token.split('.').length === 3;
  return esJwt
    ? { apikey: requerido('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` }
    : { apikey: token };
}

async function invocarRpc<T>(nombre: string, argumentos: Record<string, unknown>, token: string): Promise<T> {
  const respuesta = await fetch(`${requerido('SUPABASE_URL')}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      ...cabecerasDeAutenticacion(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(argumentos),
  });

  const texto = await respuesta.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = texto;
  }

  if (!respuesta.ok) {
    const d = (datos ?? {}) as Record<string, string | undefined>;
    throw new ErrorRpc(
      respuesta.status,
      d.message ?? d.msg ?? `La base respondio ${respuesta.status}.`,
      d.detail ?? d.code,
    );
  }

  return datos as T;
}

/** service_role: solo para las RPC operativas de OTP (reservar/cerrar/mantenimiento). */
export const rpcServicio = <T>(nombre: string, argumentos: Record<string, unknown> = {}) =>
  invocarRpc<T>(nombre, argumentos, requerido('SUPABASE_SERVICE_ROLE_KEY'));

/** El bearer del usuario, reenviado tal cual: nunca service_role para el finalizador. */
export const rpcComoUsuario = <T>(nombre: string, jwt: string, argumentos: Record<string, unknown> = {}) =>
  invocarRpc<T>(nombre, argumentos, jwt);
