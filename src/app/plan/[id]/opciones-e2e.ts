import type { Page } from "@playwright/test";

// Calendario, infografía y regenerar viven en el menú «Opciones del viaje»:
// los specs lo abren antes de buscar sus botones.
export async function abrirOpciones(pagina: Page): Promise<void> {
  const boton = pagina.getByRole("button", { name: "Opciones del viaje" });
  if ((await boton.getAttribute("aria-expanded")) !== "true") await boton.click();
}
