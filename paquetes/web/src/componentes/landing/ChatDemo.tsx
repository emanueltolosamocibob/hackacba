import { type ReactNode } from 'react';
import { IconoAlerta, IconoTilde, IconoVerificado } from './iconos';

/* =============================================================================
   Maqueta del hilo de WhatsApp. Es una representacion, no un cliente: los
   links que muestra el bot se ven como lo que el bot manda, pero no navegan.
   Los dominios y los importes son inventados.
   ============================================================================= */

function Dominio({ children }: { children: ReactNode }) {
  return (
    <strong className="text-white bg-wa-hondo px-1.5 py-0.5 rounded border border-wa-borde font-mono text-[11px]">
      {children}
    </strong>
  );
}

function Fecha({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center my-2">
      <span className="bg-wa-fecha text-wa-gris text-[11px] font-medium px-3 py-1 rounded-md uppercase tracking-wide shadow-xs select-none">
        {children}
      </span>
    </div>
  );
}

function Saliente({ hora, children }: { hora: string; children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-2xl rounded-tr-xs bg-wa-saliente text-wa-texto px-3.5 py-2 shadow-xs relative">
        <p>{children}</p>
        <div className="flex items-center justify-end space-x-1 text-[11px] text-wa-gris/90 mt-0.5 select-none">
          <span>{hora}</span>
          <IconoTilde className="w-4 h-4 text-wa-celeste" />
        </div>
      </div>
    </div>
  );
}

function Entrante({
  hora,
  ancho = 'max-w-[88%]',
  children,
}: {
  hora: string;
  ancho?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-start">
      <div className={`${ancho} rounded-2xl rounded-tl-xs bg-wa-panel text-wa-texto px-3.5 py-2.5 shadow-xs space-y-2`}>
        {children}
        <div className="flex justify-end text-[11px] text-wa-gris select-none">
          <span>{hora}</span>
        </div>
      </div>
    </div>
  );
}

function TarjetaLink({
  organismo,
  etiqueta,
  vencida = false,
  url,
}: {
  organismo: string;
  etiqueta: string;
  vencida?: boolean;
  url: string;
}) {
  return (
    <div className="p-2.5 bg-wa-hondo rounded-lg border border-[#222e35]">
      <div className="flex justify-between items-center mb-1 gap-2">
        <span className="font-medium text-white text-xs">{organismo}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${
            vencida
              ? 'bg-[#39181d] text-wa-vencido border-[#522126]'
              : 'bg-wa-panel text-wa-gris-claro border-wa-borde'
          }`}
        >
          {etiqueta}
        </span>
      </div>
      <span className="text-xs text-wa-celeste break-all block">{url}</span>
    </div>
  );
}

export function ChatDemo() {
  return (
    <div className="max-w-md mx-auto lg:max-w-none rounded-[28px] overflow-hidden shadow-2xl border border-wa-borde bg-wa-fondo text-wa-texto font-sans flex flex-col">
      {/* Barra superior */}
      <div className="bg-wa-barra px-3.5 py-2.5 flex items-center justify-between border-b border-wa-borde-suave select-none z-10 shrink-0">
        <div className="flex items-center space-x-2.5">
          <svg
            className="w-5 h-5 text-wa-gris-claro"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 19l-7-7 7-7" />
          </svg>
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-wa-verde flex items-center justify-center font-bold text-white text-xs shadow-sm">
              FB
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-wa-verde border-2 border-wa-barra rounded-full" />
          </div>
          <div className="leading-tight">
            <h3 className="font-medium text-wa-texto text-[15px] flex items-center gap-1.5">
              <span>FlotaBot Córdoba</span>
              <IconoVerificado className="w-4 h-4 text-wa-verde shrink-0" />
            </h3>
            <p className="text-[11px] text-wa-gris">en línea • cuenta de empresa oficial</p>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-wa-gris-claro">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
          <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.44-5.15-3.75-6.59-6.59l1.97-1.57c.28-.28.37-.68.25-1.02A11.36 11.36 0 018.96 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.99c0-.55-.45-1-.99-1.01z" />
          </svg>
          <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </div>
      </div>

      {/* Mensajes */}
      <div className="wa-tapiz p-3 sm:p-4 space-y-3 max-h-[580px] overflow-y-auto font-sans text-[13.5px] leading-relaxed relative">
        <Fecha>Ayer</Fecha>

        <Saliente hora="8:01">pasame todos los vehiculos de mi flota con deuda</Saliente>

        <Entrante hora="8:02">
          <p className="font-medium text-wa-texto">Tenés 3 vehículos con obligaciones pendientes:</p>
          <ul className="space-y-1.5 text-xs text-wa-texto-2 list-none m-0 p-0">
            <li className="flex items-start gap-1.5">
              <span aria-hidden="true">•</span>
              <div>
                <Dominio>AE 412 KT</Dominio> — Rentas Córdoba{' '}
                <span className="text-wa-ok">(Vence en 30 días, $ 48.350,20)</span>
              </div>
            </li>
            <li className="flex items-start gap-1.5">
              <span aria-hidden="true">•</span>
              <div>
                <Dominio>AD 889 RJ</Dominio> — Oblea GNC ENARGAS{' '}
                <span className="text-wa-alerta">(Vence en 7 días)</span>
              </div>
            </li>
            <li className="flex items-start gap-1.5">
              <span aria-hidden="true">•</span>
              <div>
                <Dominio>AC 204 LM</Dominio> — RTO/VTV Gob. Córdoba{' '}
                <span className="text-wa-vencido">(Vence en 3 días)</span>
              </div>
            </li>
          </ul>
          <p className="pt-1 font-medium text-xs text-wa-texto">¿Querés que te genere los links de pago?</p>
        </Entrante>

        <Saliente hora="8:05">ok, generame los link de pago de todos</Saliente>

        <Entrante hora="8:05" ancho="max-w-[90%]">
          <p className="text-xs text-wa-gris font-medium">Generados 3 accesos oficiales inmediatos:</p>
          <div className="space-y-2">
            <TarjetaLink
              organismo="Rentas Córdoba (Imp. Automotor)"
              etiqueta="AE 412 KT"
              url="rentascordoba.gob.ar/pagos/liq-ae412kt-c09"
            />
            <TarjetaLink
              organismo="Municipalidad de Cba (Tasa Rodados)"
              etiqueta="AE 412 KT"
              url="tributos.cordoba.gob.ar/automotor/deuda?d=AE412KT"
            />
            <TarjetaLink
              organismo="Policía Caminera (Infracción de tránsito)"
              etiqueta="ACTA #391048"
              vencida
              url="policia-caminera.cba.gov.ar/multas/pago/391048"
            />
          </div>
        </Entrante>

        <Saliente hora="9:41">listo, ya la pagué</Saliente>

        <Entrante hora="9:41">
          <p>
            Anotado. Impuesto Automotor de <Dominio>AE 412 KT</Dominio>, cuota 09 de 12, queda
            asentado como cancelado.
          </p>
          <div className="border-t border-wa-borde pt-2 flex justify-between items-center font-mono text-xs">
            <span className="text-[10px] uppercase text-wa-gris tracking-wider">REGISTRADO</span>
            <span className="font-bold text-wa-ok text-sm">$ 48.350,20</span>
          </div>
        </Entrante>

        <Fecha>Hoy</Fecha>

        <Entrante hora="8:00">
          <div className="font-medium text-wa-alerta text-sm flex items-center gap-1.5">
            <IconoAlerta className="w-4 h-4 shrink-0" />
            <span>Faltan 3 días</span>
          </div>
          <p className="text-xs text-wa-texto-2">
            Revisión Técnica Obligatoria del dominio <Dominio>AC 204 LM</Dominio>.
          </p>
          <div className="border-t border-wa-borde pt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-wa-gris uppercase text-[10px]">VENCE</span>
              <span className="font-bold text-wa-vencido">15/09/2026</span>
            </div>
            <div className="flex justify-between">
              <span className="text-wa-gris uppercase text-[10px]">ORGANISMO</span>
              <span className="text-white font-semibold">Gobierno de Córdoba</span>
            </div>
          </div>
        </Entrante>
      </div>

      {/* Barra de escritura, decorativa */}
      <div
        className="bg-wa-panel px-3 py-2.5 flex items-center gap-2 border-t border-wa-borde-suave select-none shrink-0"
        aria-hidden="true"
      >
        <div className="flex items-center gap-2 text-wa-gris">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <svg className="w-5 h-5 rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </div>
        <div className="grow bg-wa-borde rounded-full px-4 py-2 text-sm text-wa-gris flex items-center justify-between shadow-inner">
          <span>Mensaje</span>
          <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="w-10 h-10 rounded-full bg-wa-verde text-white flex items-center justify-center shrink-0 shadow-md">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
