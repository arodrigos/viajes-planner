import { expect, test } from "@playwright/test";

// txt-ac1: antes de este bloque, ni el aviso previo de /criterios ni el
// paso del código decían que ese código es un inicio de sesión -con cuenta
// propia detrás-, así que quien lo pedía no tenía forma de saberlo hasta
// que ya lo había tecleado. Los dos avisos se prueban en el mismo
// recorrido: el previo se ve ANTES de pedir el código, el del paso del
// código, después.
test("antes y después de pedir el código, /criterios explica que es un inicio de sesión que crea una cuenta", async ({
  page,
}) => {
  await page.goto("/criterios");

  // (a) el aviso previo, visible antes de cualquier interacción.
  const avisoPrevio = page.getByText(/inicio de sesión/i).first();
  await expect(avisoPrevio).toBeVisible();
  const textoPrevio = await avisoPrevio.innerText();
  expect(textoPrevio).toMatch(/cuenta/i);

  await page.getByLabel("Destino o tipo de viaje").fill("Cracovia");
  await page.getByLabel("Época del año", { exact: true }).fill("invierno");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(`ci-test-textos-ac1-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  // (b) el paso del código repite la misma idea, ya en su propio texto.
  const pasoCodigo = page.getByRole("form", { name: "Introducir código" });
  await expect(pasoCodigo).toBeVisible();
  const textoPaso = await pasoCodigo.innerText();
  expect(textoPaso).toMatch(/inicio de sesión/i);
  expect(textoPaso).toMatch(/cuenta/i);
});
