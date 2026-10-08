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
async function abrirPrimeraFicha(page: Page): Promise<boolean> {
  for (let dia = 1; dia <= DIAS_PLAN_PRUEBA; dia++) {
    await abrirDia(page, dia);
    const paneles = page.locator("li.tarjeta-parada summary", { hasText: /^Opiniones y horario/ });
    for (let i = 0; i < (await paneles.count()); i++) {
      await paneles.nth(i).click();
      const tarjeta = page.locator("li.tarjeta-parada").filter({ has: paneles.nth(i) });
      const ficha = tarjeta.locator("gmp-place-details");
      const intento = await ficha.waitFor({ state: "attached", timeout: 10_000 }).then(() => true, () => false);
      if (intento) return true;
    }
  }
  return false;
}

// fic-ac2 (ficha-real): necesita la clave de navegador real, que es un paso
// manual. Sin ella el caso queda pendiente de esa acción y no falla.
test("pv-ficha-real: la ficha de una parada casada enseña valoración, reseña con autor y atribución (fic-ac2)", async ({ page, request }, info) => {
  if (!(await claveConfigurada(request))) {
    info.annotations.push({ type: "pendiente", description: "Paso manual de la clave de navegador (clave_navegador = 0)" });
    return;
  }
  test.setTimeout(300_000);
  const antes = await cargasHoy(request);
  const cargada = await abrirPrimeraFicha(page);
  expect(cargada, "ninguna parada casada abrió su ficha").toBe(true);

  const ficha = page.locator("gmp-place-details").first();
  await expect(ficha).toBeVisible({ timeout: 10_000 });
  // Los localizadores atraviesan el shadow DOM abierto del elemento de Google.
  await expect(ficha.getByText(/\d[,.]\d/).first()).toBeVisible();
  await expect(ficha.getByText("Google Maps").first()).toBeVisible();
  await expect(ficha.locator("gmp-place-reviews, [class*='review' i]").first()).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ANCHO_MOVIL);
  const despues = await cargasHoy(request);
  expect(despues - antes).toBeGreaterThanOrEqual(1);

  mkdirSync(`${DIRECTORIO}/capturas`, { recursive: true });
  await page.screenshot({ path: `${DIRECTORIO}/capturas/pv-ficha-real.png`, fullPage: true });
});
