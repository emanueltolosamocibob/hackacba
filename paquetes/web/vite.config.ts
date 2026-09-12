// =============================================================================
// Build de la web.
//
// No define variables de entorno a proposito: este scaffold no habla con
// Supabase todavia. Cuando lo haga, Vite solo expone al navegador lo que
// empieza con VITE_, y el `.env` de la raiz tiene la service_role: no ampliar
// `envPrefix` ni apuntar `envDir` a la raiz sin pensar en eso.
//
// Tailwind entra por su plugin de Vite (v4): no hay tailwind.config, el tema
// vive en `src/componentes/landing/landing.css` bajo `@theme`.
// =============================================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
