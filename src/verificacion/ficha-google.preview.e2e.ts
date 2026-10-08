import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ANCHO_MOVIL, DIAS_PLAN_PRUEBA, abrirDia } from "./ayudas";
import { DIRECTORIO } from "./entorno";

async function cargasHoy(peticiones: APIRequestContext): Promise<number> {
  const r = await peticiones.get("/api/salud");
  const cuerpo = (await r.json()) as { google?: { ui_kit_hoy?: number; clave_navegador?: number } };
  return cuerpo.google?.ui_kit_hoy ?? -1;
}

async function claveConfigurada(peticiones: APIRequestContext): Promise<boolean> {
  const cuerpo = (await (await peticiones.get("/api/salud")).json()) as { google?: { clave_navegador?: number } };
  return cuerpo.google?.clave_navegador === 1;
}

// Cada panel se abre una sola vez: una parada casada sin reseñas en Google
// enseña lo que Google dé, y el caso pasa a la siguiente (límite del caso).
// Devuelve las cargas del UI Kit justo antes de abrir el panel que sí cargó,
// para medir el coste de esa única apertura.
async function abrirPrimeraFicha(page: Page, peticiones: APIRequestContext): Promise<number | null> {
  for (let dia = 1; dia <= DIAS_PLAN_PRUEBA; dia++) {
    await abrirDia(page, dia);
    const paneles = page.locator("li.tarjeta-parada summary", { hasText: /^Opiniones y horario/ });
    for (let i = 0; i < (await paneles.count()); i++) {
      const antes = await cargasHoy(peticiones);
      await paneles.nth(i).click();
      const tarjeta = page.locator("li.tarjeta-parada").filter({ has: paneles.nth(i) });
      // La ficha cargada ya lleva la atribución de Google; el elemento solo "attached" aún puede estar buscando.
      const cargada = await tarjeta
        .locator("gmp-place-details")
        .getByText("Google Maps")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true, () => false);
      if (cargada) return antes;
    }
  }
  return null;
}

// fic-ac2 (ficha-real): necesita la clave de navegador real, que es un paso
// manual. Sin ella el caso queda pendiente de esa acción y no falla.
test("pv-ficha-real: la ficha de una parada casada enseña valoración, reseña con autor y atribución (fic-ac2)", async ({ page, request }) => {
  test.skip(!(await claveConfigurada(request)), "Paso manual de la clave de navegador pendiente (clave_navegador = 0)");
  test.setTimeout(300_000);
  const antes = await abrirPrimeraFicha(page, request);
  expect(antes, "ninguna parada casada abrió su ficha").not.toBeNull();

  const ficha = page.locator("gmp-place-details").first();
  await expect(ficha).toBeVisible({ timeout: 10_000 });
  // Los localizadores atraviesan el shadow DOM abierto del elemento de Google.
  await expect(ficha.getByText(/\d[,.]\d/).first()).toBeVisible();
  await expect(ficha.getByText("Google Maps").first()).toBeVisible();
  await expect(ficha.locator("gmp-place-reviews, [class*='review' i]").first()).toBeVisible();
  // El autor de la reseña es un enlace a su perfil de Google; sin él la reseña no cumple la atribución.
  const autor = ficha.locator("a[href*='/maps/contrib/']").first();
  await expect(autor).toBeVisible();
  expect((await autor.innerText()).trim().length).toBeGreaterThan(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ANCHO_MOVIL);
  expect((await cargasHoy(request)) - (antes as number)).toBe(1);

  mkdirSync(`${DIRECTORIO}/capturas`, { recursive: true });
  await page.screenshot({ path: `${DIRECTORIO}/capturas/pv-ficha-real.png`, fullPage: true });
});
