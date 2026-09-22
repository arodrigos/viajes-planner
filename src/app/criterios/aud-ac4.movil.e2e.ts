import { expect, test, type Page } from "@playwright/test";

// pantalla-ac8(c)/usabilidad-ac8(c) definen el mismo patrón de jerga
// prohibida; aquí se repite porque aud-ac4(c) lo exige sobre el aviso nuevo.
const REGEX_JERGA = /\b[45]\d\d\b|undefined|null|\[object|Error:|supabase|template|OTP/i;

async function llegarAlAvisoDelCodigo(page: Page, email: string): Promise<string> {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Oporto");
  await page.getByLabel("Época del año", { exact: true }).fill("otoño");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(email);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(page.getByRole("form", { name: "Introducir código" })).toBeVisible();

  // aud-ac4(a): se localiza por rol y por la asociación aria-describedby con
  // el campo, nunca por una clase CSS.
  const campo = page.getByLabel("Código de acceso");
  const idAyuda = await campo.getAttribute("aria-describedby");
  expect(idAyuda, "el campo del código no tiene aria-describedby").toBeTruthy();
  const ayuda = page.locator(`#${idAyuda}`);
  await expect(ayuda).toBeVisible();
  return (await ayuda.innerText()).trim();
}

// aud-ac4(a,c): ANTES de cualquier error -el aviso es estático, no se
// dispara por ningún fallo- ya cubre el caso que hoy ocurre siempre en
// producción (llega un enlace, no un código) y dice la acción concreta, sin
// código HTTP, sin "undefined"/"null" ni jerga de Supabase.
test("la ayuda del código dice qué hacer si lo que llega es un enlace, sin jerga técnica", async ({ page }) => {
  const texto = await llegarAlAvisoDelCodigo(page, `ci-test-aud-ac4-jerga-${Date.now()}@example.com`);
  expect(texto).toMatch(/enlace/i);
  expect(texto).toMatch(/Adrián/);
  expect(texto).not.toMatch(REGEX_JERGA);
});

// aud-ac4(b): el aviso no revela nada sobre la lista blanca -ni la nombra, ni
// afirma que se haya enviado nada a esa dirección concreta- y es IDÉNTICO,
// comparación literal, se esté o no el correo autorizado. Se ejecutan los dos
// recorridos de verdad contra la pila, no se asume por lectura de código.
test("el aviso es idéntico se esté o no el correo en la lista blanca", async ({ page, context }) => {
  const textoAutorizado = await llegarAlAvisoDelCodigo(page, "ci-test-aud-ac4@example.com");

  const paginaAjena = await context.newPage();
  const textoNoAutorizado = await llegarAlAvisoDelCodigo(
    paginaAjena,
    `ci-test-aud-ac4-no-autorizado-${Date.now()}@example.com`,
  );

  expect(textoNoAutorizado).toBe(textoAutorizado);
  expect(textoAutorizado).not.toMatch(/lista|autorizad|permitid/i);
});

// aud-ac4(d): leer el aviso no destruye lo escrito -el correo introducido
// sigue visible y el campo del código sigue utilizable después.
test("leer el aviso no pierde el correo introducido ni deja el campo del código inutilizable", async ({ page }) => {
  const email = `ci-test-aud-ac4-intacto-${Date.now()}@example.com`;
  await llegarAlAvisoDelCodigo(page, email);

  await expect(page.getByText(email)).toBeVisible();
  const campoCodigo = page.getByLabel("Código de acceso");
  await expect(campoCodigo).toBeEditable();
  await campoCodigo.fill("123456");
  await expect(campoCodigo).toHaveValue("123456");
});
