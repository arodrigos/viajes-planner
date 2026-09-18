import { expect, test } from "@playwright/test";

// criterios-ac2: usable a 360px de ancho sin desbordamiento horizontal, con
// todos los controles alcanzables por teclado.
test.use({ viewport: { width: 360, height: 740 } });

test("la pantalla de criterios no desborda a 360px y es navegable por teclado", async ({ page }) => {
  await page.goto("/criterios");

  const anchoDocumento = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(anchoDocumento).toBeLessThanOrEqual(360);

  const destino = page.getByLabel("Destino o tipo de viaje");
  await destino.focus();
  await expect(destino).toBeFocused();

  const continuar = page.getByRole("button", { name: "Continuar" });
  await continuar.focus();
  await expect(continuar).toBeFocused();
});
