import { expect, test } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { capturar } from "@/test-utils/capturas";

// leg-ac1/leg-ac3: las páginas legales son públicas, así que se recorren sin
// sesión; el pie es del layout raíz y por eso se comprueba desde varias
// pantallas distintas.
test.use({ viewport: { width: 393, height: 851 } });

const ENLACE_TERMINOS_GOOGLE = "https://maps.google.com/help/terms_maps/";
const ENLACE_PRIVACIDAD_GOOGLE = "https://policies.google.com/privacy";

for (const origen of ["/", "/guia", "/viajes"]) {
  test(`leg-pie: desde ${origen} el pie lleva a Privacidad y a Términos`, async ({ page }) => {
    await page.goto(origen);
    await page.getByRole("link", { name: "Privacidad" }).click();
    await expect(page).toHaveURL("/privacidad");
    await expect(page.getByRole("heading", { level: 1, name: "Privacidad" })).toBeVisible();
    await page.goBack();
    await page.getByRole("link", { name: "Términos" }).click();
    await expect(page).toHaveURL("/terminos");
    await expect(page.getByRole("heading", { level: 1, name: "Términos" })).toBeVisible();
  });
}

test("leg-ac1: /privacidad y /terminos cargan sin sesión con los avisos y los enlaces exactos de Google", async ({ page }) => {
  const privacidad = await page.goto("/privacidad");
  expect(privacidad?.status()).toBe(200);
  expect(page.url()).toMatch(/\/privacidad$/);
  expect(privacidad?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator("main")).toContainText("Google Maps");
  await expect(page.locator(`main a[href="${ENLACE_PRIVACIDAD_GOOGLE}"]`)).toHaveCount(1);
  await comprobarAccesibilidad(page);
  await capturar(page, "reglas-y-legal-google", "privacidad");

  const terminos = await page.goto("/terminos");
  expect(terminos?.status()).toBe(200);
  expect(page.url()).toMatch(/\/terminos$/);
  expect(terminos?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator("main")).toContainText("Google Maps");
  await expect(page.locator(`main a[href="${ENLACE_TERMINOS_GOOGLE}"]`)).toHaveCount(1);
  await comprobarAccesibilidad(page);
  await capturar(page, "reglas-y-legal-google", "terminos");
});

for (const ruta of ["/privacidad", "/terminos"]) {
  test(`leg-ac1 (límites): ${ruta} no desborda a 320 px ni lleva «@»`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(ruta);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(320);
    expect(await page.locator("main").innerText()).not.toContain("@");
  });
}
