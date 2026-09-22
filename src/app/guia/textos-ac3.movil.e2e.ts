import { expect, test } from "@playwright/test";

// txt-ac3: antes de este bloque la guía prometía que no hacía falta cuenta
// y que no había ninguna lista que recordara el viaje -las dos falsas: la
// cuenta la crea el propio código desde el primer acceso, hoy sin decirlo.
// La guía tiene que explicar lo que el producto hace de verdad, no lo que
// hacía antes de introducir el código en la misma pantalla.
test("la guía explica que el código de acceso es un inicio de sesión que crea una cuenta", async ({ page }) => {
  await page.goto("/guia");
  const texto = await page.evaluate(() => document.body.innerText);

  expect(texto).toMatch(/inicio de sesión/i);
  expect(texto).toMatch(/crea tu cuenta/i);
  // la promesa retirada -"sin necesidad de crear una cuenta"- no puede
  // seguir en el texto público, sería mentir sobre lo que hoy pasa de verdad.
  expect(texto).not.toMatch(/sin necesidad de crear una cuenta/i);
  expect(texto).not.toMatch(/no hay lista de viajes ni cuenta/i);
});
