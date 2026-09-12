/** El ahorro, en una sola cifra. */
export function Ahorro() {
  return (
    <section className="py-12 md:py-16 border-b-2 border-dgr-forest relative bg-guilloche-official">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="border-2 border-dgr-forest bg-white p-6 sm:p-10 shadow-md relative rounded-xs text-center">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-dgr-green-dark tracking-tight leading-tight max-w-3xl mx-auto">
            De{' '}
            <span className="font-stamp text-red-700 underline decoration-red-700 decoration-2">
              40 horas
            </span>{' '}
            de trabajo administrativo, <br className="hidden sm:inline" />a tan sólo{' '}
            <span className="bg-emerald-100 px-2 py-0.5 border border-dgr-forest text-dgr-green-dark inline-block mt-1 sm:mt-0">
              30 minutos
            </span>
            .
          </h2>

          <div className="mt-6 pt-3 border-t border-dashed border-dgr-forest/30 flex flex-wrap items-center justify-center text-[11px] font-mono text-dgr-forest gap-4 sm:gap-8">
            <span className="font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 bg-dgr-forest inline-block" aria-hidden="true" /> FLOTABOT
            </span>
            <span className="hidden sm:inline text-slate-400" aria-hidden="true">
              •
            </span>
            <span className="mechanical-number text-xs font-bold">
              <span className="font-normal">PARA UNA FLOTA DE </span>100{' '}
              <span className="font-normal">VEHÍCULOS</span>
            </span>
            <span className="hidden sm:inline text-slate-400" aria-hidden="true">
              •
            </span>
            <span className="font-bold text-dgr-green-dark bg-emerald-100/90 px-2 py-0.5 border border-dgr-forest/30 rounded-xs">
              -98.7% TIEMPO INVERTIDO
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
