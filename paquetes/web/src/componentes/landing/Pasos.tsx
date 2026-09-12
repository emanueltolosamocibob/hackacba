interface Paso {
  numero: string;
  sello: string;
  selloClase: string;
  titulo: string;
  texto: string;
  pie: string;
  pieClase: string;
}

const PASOS: Paso[] = [
  {
    numero: '01',
    sello: 'VERIFICADO',
    selloClase: 'border-emerald-700 text-emerald-800 rotate-2',
    titulo: 'Ingresás tus dominios',
    texto:
      'Cargás las patentes de tus autos, utilitarios o camiones. FlotaBot identifica automáticamente los organismos provinciales, municipales y calendarios vigentes.',
    pie: 'RADICACIÓN AUTOMÁTICA',
    pieClase: 'text-emerald-800',
  },
  {
    numero: '02',
    sello: 'AUDITADO 30/7/3',
    selloClase: 'border-blue-700 text-blue-800 -rotate-2',
    titulo: 'Avisos con 30, 7 y 3 días',
    texto:
      'Te llega un WhatsApp programado antes de cada vencimiento de Rentas, Municipalidad, Oblea GNC, RTO o seguro, con el importe exacto para evitar punitorios.',
    pie: 'ALERTA PROGRESIVA OFICIAL',
    pieClase: 'text-blue-800',
  },
  {
    numero: '03',
    sello: 'PAGO ASENTADO',
    selloClase: 'border-red-700 text-red-800 rotate-3',
    titulo: 'Pagás y confirmás en el chat',
    texto:
      'Pedís el link oficial, abonás en la plataforma de Rentas o banco y le respondés "ya pagué" al bot. El legajo queda cancelado y archivado de inmediato.',
    pie: 'REGISTRO EN 1 CLIC',
    pieClase: 'text-red-800',
  },
];

/** Acto 2: el circuito registral en tres pasos. */
export function Pasos() {
  return (
    <section className="py-16 md:py-24 border-b-2 border-dgr-forest bg-white relative" id="protocolo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-mono font-bold text-emerald-800 tracking-widest uppercase bg-emerald-50 border border-emerald-300 px-3 py-1">
            CIRCUITO REGISTRAL EN 3 PASOS
          </span>
          <h2 className="text-3xl sm:text-4xl font-black text-dgr-green-dark mt-3 mb-2">
            ¿Cómo funciona FlotaBot?
          </h2>
          <p className="text-sm sm:text-base text-dgr-border">
            Cero aplicaciones que se cuelgan o paneles complejos. Solo das de alta tu WhatsApp y los
            dominios que querés que el bot gestione.
          </p>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-8 list-none m-0 p-0">
          {PASOS.map((paso) => (
            <li
              key={paso.numero}
              className="border-2 border-dgr-forest bg-dgr-paper p-6 relative rounded-xs shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="w-10 h-10 rounded-sm bg-dgr-green-dark text-white font-mono font-black flex items-center justify-center text-lg">
                    {paso.numero}
                  </span>
                  <span
                    className={`font-stamp text-[10px] font-bold border-2 px-2 py-0.5 tracking-wider uppercase ${paso.selloClase}`}
                  >
                    {paso.sello}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-dgr-green-dark mb-2">{paso.titulo}</h3>
                <p className="text-xs sm:text-sm text-dgr-border leading-relaxed">{paso.texto}</p>
              </div>
              <div
                className={`mt-6 pt-3 border-t border-dashed border-dgr-forest/30 font-mono text-[11px] ${paso.pieClase}`}
              >
                {paso.pie}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
