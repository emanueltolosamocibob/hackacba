// =============================================================================
// Build de la web.
//
// No define variables de entorno a proposito: este scaffold no habla con
// Supabase todavia. Cuando lo haga, Vite solo expone al navegador lo que
// empieza con VITE_, y el `.env` de la raiz tiene la service_role: no ampliar
// `envPrefix` ni apuntar `envDir` a la raiz sin pensar en eso.
// =============================================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
