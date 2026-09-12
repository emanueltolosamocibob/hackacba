/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Numero de WhatsApp del bot para el enlace final ("+549..."), sin "wa.me/". Opcional. */
  readonly VITE_WHATSAPP_OPERADOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
