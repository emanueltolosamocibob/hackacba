import { type ReactNode } from 'react';

/* =============================================================================
   Acto 3: lo que hoy son diez pestañas abiertas. La maqueta del navegador es
   decorativa: los sitios son reales, la sesion no.
   ============================================================================= */

interface Pestania {
  nombre: string;
  icono: ReactNode;
  visible?: string;
}

const PESTANIAS: Pestania[] = [
  {
    nombre: 'Muni Cba - Rodados',
    icono: (
      <svg className="w-3.5 h-3.5 text-sky-400 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
  },
  {
    nombre: 'ITV Cba - Turnos ITV',
    icono: (
      <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
        />
      </svg>
    ),
  },
  {
    nombre: 'Caminera - Multas Cba',
    icono: (
      <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        />
      </svg>
    ),
  },
  {
    nombre: 'ENARGAS - Oblea GNC',
    visible: 'hidden sm:flex',
    icono: (
      <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z"
        />
      </svg>
    ),
  },
  {
    nombre: 'Portal CiDi - Nivel 2',
    visible: 'hidden md:flex',
    icono: (
      <svg className="w-3.5 h-3.5 text-blue-300 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z"
        />
      </svg>
    ),
  },
];

interface Casillero {
  letra: string;
  letraClase: string;
  titulo: string;
  tituloClase: string;
  texto: string;
  pieEtiqueta: string;
  pieValor: string;
  pieClase: string;
}

const CASILLEROS: Casillero[] = [
  {
    letra: 'A',
    letraClase: 'bg-dgr-green-dark',
    titulo: 'Sincronización DGR - Rentas',
    tituloClase: 'text-dgr-green-dark',
    texto:
      'Cruza al instante el calendario fiscal de Rentas con la fecha límite para evitar recargos.',
    pieEtiqueta: 'CALENDARIO:',
    pieValor: 'OFICIAL 2026',
    pieClase: 'text-emerald-800',
  },
  {
    letra: 'B',
    letraClase: 'bg-dgr-green-dark',
    titulo: 'Dominio y Chasis',
    tituloClase: 'text-dgr-green-dark',
    texto:
      'Soporta formato Mercosur y tradicional. Monitoreo de obleas mecánicas e inspección técnica.',
    pieEtiqueta: 'VALIDACIÓN:',
    pieValor: 'DNRPA / ENARGAS',
    pieClase: 'text-emerald-800',
  },
  {
    letra: 'C',
    letraClase: 'bg-dgr-stamp-red',
    titulo: 'Infracciones y Multas',
    tituloClase: 'text-dgr-stamp-red',
    texto:
      'Control de multas de Caminera y juzgados de faltas para circular sin retenciones.',
    pieEtiqueta: 'POLICÍA CAMINERA:',
    pieValor: 'VERIFICADA',
    pieClase: 'text-red-700',
  },
];

export function Desglose() {
  return (
    <section className="py-16 md:py-24 border-b-2 border-dgr-forest bg-white relative" id="desglose">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="border-b-2 border-dgr-forest pb-4 mb-10">
          <h2 className="text-3xl sm:text-4xl font-black text-dgr-green-dark tracking-tight">
            Centralizá todos los pagos - No más 10 pestañas abiertas
          </h2>
        </div>

        {/* Maqueta del navegador con las pestañas de siempre */}
        <div
          className="mb-10 rounded-sm border-2 border-dgr-forest bg-[#172535] shadow-xl overflow-hidden font-sans text-xs"
          aria-hidden="true"
        >
          <div className="bg-[#0c1813] px-3 pt-2.5 pb-0 border-b border-slate-700/80 flex items-center justify-between gap-2 select-none">
            <div className="flex items-center gap-1.5 pb-2 pr-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444] inline-block border border-red-700/50" />
              <span className="w-3 h-3 rounded-full bg-[#f59e0b] inline-block border border-amber-700/50" />
              <span className="w-3 h-3 rounded-full bg-[#10b981] inline-block border border-emerald-700/50" />
            </div>
            <div className="grow flex items-end gap-1 overflow-x-auto scrollbar-none pt-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1f3144] border-t-2 border-emerald-400 text-white rounded-t-sm font-mono text-[11px] max-w-[190px] shrink-0 shadow-sm">
                <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm0-4h1V5h-1v2z"
                  />
                </svg>
                <span className="truncate">Rentas Cba - Automotor</span>
                <span className="text-slate-400 ml-auto font-sans text-xs">×</span>
              </div>
              {PESTANIAS.map((p) => (
                <div
                  key={p.nombre}
                  className={`${p.visible ?? 'flex'} items-center gap-1.5 px-2.5 py-1.5 bg-[#132230] text-slate-300 rounded-t-sm font-mono text-[11px] max-w-[165px] shrink-0 border-t border-slate-700`}
                >
                  {p.icono}
                  <span className="truncate">{p.nombre}</span>
                  <span className="text-slate-500 ml-auto font-sans text-xs">×</span>
                </div>
              ))}
              <div className="flex items-center px-2 py-1.5 bg-red-950/70 border border-red-700/60 rounded-sm text-rose-300 font-mono text-[10px] font-bold shrink-0">
                <span className="mr-1">+4</span> más...
              </div>
            </div>
          </div>
          <div className="bg-[#1f3144] px-3 py-2 border-b border-slate-700 flex items-center gap-3">
            <div className="flex items-center gap-2 text-slate-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <div className="grow bg-[#0c1813] border border-slate-700/80 rounded-sm px-3 py-1 flex items-center justify-between text-slate-300 font-mono text-[11px]">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-emerald-400">🔒</span>
                <span className="text-emerald-300 font-bold">https://</span>
                <span className="text-white">rentascordoba.gob.ar</span>
                <span className="text-slate-400">/automotor/consulta-deuda?cuit=30-71429810-5&amp;dominio=AE412KT</span>
              </div>
            </div>
          </div>
        </div>

        {/* Casilleros A, B, C */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {CASILLEROS.map((c) => (
            <div
              key={c.letra}
              className="border-2 border-dgr-forest bg-dgr-paper p-5 relative flex flex-col justify-between shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-dgr-forest/30 pb-2 mb-3">
                <span
                  className={`w-8 h-8 rounded-sm text-white font-mono font-black flex items-center justify-center text-sm ${c.letraClase}`}
                >
                  "{c.letra}"
                </span>
              </div>
              <div>
                <h3 className={`font-bold text-lg mb-1 ${c.tituloClase}`}>{c.titulo}</h3>
                <p className="text-xs text-dgr-border leading-relaxed">{c.texto}</p>
              </div>
              <div
                className={`mt-4 pt-2 border-t border-dashed border-dgr-forest/40 font-mono text-[11px] flex justify-between ${c.pieClase}`}
              >
                <span>{c.pieEtiqueta}</span>
                <span className="font-bold">{c.pieValor}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Directo al pago */}
        <div className="border-2 border-dgr-forest bg-linear-to-r from-[#f0f9f3] via-white to-[#f0f9f3] p-6 sm:p-8 rounded-xs shadow-md relative overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-7 space-y-3">
              <span className="text-xs font-mono font-bold text-emerald-900 bg-emerald-100 border border-emerald-300 px-2 py-0.5 uppercase">
                NO DES MÁS VUELTAS
              </span>
              <h3 className="text-2xl font-black text-dgr-green-dark">
                FlotaBot te lleva directamente al pago
              </h3>
              <p className="text-sm text-dgr-border leading-relaxed">
                Simplemente preguntale por el estado de tu flota de vehículos. Si tenes algun
                pago/cuota vencidos para un dominio, FlotaBot te deja el link de pago directamente
                en el chat: no navegás por los portales.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
