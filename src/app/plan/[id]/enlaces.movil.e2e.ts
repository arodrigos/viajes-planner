import { expect, test } from "@playwright/test";

// enl-ac3: comprueba lo que llega al NAVEGADOR, no lo que devuelve
// urlBusquedaSitio.ts en aislamiento (eso ya lo cubre urlBusquedaSitio.test.ts,
// que sigue siendo su acompañante). El nombre trae a propósito espacios,
// acentos, "&" y una URL completa: si el href se recalculara con la misma
// función bajo prueba (o con un segundo `new URL`), este test no podría
// detectar una regresión circular -por eso el valor esperado está escrito a
// mano, no computado aquí.
test.use({ viewport: { width: 393, height: 851 } });

const DESTINO = "Córdoba";
const NOMBRE_ENVENENADO = "Bar & Café de la Judería, ¡ven ya! https://otro-malicioso.example/x";
const MOTIVO = "Terraza tranquila, poco turística.";

// Calculado a mano (node -e 'encodeURIComponent(...)'), NUNCA con
// urlBusquedaSitio ni con un segundo `new URL`: es el mismo error circular
// ya cometido en este producto, y la razón de que este literal esté aquí en
// vez de importado.
const HREF_ESPERADO =
  "https://www.google.com/maps/search/?api=1&query=Bar%20%26%20Caf%C3%A9%20de%20la%20Juder%C3%ADa%2C%20%C2%A1ven%20ya!%20https%3A%2F%2Fotro-malicioso.example%2Fx%20C%C3%B3rdoba";

const PLAN_FIXTURE = {
  id: "plan-enl-ac3",
  version: 1,
  destino: DESTINO,
  personas: 2,
  dias: [],
  avisos: [],
  recomendaciones: [{ tipo: "comida", nombre: NOMBRE_ENVENENADO, motivo: MOTIVO }],
};

test("el enlace de una recomendación con nombre envenenado apunta al literal determinista, con target/rel/nombre accesible correctos (enl-ac3)", async ({
  page,
}) => {
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));
  await page.goto("/plan/plan-enl-ac3?dia=1");

  const enlace = page.getByRole("link", { name: NOMBRE_ENVENENADO, exact: true });
  await expect(enlace).toHaveAttribute("href", HREF_ESPERADO);
  await expect(enlace).toHaveAttribute("target", "_blank");
  const rel = await enlace.getAttribute("rel");
  expect(rel).toContain("noopener");
  expect(rel).toContain("noreferrer");

  // El nombre accesible del enlace es el nombre del sitio, nunca «aquí» ni «ver».
  await expect(enlace).not.toHaveText(/^(aquí|ver)$/i);
  await expect(page.getByText(MOTIVO)).toBeVisible();
});
