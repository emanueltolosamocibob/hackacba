// =============================================================================
// Secretos y configuracion.
//
// Se leen al cargar el modulo y se rompe fuerte si falta alguno: una Edge
// Function que arranca a medias y falla recien en el tercer mensaje es mucho
// peor de diagnosticar que una que no arranca.
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta
// Supabase sola. Las demas van con:
//   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRETO_WEBHOOK=... ANTHROPIC_API_KEY=...
// =============================================================================

function requerido(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) {
    throw new Error(
      `Falta el secreto ${nombre}. Definirlo con: supabase secrets set ${nombre}=...`,
    );
  }
  return valor;
}

export const URL_SUPABASE = requerido('SUPABASE_URL');
export const CLAVE_ANON = requerido('SUPABASE_ANON_KEY');
export const CLAVE_SERVICIO = requerido('SUPABASE_SERVICE_ROLE_KEY');

export const TOKEN_BOT = requerido('TELEGRAM_BOT_TOKEN');

/**
 * Lo que Telegram manda en la cabecera X-Telegram-Bot-Api-Secret-Token. Es lo
 * unico que distingue un update real de cualquiera que descubra la URL de la
 * funcion, que es publica.
 */
export const SECRETO_WEBHOOK = requerido('TELEGRAM_SECRETO_WEBHOOK');

/**
 * BOT.md elige Sonnet: para envolver siete RPC alcanza, y es mas barato y
 * rapido que Opus. Se puede cambiar sin tocar codigo.
 */
export const MODELO = Deno.env.get('MODELO_CLAUDE') ?? 'claude-sonnet-5';

/**
 * Dominio de las cuentas de auth que crea el bot. Nadie manda mail ahi: la
 * cuenta existe para tener un usuario contra el cual firmar un JWT, y la
 * identidad real es el telefono que verifico Telegram. Un dominio no ruteable
 * es lo correcto justamente porque no tiene que recibir nada.
 */
export const DOMINIO_CUENTAS = Deno.env.get('DOMINIO_CUENTAS') ?? 'telegram.local';

/** Cuantas vueltas de tool calling antes de cortar. Ver BOT.md, seccion 6. */
export const MAX_TURNOS = Number(Deno.env.get('MAX_TURNOS_AGENTE') ?? '6');
