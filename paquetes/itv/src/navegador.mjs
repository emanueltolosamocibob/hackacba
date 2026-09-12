import { chromium } from 'playwright';
import { FUENTE, ErrorConsulta } from './consultas.mjs';

export async function crearNavegador() {
  const navegador = await chromium.launch({ headless: true });
  return {
    cerrar: () => navegador.close(),
    async abrir(dominio) {
      const contexto = await navegador.newContext({ locale: 'es-AR', serviceWorkers: 'block' });
      const pagina = await contexto.newPage();
      pagina.setDefaultTimeout(15_000);
      pagina.setDefaultNavigationTimeout(25_000);
      // La herramienta no acepta URLs, scripts ni selectores elegidos por el LLM.
      await contexto.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === new URL(FUENTE).origin ? route.continue() : route.abort();
      });
      try {
        await pagina.goto(FUENTE, { waitUntil: 'domcontentloaded' });
        await pagina.locator('#MainContent_DominioHist').fill(dominio);
        return {
          texto: () => pagina.locator('body').innerText(),
          async enviar(respuesta) {
            await pagina.locator('#MainContent_tbCaptcha').fill(String(respuesta));
            // El UpdatePanel de ASP.NET puede completar el postback sin navegar.
            // Registrar la espera antes del clic y esperar luego la tabla renderizada.
            await Promise.all([
              pagina.waitForResponse(res => res.url() === FUENTE &&
                res.request().method() === 'POST', { timeout: 25_000 }),
              pagina.locator('#MainContent_SearchButton').click(),
            ]);
            try {
              await pagina.locator('#MainContent_GridResultados').waitFor({ state: 'visible', timeout: 10_000 });
            } catch {
              throw new ErrorConsulta('resultado_no_verificado', 'ITV no mostró una tabla de resultados verificable.', 502);
            }
          },
          filas: () => pagina.locator('#MainContent_GridResultados tr').evaluateAll(filas =>
            filas.map(fila => [...fila.querySelectorAll('th, td')].map(celda => celda.innerText.trim()))),
          cerrar: () => contexto.close(),
        };
      } catch (error) {
        await contexto.close();
        throw error;
      }
    },
  };
}
