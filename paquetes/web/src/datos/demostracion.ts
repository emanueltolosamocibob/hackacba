/* =============================================================================
   Datos de demostracion de la web. TODO el hilo es inventado y esta etiquetado
   como ejemplo en la interfaz.
   - Los dominios no son de ningun vehiculo real.
   - Los importes no salen de ninguna boleta.
   - No es un cliente y no se muestra como tal.

   Los nombres de organismo y la URL de Rentas, en cambio, si son reales: salen
   del catalogo de `sembrar_catalogo_cordoba()` en la migracion 0002. Eso es lo
   unico verificable de este archivo y por eso no se toca.

   OJO: las fechas se calculan contra el reloj del navegador porque son de
   presentacion, no de negocio. Una fecha de negocio nunca sale de aca: sale de
   `hoy_en_organizacion()` en la base (ver la migracion 0007). No copiar este
   patron a nada que decida algo.
   ============================================================================= */

export interface ObligacionDelCatalogo {
  /** Clave del enum en la base. */
  codigo: string;
  nombre: string;
  organismo: string | null;
  /** Ambito tal como lo guarda la columna `jurisdiccion`. */
  ambito: string;
}

/** Las seis obligaciones que sigue el sistema, con su organismo real. */
export const CATALOGO: ObligacionDelCatalogo[] = [
  {
    codigo: 'impuesto_automotor_pcial',
    nombre: 'Impuesto Automotor (Provincial)',
    organismo: 'Rentas Córdoba',
    ambito: 'Provincial',
  },
  {
    codigo: 'tasa_municipal_automotor',
    nombre: 'Tasa Municipal Automotor',
    organismo: 'Municipalidad de Córdoba',
    ambito: 'Municipal',
  },
  {
    codigo: 'vtv',
    nombre: 'Revisión Técnica Obligatoria (RTO/VTV)',
    organismo: 'Gobierno de Córdoba',
    ambito: 'Provincial',
  },
  {
    codigo: 'gnc',
    nombre: 'Oblea GNC',
    organismo: 'ENARGAS',
    ambito: 'Nacional',
  },
  {
    codigo: 'multas',
    nombre: 'Multas e Infracciones',
    organismo: 'Rentas Córdoba',
    ambito: 'Provincial',
  },
  {
    codigo: 'seguro',
    nombre: 'Seguro del Vehículo',
    organismo: null,
    ambito: 'Privado',
  },
];

const DIA = 86_400_000;

function enDias(dias: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return new Date(d.getTime() + dias * DIA);
}

const fechaCorta = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const pesos = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

const f = (dias: number) => fechaCorta.format(enDias(dias));

/* ------------------------------------------------------------------- el hilo */

export interface LineaDato {
  etiqueta: string;
  valor: string;
}

export type Turno =
  | {
      de: 'bot';
      hora: string;
      /** Primera linea, la que cuenta cuanto falta. */
      encabezado?: string;
      texto: string;
      datos?: LineaDato[];
      enlace?: string;
    }
  | { de: 'duenio'; hora: string; texto: string };

export interface TramoDelHilo {
  dia: string;
  turnos: Turno[];
}

export const HILO: TramoDelHilo[] = [
  {
    dia: 'Ayer',
    turnos: [
      {
        de: 'bot',
        hora: '8:02',
        encabezado: 'Faltan 30 días',
        texto: 'Impuesto Automotor (Provincial) del dominio AE 412 KT.',
        datos: [
          { etiqueta: 'Vence', valor: f(29) },
          { etiqueta: 'Cuota', valor: '09 de 12' },
          { etiqueta: 'Importe', valor: pesos.format(48_350.2) },
          { etiqueta: 'Organismo', valor: 'Rentas Córdoba' },
        ],
      },
      { de: 'duenio', hora: '8:14', texto: 'pasame el link' },
      {
        de: 'bot',
        hora: '8:14',
        texto:
          'Rentas Córdoba, Ver y pagar. Consultá por dominio; el calendario de cuotas lo publica la DGR cada año.',
        enlace: 'rentascordoba.gob.ar/emisiontributaria/ver-y-pagar/automotor',
      },
      { de: 'duenio', hora: '9:41', texto: 'listo, ya la pagué' },
      {
        de: 'bot',
        hora: '9:41',
        texto:
          'Anotado. Impuesto Automotor de AE 412 KT, cuota 09 de 12, queda como pagado.',
        datos: [{ etiqueta: 'Registrado', valor: pesos.format(48_350.2) }],
      },
    ],
  },
  {
    dia: 'Hoy',
    turnos: [
      {
        de: 'bot',
        hora: '8:00',
        encabezado: 'Faltan 7 días',
        texto: 'Oblea GNC del dominio AD 889 RJ.',
        datos: [
          { etiqueta: 'Vence', valor: f(7) },
          { etiqueta: 'Organismo', valor: 'ENARGAS' },
        ],
      },
      {
        de: 'bot',
        hora: '8:00',
        encabezado: 'Faltan 3 días',
        texto: 'Revisión Técnica Obligatoria del dominio AC 204 LM.',
        datos: [
          { etiqueta: 'Vence', valor: f(3) },
          { etiqueta: 'Organismo', valor: 'Gobierno de Córdoba' },
        ],
      },
    ],
  },
];
