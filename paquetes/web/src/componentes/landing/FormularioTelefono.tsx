import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconoFlecha } from './iconos';
import { agruparTelefono, soloDigitos } from '../../utilidades/telefono';

interface Props {
  etiqueta?: string;
  textoBoton: string;
  /** Un punto mas grande y con sombra: el cupon de adhesion. */
  grande?: boolean;
}

/**
 * El campo del home no da de alta: lleva al alta. Si el numero ya esta
 * completo viaja en el estado del router, igual que lo lee `Agregar`; si no,
 * la persona lo termina alla. Nunca en la URL: un telefono en una query
 * string queda en el historial, en los logs y en el referer.
 */
export function FormularioTelefono({ etiqueta, textoBoton, grande = false }: Props) {
  const navegar = useNavigate();
  const [valor, setValor] = useState('');
  const idCampo = useId();

  const digitos = soloDigitos(valor);

  function enviar(e: FormEvent) {
    e.preventDefault();
    navegar('/agregar', digitos.length >= 10 ? { state: { telefono: digitos } } : undefined);
  }

  return (
    <form className="flex flex-col sm:flex-row gap-2" onSubmit={enviar} noValidate>
      {etiqueta && (
        <label
          className="block text-xs font-sans text-dgr-green-dark font-bold uppercase mb-1.5 tracking-wider sm:hidden"
          htmlFor={idCampo}
        >
          {etiqueta}
        </label>
      )}
      <div className="relative grow flex items-stretch bg-[#f8faf9] border-2 border-dgr-forest focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-dgr-green-dark">
        <span
          className="flex items-center pl-4 pr-2 text-dgr-forest font-mono text-base font-bold tracking-wide select-none"
          aria-hidden="true"
        >
          +54
        </span>
        <input
          id={idCampo}
          className="w-full min-w-0 bg-transparent text-dgr-green-dark font-mono text-base pr-4 py-3 rounded-none font-bold tracking-wide placeholder:text-dgr-forest/50 focus:outline-none"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="351 234 5678"
          aria-label="Tu número de WhatsApp, sin el cero y sin el quince"
          value={agruparTelefono(digitos)}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      <button
        className={`${
          grande ? 'px-8 py-3.5 tracking-wider shadow-md' : 'px-7 py-3 tracking-wide'
        } bg-dgr-forest hover:bg-dgr-green-dark text-white font-mono font-bold text-sm flex items-center justify-center space-x-2 border-2 border-dgr-green-dark transition`}
        type="submit"
      >
        <span>{textoBoton}</span>
        <IconoFlecha className="w-4 h-4 text-emerald-300" />
      </button>
    </form>
  );
}
