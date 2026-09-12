import { FormularioTelefono } from './FormularioTelefono';

/** Acto 5: el cupon de adhesion. */
export function Adhesion() {
  return (
    <section className="py-16 md:py-20 bg-guilloche-official border-b-2 border-dgr-forest" id="adhesion">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="border-double-dgr bg-white p-6 sm:p-10 shadow-2xl relative">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-2 border-dgr-forest pb-4 mb-6 gap-3">
            <h2 className="text-2xl sm:text-3xl font-black text-dgr-green-dark">Probá FlotaBot</h2>
            <span className="mechanical-number text-lg">PRUEBA GRATUITA</span>
          </div>

          <p className="text-sm text-dgr-border mb-6 leading-relaxed">
            Sumá tu utilitario particular o flota de transporte. Empezás en 2 minutos sin tarjeta
            de crédito y sin descargar ninguna aplicación extra: directamente en tu chat de
            WhatsApp.
          </p>

          <div className="bg-[#f2f9f4] border-2 border-dgr-forest p-4 mb-6">
            <FormularioTelefono textoBoton="ACTIVAR FLOTABOT" grande />
            <span className="block text-[11px] font-mono text-dgr-forest mt-2">
              * Recibirás un mensaje de bienvenida con el código de verificación oficial.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
