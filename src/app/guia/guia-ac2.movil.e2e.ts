import { expect, test } from "@playwright/test";

// guia-ac2: la guía no miente -cada cosa que promete se puede hacer de
// verdad-, y la promesa del borrado tiene que coincidir con la que el
// producto le enseña al usuario en el momento de borrar
// (PanelViajes.borrar-ac4.test.tsx afirma lo mismo sobre el diálogo real):
// dos superficies escritas por separado, sin ninguna constante compartida
// entre ellas -si una cambia y la otra no, uno de los dos test se pone rojo.
test("«Mis viajes» y «Cuéntanos tu viaje» llevan de verdad donde la guía dice, y su promesa del borrado coincide con la del producto", async ({
  page,
}) => {
  await page.goto("/guia");

  const texto = await page.evaluate(() => document.body.innerText);
  expect(texto).toMatch(/no se puede deshacer/i);

  await page.getByRole("link", { name: "Mis viajes" }).click();
  await expect(page).toHaveURL("/viajes");

  await page.goto("/");
  await page.getByRole("link", { name: "Cuéntanos tu viaje" }).click();
  await expect(page).toHaveURL("/criterios");
});
