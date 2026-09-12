import { Link } from 'react-router-dom';
import { IconoWhatsApp } from './iconos';

/** Cabecera registral con bordes de imprenta. */
export function Encabezado() {
  return (
    <header className="bg-dgr-paper border-b-2 border-dgr-forest shadow-xs relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <Link className="flex items-center space-x-3" to="/">
          <span className="text-2xl font-black tracking-tight text-dgr-green-dark">
            Flota<span className="text-dgr-mint">Bot</span>
          </span>
        </Link>

        <Link
          className="inline-flex items-center px-4 py-2 border-2 border-dgr-forest bg-dgr-forest hover:bg-dgr-green-dark text-white text-xs font-mono font-bold transition shadow-xs rounded-xs"
          to="/agregar"
        >
          <IconoWhatsApp className="w-4 h-4 mr-1.5 text-emerald-300" />
          CONECTAR WHATSAPP
        </Link>
      </div>
    </header>
  );
}
