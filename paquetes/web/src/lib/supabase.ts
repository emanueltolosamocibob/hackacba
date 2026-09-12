/**
 * Cliente de Supabase para el navegador: siempre con el JWT del usuario, nunca
 * con service_role (ver CLAUDE.md, trampa 7). El alta por OTP y el facade
 * `finalizar-alta-landing` son las unicas llamadas de negocio que hace la web.
 *
 * La construccion es perezosa: si faltan las variables de entorno, la pagina
 * igual renderiza y el error aparece recien cuando alguien intenta enviar el
 * formulario, no al cargar la app.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@flota/compartido';

let cliente: SupabaseClient<Database> | null = null;

/** Si false, cualquier llamada a `obtenerSupabase()` va a tirar. */
export function supabaseEstaConfigurado(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function obtenerSupabase(): SupabaseClient<Database> {
  if (!cliente) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiar paquetes/web/env.example a .env.local.',
      );
    }
    cliente = createClient<Database>(url, anonKey);
  }
  return cliente;
}
