import { expect, test } from "@playwright/test";

// pantalla-ac9, mitad MECÁNICA: los atributos que hacen salir el teclado
// numérico y permiten el autorrelleno del sistema donde exista -la
// geometría real (>=44px, fuente >=16px, sin desbordamiento a 393/320px) ya
// la miden los bucles genéricos de visual.movil.e2e.ts sobre las mismas dos
// pantallas, así que aquí solo van los atributos que esos bucles no miran.
test("el campo del código declara inputmode, autocomplete y maxlength, con etiqueta y ayuda visible", async ({ page }) => {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Braga");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(`ci-test-pantalla-ac9-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  const campo = page.getByLabel("Código de seis dígitos");
  await expect(campo).toHaveAttribute("inputmode", "numeric");
  await expect(campo).toHaveAttribute("autocomplete", "one-time-code");
  await expect(campo).toHaveAttribute("maxlength", "6");

  const idAyuda = await campo.getAttribute("aria-describedby");
  expect(idAyuda, "el campo del código no tiene aria-describedby").toBeTruthy();
  const ayuda = page.locator(`#${idAyuda}`);
  await expect(ayuda, "el texto de ayuda del código no es visible").toBeVisible();
  const textoAyuda = (await ayuda.innerText()).trim();
  expect(textoAyuda.length).toBeGreaterThan(0);
  expect(textoAyuda).toMatch(/código/i);
});
