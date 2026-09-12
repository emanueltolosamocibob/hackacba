import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconoFlecha } from './iconos';
import { agruparTelefono, aE164, soloDigitos } from '../../utilidades/telefono';
import { obtenerSupabase, supabaseEstaConfigurado } from '../../lib/supabase';

/** Lo que `/agregar` lee del estado del router cuando se llega desde el home. */
export interface EstadoDeAlta {
  /** Los diez digitos nacionales, sin +54 ni 9. */
  telefono?: string;
  /** El home ya pidio el codigo: abrir directo en los casilleros. */
  codigoEnviado?: boolean;
  /** El home intento pedirlo y fallo: abrir en el telefono, con el error. */
  errorEnvio?: boolean;
}

interface Props {
  etiqueta?: string;
  textoBoton: string;
  textoEnviando?: string;
  /** Un punto mas grande y con sombra: el cupon de adhesion. */
  grande?: boolean;
  /** Sin borde grueso ni tipografia de imprenta: la version del expediente. */
  variante?: 'formulario08' | 'expediente';
  valorInicial?: string;
  error?: string;
  autoFocus?: boolean;
  /**
   * Si se pasa, el formulario delega el envio (es lo que hace `/agregar`).
   * Si no, pide el codigo aca mismo y navega al alta con el codigo ya en
   * camino: la persona aterriza en los casilleros con el WhatsApp llegando.
   */
  onEnviar?: (digitos: string) => void | Promise<void>;
}

/**
 * El unico campo de telefono de la web. El "9" de movil no lo escribe nadie:
 * el prefijo `+54 9` es fijo y `aE164` lo antepone. El numero nunca viaja en
 * la URL: un telefono en una query string queda en el historial, en los logs
 * y en el referer. Va en el estado del router.
 */
export function FormularioTelefono({
  etiqueta,
  textoBoton,
  textoEnviando = 'Enviando...',
  grande = false,
  variante = 'formulario08',
  valorInicial = '',
  error,
  autoFocus = false,
  onEnviar,
}: Props) {
  const navegar = useNavigate();
  const [valor, setValor] = useState(valorInicial);
  const [enviando, setEnviando] = useState(false);
  const idCampo = useId();
  const idError = useId();

  const digitos = soloDigitos(valor);
  const completo = digitos.length === 10;

  async function pedirCodigoDesdeElHome(digitosNacionales: string) {
    const e164 = aE164(digitosNacionales);
    if (!e164) return;

    setEnviando(true);
    let codigoEnviado = false;
    try {
      if (!supabaseEstaConfigurado()) throw new Error('supabase_no_configurado');
      const { error: errorOtp } = await obtenerSupabase().auth.signInWithOtp({ phone: e164 });
      if (errorOtp) throw errorOtp;
      codigoEnviado = true;
    } catch {
      codigoEnviado = false;
    }

    // Nunca se frena a la persona en el home: si el envio fallo, sigue en el
    // alta con el numero cargado y el error a la vista.
    const estado: EstadoDeAlta = codigoEnviado
      ? { telefono: digitosNacionales, codigoEnviado: true }
      : { telefono: digitosNacionales, errorEnvio: true };
    navegar('/agregar', { state: estado });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!completo || enviando) return;
    if (onEnviar) {
      await onEnviar(digitos);
      return;
    }
    await pedirCodigoDesdeElHome(digitos);
  }

  const expediente = variante === 'expediente';

  const clasesCaja = expediente
    ? 'relative grow flex items-stretch bg-white border-2 border-brand-deep-forest/80 rounded-lg focus-within:ring-2 focus-within:ring-brand-emerald/40 focus-within:border-brand-emerald'
    : 'relative grow flex items-stretch bg-[#f8faf9] border-2 border-dgr-forest focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-dgr-green-dark';

  const clasesPrefijo = expediente
    ? 'flex items-center pl-4 pr-2 text-brand-emerald font-plex text-base font-bold tracking-wide select-none whitespace-nowrap'
    : 'flex items-center pl-4 pr-2 text-dgr-forest font-mono text-base font-bold tracking-wide select-none whitespace-nowrap';

  const clasesEntrada = expediente
    ? 'w-full min-w-0 bg-transparent text-brand-deep-forest font-plex text-lg pr-4 py-3 rounded-none font-bold tracking-wide placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400'
    : 'w-full min-w-0 bg-transparent text-dgr-green-dark font-mono text-base pr-4 py-3 rounded-none font-bold tracking-wide placeholder:text-dgr-forest/50 focus:outline-none disabled:text-dgr-forest/50';

  const clasesBoton = expediente
    ? 'px-6 py-3.5 bg-brand-emerald hover:bg-brand-dark-green text-white font-bold rounded-xl text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed'
    : `${
        grande ? 'px-8 py-3.5 tracking-wider shadow-md' : 'px-7 py-3 tracking-wide'
      } bg-dgr-forest hover:bg-dgr-green-dark text-white font-mono font-bold text-sm flex items-center justify-center space-x-2 border-2 border-dgr-green-dark transition disabled:opacity-60 disabled:cursor-not-allowed`;

  return (
    <form className="flex flex-col gap-2" onSubmit={enviar} noValidate>
      {etiqueta && (
        <label
          className={
            expediente
              ? 'block text-xs font-bold uppercase tracking-wider text-brand-deep-forest'
              : 'block text-xs font-sans text-dgr-green-dark font-bold uppercase mb-1.5 tracking-wider sm:hidden'
          }
          htmlFor={idCampo}
        >
          {etiqueta}
        </label>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className={`${clasesCaja} ${error ? 'border-red-600' : ''}`}>
          <span className={clasesPrefijo} aria-hidden="true">
            +54 9
          </span>
          <input
            id={idCampo}
            className={clasesEntrada}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="351 234 5678"
            aria-label="Tu número de WhatsApp: código de área y número, sin el cero y sin el quince"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? idError : undefined}
            value={agruparTelefono(digitos)}
            disabled={enviando}
            autoFocus={autoFocus}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
        <button className={clasesBoton} type="submit" disabled={!completo || enviando}>
          <span>{enviando ? textoEnviando : textoBoton}</span>
          {!enviando && (
            <IconoFlecha className={expediente ? 'w-4 h-4' : 'w-4 h-4 text-emerald-300'} />
          )}
        </button>
      </div>

      {error && (
        <p
          id={idError}
          className={`text-sm ${expediente ? 'text-red-700' : 'text-dgr-stamp-red font-mono'}`}
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}
