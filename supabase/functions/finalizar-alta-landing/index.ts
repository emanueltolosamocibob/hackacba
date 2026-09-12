// =============================================================================
// El facade de la landing sobre `finalizar_alta_landing()` (design-2, "SPA
// and Authorization Flow", paso 6). Exige el bearer del usuario, lo reenvia
// tal cual a traves de un cliente con scope de usuario, y jamas usa
// service_role. Existe solo para el CORS de origen exacto y para traducir
// los errores de la base a algo que la SPA pueda mostrar.
//
// La logica vive en `_compartido/alta/finalizador.ts`, probada sin red.
// =============================================================================

import { manejarFinalizarAltaLanding } from '../_compartido/alta/finalizador.ts';
import { ErrorRpc, rpcComoUsuario } from '../_compartido/alta/supabase.ts';

function origenesPermitidos(): string[] {
  return (Deno.env.get('LANDING_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function manejar(peticion: Request): Promise<Response> {
  const resultado = await manejarFinalizarAltaLanding(
    peticion.method,
    peticion.headers.get('origin'),
    peticion.headers.get('authorization'),
    {
      origenesPermitidos: origenesPermitidos(),
      async llamarFinalizador(bearer) {
        try {
          return await rpcComoUsuario('finalizar_alta_landing', bearer, {});
        } catch (error) {
          if (error instanceof ErrorRpc) {
            throw { estadoHttp: error.estado, detalle: error.detalle };
          }
          throw error;
        }
      },
    },
  );

  // Un 204 (preflight CORS) no admite cuerpo: Response lanza si se le pasa uno.
  if (resultado.status === 204) {
    return new Response(null, { status: 204, headers: resultado.encabezadosCors });
  }

  return new Response(JSON.stringify(resultado.cuerpo), {
    status: resultado.status,
    headers: { 'Content-Type': 'application/json', ...resultado.encabezadosCors },
  });
}

if (import.meta.main) {
  Deno.serve(manejar);
}

export { manejar };
