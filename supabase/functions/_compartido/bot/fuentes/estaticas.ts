// =============================================================================
// Adaptadores estaticos rentas_cba e itv: sin red, sin bypass de captcha
// (regla que no se negocia, SPEC parr. 0). Existen como adaptadores, no como
// un "if" en el flujo del bot, para que el dia que haya convenio con la DGR
// alcance con cambiar este archivo.
//
// Modo demo (DEMO_FUENTES_MOCK=true): para la demo en vivo, ambas fuentes
// devuelven "sin deuda" en vez de derivar a la persona. Es un modo explicito,
// nunca el comportamiento por defecto: sin el flag, siguen siendo solo-link.
// =============================================================================

import type { FuenteResultado } from './tipos.ts';

export function rentasCba(demoSinDeuda = false): FuenteResultado {
  const base = {
    id: 'rentas_cba' as const,
    nombre: 'Rentas Córdoba',
    cubre: ['impuesto automotor', 'multas de Caminera'],
    url: 'https://www.rentascordoba.gob.ar/emision/ver-y-pagar/automotor',
    consultadoEn: new Date().toISOString(),
    desdeCache: false,
    obligaciones: [] as FuenteResultado['obligaciones'],
  };
  if (demoSinDeuda) {
    return { ...base, estado: 'ok', metodo: 'estatico', motivo: 'demo' };
  }
  return { ...base, estado: 'requiere_usuario', metodo: 'estatico', motivo: 'captcha' };
}

export function itv(demoSinDeuda = false): FuenteResultado {
  const base = {
    id: 'itv' as const,
    nombre: 'ITV Córdoba',
    cubre: ['histórico de revisión técnica'],
    url: 'https://itvcordoba.com.ar/Historico.aspx',
    consultadoEn: new Date().toISOString(),
    desdeCache: false,
    obligaciones: [] as FuenteResultado['obligaciones'],
  };
  if (demoSinDeuda) {
    return { ...base, estado: 'ok', metodo: 'estatico', motivo: 'demo' };
  }
  return { ...base, estado: 'requiere_usuario', metodo: 'estatico', motivo: 'captcha' };
}
