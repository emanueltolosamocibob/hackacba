// =============================================================================
// De un chat de Telegram a un JWT de usuario.
//
// El camino es el (b) de BOT.md: emitir la sesion en el momento con dos
// llamadas de admin, sin guardar nada. Se eligio sobre guardar el refresh token
// porque no agrega una credencial de larga duracion en la base ni un ALTER
// TABLE, y porque los refresh token rotan: hay que guardar el nuevo en cada
// uso o la proxima llamada falla, y ese es justo el detalle que se olvida.
//
//   POST /auth/v1/admin/generate_link  { type: magiclink, email } -> hashed_token
//   POST /auth/v1/verify               { type: magiclink, token } -> sesion
//
// El precio son dos viajes por interaccion, y por eso el token se cachea en
// memoria. El cache es del isolate: si se recicla, se vuelve a emitir. No es un
// problema de correccion, solo de latencia; si empieza a molestar, el camino es
// pasar al refresh token guardado.
// =============================================================================

import { DOMINIO_CUENTAS } from './entorno.ts';
import { comoUsuario, servicio, type Cliente } from './rest.ts';

export interface OrganizacionDelUsuario {
  id: string;
  nombre: string;
  rol: string;
}

export interface Contexto {
  vinculado: boolean;
  usuario_id?: string;
  chat_id?: number;
  organizacion_activa?: OrganizacionDelUsuario | null;
  organizaciones?: OrganizacionDelUsuario[];
}

export interface Sesion {
  usuarioId: string;
  organizacion: OrganizacionDelUsuario;
  organizaciones: OrganizacionDelUsuario[];
  cliente: Cliente;
}

/** Quien es este chat. Es lo primero que se consulta en cada mensaje. */
export function contextoDe(telegramUserId: number): Promise<Contexto> {
  return servicio.rpc<Contexto>('contexto_telegram', { p_telegram_user_id: telegramUserId });
}

// ------------------------------------------------------------------ el JWT

interface TokenCacheado {
  jwt: string;
  vence: number;
}

const cache = new Map<string, TokenCacheado>();

/** El JWT dura una hora; se renueva diez minutos antes para no cortar al filo. */
const MARGEN_MS = 10 * 60 * 1000;

async function emitirJwt(usuarioId: string): Promise<string> {
  const usuario = await servicio.auth<{ email?: string }>(`/admin/users/${usuarioId}`);
  if (!usuario.email) {
    throw new Error(`El usuario ${usuarioId} no tiene email: no se le puede emitir sesion.`);
  }

  const enlace = await servicio.auth<{ hashed_token?: string; properties?: { hashed_token?: string } }>(
    '/admin/generate_link',
    { metodo: 'POST', cuerpo: { type: 'magiclink', email: usuario.email } },
  );

  const token = enlace.hashed_token ?? enlace.properties?.hashed_token;
  if (!token) throw new Error('generate_link no devolvio hashed_token.');

  const sesion = await servicio.auth<{ access_token?: string }>('/verify', {
    metodo: 'POST',
    cuerpo: { type: 'magiclink', token },
  });

  if (!sesion.access_token) throw new Error('verify no devolvio access_token.');
  return sesion.access_token;
}

export async function jwtDeUsuario(usuarioId: string): Promise<string> {
  const guardado = cache.get(usuarioId);
  if (guardado && guardado.vence > Date.now()) return guardado.jwt;

  const jwt = await emitirJwt(usuarioId);
  cache.set(usuarioId, { jwt, vence: Date.now() + 60 * 60 * 1000 - MARGEN_MS });
  return jwt;
}

/**
 * La sesion completa de un chat, o null si todavia no se vinculo.
 *
 * Devolver null en vez de tirar excepcion es a proposito: "no estas vinculado"
 * no es un error, es el estado normal de alguien que abre el bot por primera
 * vez, y lo que corresponde es invitarlo a compartir su numero.
 */
export async function sesionDeChat(telegramUserId: number): Promise<Sesion | null> {
  const contexto = await contextoDe(telegramUserId);
  if (!contexto.vinculado || !contexto.usuario_id) return null;

  const organizacion = contexto.organizacion_activa ?? contexto.organizaciones?.[0];
  if (!organizacion) return null;

  const jwt = await jwtDeUsuario(contexto.usuario_id);

  return {
    usuarioId: contexto.usuario_id,
    organizacion,
    organizaciones: contexto.organizaciones ?? [organizacion],
    cliente: comoUsuario(jwt),
  };
}

// ------------------------------------------------------- la cuenta de auth

interface UsuarioAuth {
  id: string;
  email?: string;
}

/**
 * El email de la cuenta que el bot crea.
 *
 * Se deriva del id de Telegram, que es estable y unico, asi que la funcion es
 * idempotente: volver a vincular el mismo Telegram encuentra la misma cuenta en
 * vez de crear una segunda. Nadie manda mail a esta direccion.
 */
const emailDe = (telegramUserId: number) => `tg-${telegramUserId}@${DOMINIO_CUENTAS}`;

async function buscarPorEmail(email: string): Promise<UsuarioAuth | null> {
  const pagina = await servicio.auth<{ users?: UsuarioAuth[] }>(
    `/admin/users?filter=${encodeURIComponent(email)}&per_page=20`,
  );
  return pagina.users?.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/**
 * Devuelve el usuario de auth de este Telegram, creandolo si hace falta.
 *
 * El telefono se guarda en los metadatos y no como identidad de auth: la
 * identidad que importa vive en vinculos_telegram.telefono, que la escribe
 * canjear_por_telefono con el numero que Telegram verifico. Duplicarla en auth
 * solo agregaria una segunda fuente de verdad que se puede desincronizar.
 */
export async function asegurarCuenta(
  telegramUserId: number,
  datos: { nombre?: string; telefono?: string } = {},
): Promise<string> {
  const email = emailDe(telegramUserId);

  try {
    const creado = await servicio.auth<UsuarioAuth>('/admin/users', {
      metodo: 'POST',
      cuerpo: {
        email,
        email_confirm: true,
        user_metadata: {
          telegram_user_id: telegramUserId,
          nombre: datos.nombre ?? null,
          telefono: datos.telefono ?? null,
        },
      },
    });
    return creado.id;
  } catch (error) {
    // Ya existia: es el caso normal de quien se vuelve a vincular despues de
    // un /salir. Cualquier otro fallo si es un fallo.
    const existente = await buscarPorEmail(email);
    if (existente) return existente.id;
    throw error;
  }
}
