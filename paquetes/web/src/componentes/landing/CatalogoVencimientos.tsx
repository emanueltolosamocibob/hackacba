interface Fila {
  nombre: string;
  ambito: string;
  ambitoClase: string;
  detalle: string;
  organismo: string | null;
}

/* Las filas del libro matriz, tal como las escribio el usuario. Los
   organismos son los reales del catalogo de la migracion 0002. */
const FILAS: Fila[] = [
  {
    nombre: 'Impuesto Automotor (Provincial)',
    ambito: 'PROVINCIAL',
    ambitoClase: 'text-emerald-800',
    detalle: 'Emisión anual en 12 cuotas / Pago único con bonificación',
    organismo: 'Rentas Córdoba',
  },
  {
    nombre: 'Tasa Municipal Automotor',
    ambito: 'MUNICIPAL',
    ambitoClase: 'text-sky-800',
    detalle: 'Contribución por rodados según jurisdicción de radicación',
    organismo: 'Municipalidad de Córdoba',
  },
  {
    nombre: 'Revisión Técnica Obligatoria (ITV)',
    ambito: 'PROVINCIAL',
    ambitoClase: 'text-emerald-800',
    detalle: 'Inspección técnica anual / bianual obligatoria para circular',
    organismo: 'Gobierno de Córdoba',
  },
  {
    nombre: 'Multas e Infracciones',
    ambito: 'PROVINCIAL',
    ambitoClase: 'text-rose-800',
    detalle: 'Policía Caminera de Córdoba y juzgados de faltas',
    organismo: 'Rentas Córdoba',
  },
  {
    nombre: 'Seguro del Vehículo',
    ambito: 'PRIVADO',
    ambitoClase: 'text-slate-700',
    detalle: 'Vencimiento de póliza mensual, semestral o anual',
    organismo: null,
  },
];

/** Acto 4: el catalogo de Cordoba como libro matriz. */
export function CatalogoVencimientos() {
  return (
    <section className="py-16 md:py-24 border-b-2 border-dgr-forest bg-guilloche-official relative" id="catalogo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-8">
          <h2 className="text-4xl sm:text-5xl font-black text-dgr-green-dark tracking-tight mb-2">
            Vencimientos
          </h2>
          <p className="text-base sm:text-lg text-dgr-forest font-medium leading-relaxed">
            Catálogo de vencimientos de Córdoba, no se te va a pasar ninguno. Cero intereses
            generados.
          </p>
        </div>

        <div className="border-2 border-dgr-forest bg-white shadow-xl overflow-hidden rounded-xs">
          <div className="bg-dgr-green-dark text-white px-6 py-3.5 border-b-2 border-dgr-forest flex flex-wrap justify-between items-center gap-2 text-xs font-mono font-bold tracking-wider">
            <span className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full" aria-hidden="true" />
              <span>VENCIMIENTOS PARA CÓRDOBA</span>
            </span>
            <span>ORGANISMO RESPONSABLE</span>
          </div>

          <dl className="divide-y divide-dgr-forest/20 font-mono text-xs m-0">
            {FILAS.map((fila) => (
              <div
                key={fila.nombre}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-emerald-50/40 transition gap-2"
              >
                <div>
                  <dt className="font-sans font-bold text-base text-dgr-green-dark">{fila.nombre}</dt>
                  <dd className="text-[11px] text-dgr-forest font-mono mt-0.5 flex flex-wrap items-center gap-x-2 m-0">
                    <span className={`font-bold uppercase ${fila.ambitoClase}`}>{fila.ambito}</span>
                    <span aria-hidden="true">•</span>
                    <span>{fila.detalle}</span>
                  </dd>
                </div>
                <dd
                  className={`sm:text-right text-sm m-0 ${
                    fila.organismo
                      ? 'font-bold text-dgr-green-dark'
                      : 'font-mono text-slate-500 italic'
                  }`}
                >
                  {fila.organismo ?? 'Sin organismo'}
                </dd>
              </div>
            ))}
          </dl>

          <div className="bg-[#f0f9f3] px-6 py-3 border-t-2 border-dgr-forest flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs font-mono text-dgr-green-dark gap-2">
            <div className="flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 bg-emerald-600 rounded-xs" aria-hidden="true" />
              <span>BASE DE DATOS TRIBUTARIA: ACTUALIZADA AL DÍA DE LA FECHA</span>
            </div>
            <span className="mechanical-number text-xs">REG-CBA-AUT-2026</span>
          </div>
        </div>
      </div>
    </section>
  );
}
