import type { Page } from "@playwright/test";

// visual-ac2(a): objetivo táctil >=44px en alto Y ancho -el propio
// boundingBox(), nunca el del label que lo envuelve-, que es lo que hace
// imposible el falso verde de un <button> sin estilos (~21px de alto).
// Compartida entre visual.movil.e2e.ts y peso-visual.movil.e2e.ts
// (peso-ac6): misma técnica de medida, nunca una segunda copia.
export async function medirObjetivosTactiles(page: Page) {
  return page.evaluate(() => {
    const elementos = Array.from(document.querySelectorAll<HTMLElement>('button, a, input:not([type="hidden"]), select, textarea'));
    return elementos
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const esCampoDeTexto = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio"].includes((el as HTMLInputElement).type));
        const esEnlaceEnParrafo = el.tagName === "A" && el.closest("p") !== null;
        const etiqueta = el.textContent?.trim().slice(0, 30) || el.getAttribute("aria-label") || el.id || el.tagName;
        return {
          descripcion: `${el.tagName.toLowerCase()} "${etiqueta}"`,
          alto: rect.height,
          ancho: rect.width,
          exigirAncho: !(esCampoDeTexto || esEnlaceEnParrafo),
        };
      });
  });
}
