/** Pie de pagina registral. */
export function Pie() {
  return (
    <footer className="bg-dgr-green-dark text-emerald-100/90 text-xs font-mono py-12 border-t-4 border-dgr-forest">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex items-center space-x-3 border-b border-emerald-800/80 pb-6">
          <div className="w-9 h-9 rounded-sm bg-dgr-forest border border-emerald-400/50 flex items-center justify-center text-white font-mono font-bold text-sm">
            08
          </div>
          <div>
            <span className="text-base font-bold text-white tracking-tight">FlotaBot</span>
            <p className="text-[11px] text-emerald-300">
              Gestor de Vencimientos Automotor • Radicación Córdoba
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-emerald-900 text-[10px] text-emerald-400">
          <span>© 2026 FlotaBot. Hecho en Córdoba, República Argentina.</span>
        </div>
      </div>
    </footer>
  );
}
