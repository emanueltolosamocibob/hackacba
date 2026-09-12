/**
 * Traduce el contrato de errores de `finalizar-alta-landing` (ver
 * `supabase/functions/_compartido/alta/finalizador.ts` en la branch
 * `feat/alta-otp-edge`) a un mensaje que se pueda mostrar. Ninguno de estos
 * mensajes revela si el numero existe o no: eso ya quedo resuelto antes,
 * cuando se pidio el codigo.
 */
const MENSAJES: Record<string, string> = {
  identidad_en_uso: 'Ese numero ya tiene una organizacion. Segui por WhatsApp con el bot.',
  telefono_no_verificado: 'Todavia no verificamos tu numero. Pedi el codigo de nuevo.',
  telefono_argentino_invalido: 'Ese numero no tiene formato argentino valido.',
  invitacion_no_disponible: 'La invitacion ya no esta disponible. Pedile una nueva a quien te invito.',
  origen_no_permitido: 'No pudimos completar el alta. Proba de nuevo en unos minutos.',
  sesion_invalida: 'Tu sesion vencio. Volve a pedir el codigo.',
};

const GENERICO = 'No pudimos completar el alta. Proba de nuevo en unos minutos.';

export function mensajeDeErrorAlta(codigo: string | undefined): string {
  if (!codigo) return GENERICO;
  return MENSAJES[codigo] ?? GENERICO;
}

/** Codigos que ameritan volver a pedir el codigo en vez de solo reintentar. */
export function requierePedirCodigoDeNuevo(codigo: string | undefined): boolean {
  return codigo === 'telefono_no_verificado' || codigo === 'sesion_invalida';
}

/**
 * `supabase.functions.invoke` no tira el cuerpo JSON del error, lo deja en
 * `error.context` (la Response cruda). Lo leemos aca, sin asumir mas forma
 * que la del contrato de `finalizar-alta-landing`.
 */
export async function codigoDeErrorFuncion(error: unknown): Promise<string | undefined> {
  const conContexto = error as { context?: Response };
  if (!conContexto?.context || typeof conContexto.context.json !== 'function') return undefined;
  try {
    const cuerpo = (await conContexto.context.json()) as { error?: string };
    return cuerpo.error;
  } catch {
    return undefined;
  }
}
