// =============================================================================
// CORS de origen exacto para las funciones que llama el navegador (la
// landing). El hook de Auth y cualquier webhook servidor-a-servidor no pasan
// por aca: se autentican con firma o secreto, no con origen de navegador.
//
// Nunca se emite "*". Un origen ausente, malformado o no listado se rechaza
// (la funcion que llama a esto decide el 403); el origen que matchea se
// refleja tal cual, nunca se inventa ni se generaliza.
// =============================================================================

export interface ResultadoCors {
  permitido: boolean;
  /** Siempre incluye Vary: Origin para que un cache intermedio no mezcle respuestas. */
  encabezados: Record<string, string>;
}

function normalizarOrigen(valor: string): string | null {
  try {
    return new URL(valor).origin;
  } catch {
    return null;
  }
}

export function evaluarCors(origen: string | null, permitidos: string[]): ResultadoCors {
  const base: Record<string, string> = { Vary: 'Origin' };

  if (!origen) return { permitido: false, encabezados: base };

  const normalizado = normalizarOrigen(origen);
  if (!normalizado) return { permitido: false, encabezados: base };

  const listaNormalizada = permitidos
    .map(normalizarOrigen)
    .filter((o): o is string => o !== null);

  if (!listaNormalizada.includes(normalizado)) {
    return { permitido: false, encabezados: base };
  }

  return {
    permitido: true,
    encabezados: {
      ...base,
      'Access-Control-Allow-Origin': normalizado,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    },
  };
}
