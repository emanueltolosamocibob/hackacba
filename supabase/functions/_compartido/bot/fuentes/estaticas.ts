// =============================================================================
// Adaptadores estaticos rentas_cba e itv: sin red, sin bypass de captcha
// (regla que no se negocia, SPEC parr. 0). Existen como adaptadores, no como
// un "if" en el flujo del bot, para que el dia que haya convenio con la DGR
// alcance con cambiar este archivo.
//
// -----------------------------------------------------------------------
// RENTAS: por que sigue siendo estatico (relevado el 14/09/2026)
// -----------------------------------------------------------------------
// El endpoint de deuda por dominio existe y esta identificado. La SPA es
// Angular (www.rentascordoba.gob.ar/emision) y pega contra
// app.rentascordoba.gob.ar:
//
//   {base}WSRestDeudaAnt/{scope}/obtenerDeudaObjeto/{tipo}/{dominio}
//
// con tipo = "A" para automotor (enum del bundle: pe.A="automotor"). Lo que
// decide todo es {scope}, que tiene tres valores:
//
//   public/   anonimo, EXIGE el header "captchaV3". Es un reCAPTCHA v3 que no
//             se ve porque no hay widget: el token viaja como header propio.
//             Por eso no aparece buscando "grecaptcha" en el HTML. Aparece 23
//             veces en main.js, y todo endpoint public/ de Rentas lo pide.
//
//   {cuit}/   la persona logueada con su cuenta de Rentas. Quedaria fuera de
//             discusion igual: el bot no maneja credenciales de nadie.
//
//   b2b/      SIN captcha, con un "b2bToken" que emite un login interno
//             (WsRestLoginInterno). Es el canal de socios integrados, y trae
//             informeDeuda, historialpagos, estadoObjeto y consulta.
//
// El captcha se valida del lado del servidor, no es decorativo. Verificado:
//   GET app.rentascordoba.gob.ar/WSRestDeudaAnt/public/obtenerDeudaObjeto/A/<dom>
//   sin el header -> HTTP 500, {"success":"FALSE","code":"999","data":null}
//
// O sea: el camino no es tecnico, es un convenio con la DGR para que emitan
// credenciales b2b. El dia que exista, esto deja de ser estatico y pasa a ser
// un adaptador con red como muni.ts. No volver a buscarle la vuelta al
// captcha.
//
// De ITV no se relevo nada equivalente: sigue siendo solo-link por el mismo
// motivo declarado (pide validacion), sin verificar.
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
