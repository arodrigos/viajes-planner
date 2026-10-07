import type { Page } from "@playwright/test";

// Es el color por defecto de Playwright, fijado aquí para que el test de
// enmascarado y el helper no dependan de un valor que podría cambiar.
export const COLOR_MASCARA = "#FF00FF";

const ATRIBUTO_TEMPORAL = "data-capturas-mascara";

// Las capturas se publican como artefacto del CI de un repo público: ningún
// correo puede salir en ellas. Un selector CSS no distingue «contiene @», así
// que se marca en el DOM, solo mientras dura la captura, lo que hay que tapar.
async function marcarCorreos(page: Page): Promise<void> {
  await page.evaluate((atributo) => {
    const marcar = (el: Element) => el.setAttribute(atributo, "");
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
      const padre = nodo.parentElement;
      if (padre && nodo.textContent?.includes("@") && !["SCRIPT", "STYLE"].includes(padre.tagName)) marcar(padre);
    }
    // El valor de un campo no es un nodo de texto, y es justo donde se teclea el correo.
    for (const campo of document.querySelectorAll("input, textarea")) {
      if ((campo as HTMLInputElement).value.includes("@")) marcar(campo);
    }
  }, ATRIBUTO_TEMPORAL);
}

async function desmarcar(page: Page): Promise<void> {
  await page.evaluate((atributo) => {
    for (const el of document.querySelectorAll(`[${atributo}]`)) el.removeAttribute(atributo);
  }, ATRIBUTO_TEMPORAL);
}

export function rutaCaptura(bloque: string, nombre: string): string {
  return `artefactos/capturas/${bloque}/${nombre}.png`;
}

export async function capturar(page: Page, bloque: string, nombre: string, opciones: { fullPage?: boolean } = {}): Promise<string> {
  const ruta = rutaCaptura(bloque, nombre);
  await marcarCorreos(page);
  try {
    await page.screenshot({
      path: ruta,
      fullPage: opciones.fullPage ?? true,
      mask: [page.locator(`[data-sensible], [${ATRIBUTO_TEMPORAL}]`)],
      maskColor: COLOR_MASCARA,
    });
  } finally {
    await desmarcar(page);
  }
  return ruta;
}
