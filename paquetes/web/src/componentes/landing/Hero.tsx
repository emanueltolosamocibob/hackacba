import { ChatDemo } from './ChatDemo';
import { FormularioTelefono } from './FormularioTelefono';

/** Acto 1: el contrato y el chat real. */
export function Hero() {
  return (
    <section
      className="py-10 md:py-16 border-b-2 border-dgr-forest relative overflow-hidden bg-linear-to-b from-[#f3f9f5] via-[#e9f4ed] to-[#f3f9f5]"
      id="hero"
    >
      {/* Marca de agua central, como el "MOTOVEHICULOS" del 08 */}
      <div
        className="absolute inset-0 flex items-center justify-center opacity-[0.055] pointer-events-none watermark-slant"
        aria-hidden="true"
      >
        <span className="text-7xl sm:text-9xl font-black font-mono border-8 border-dashed border-dgr-forest p-6 tracking-widest text-dgr-forest whitespace-nowrap">
          MOTOVEHICULOS 08
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Columna izquierda: formulario 08 digital */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center space-x-2 border border-dgr-forest bg-emerald-100/90 px-3 py-1 text-xs font-mono text-dgr-green-dark font-bold shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true" />
              <span>GESTOR DE VENCIMIENTOS DEL AUTOMOTOR</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-dgr-green-dark tracking-tight leading-[1.08]">
                Tus flotas al día, <br />
                <span className="text-dgr-forest underline decoration-dgr-mint decoration-4">
                  con FlotaBot
                </span>
              </h1>
              <p className="text-base sm:text-lg text-dgr-border font-normal leading-relaxed pt-2">
                Alertas automáticas por WhatsApp para automotores, utilitarios y flotas comerciales.
                No se te pasa ningún impuesto ni multa, nunca más.
              </p>
            </div>

            {/* Casillero oficial */}
            <div className="border-2 border-dgr-forest bg-white p-4 shadow-xs space-y-3">
              <div className="pt-2">
                <span className="block text-xs font-sans text-dgr-green-dark font-bold uppercase mb-1.5 tracking-wider">
                  TU WHATSAPP
                </span>
                <FormularioTelefono textoBoton="PROBAR" />
              </div>
            </div>

            {/* Metricas tipo sello fiscal */}
            <dl className="grid grid-cols-3 gap-3 font-mono text-center m-0">
              <div className="border-2 border-dgr-forest bg-white p-2.5">
                <dd className="block text-xl font-black text-dgr-green-dark m-0">0%</dd>
                <dt className="text-[11px] text-dgr-forest uppercase font-bold">DEUDAS GENERADAS</dt>
              </div>
              <div className="border-2 border-dgr-forest bg-white p-2.5">
                <dd className="block text-xl font-black text-dgr-green-dark m-0">100%</dd>
                <dt className="text-[11px] text-dgr-forest uppercase font-bold">Oficial CBA</dt>
              </div>
              <div className="border-2 border-dgr-forest bg-white p-2.5">
                <dd className="block text-xl font-black text-dgr-green-dark m-0">DIRECTO</dd>
                <dt className="text-[11px] text-dgr-forest uppercase font-bold">A WhatsApp</dt>
              </div>
            </dl>
          </div>

          {/* Columna derecha: el hilo */}
          <div className="lg:col-span-6">
            <ChatDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
