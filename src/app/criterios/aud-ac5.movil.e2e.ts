import { expect, test } from "@playwright/test";

// aud-ac5(a): el texto visible del paso del código no atribuye el correo a
// este producto -ni "desde Viajes" ni ninguna otra variante- y sí contiene el
// título literal con el que llega el correo. La atadura contra las
// plantillas reales del repositorio (b) vive en
// PanelAcceso.aud-ac5.test.tsx, porque es una comprobación de ficheros, no de
// pantalla: aquí solo se comprueba qué VE el usuario.
test("el paso del código no atribuye el correo a este producto y cita el asunto real", async ({ page }) => {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Braga");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(`ci-test-aud-ac5-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  const pasoCodigo = page.getByRole("form", { name: "Introducir código" });
  await expect(pasoCodigo).toBeVisible();
  const texto = await pasoCodigo.innerText();

  expect(texto).not.toMatch(/desde Viajes/i);
  expect(texto).not.toMatch(/\bViajes\b/);
  expect(texto).toContain("Tu código de acceso");
});
