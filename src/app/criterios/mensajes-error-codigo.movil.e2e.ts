import { expect, test, type Page } from "@playwright/test";

// es-3 / es-4: la red de solicitar-codigo se intercepta, así que nunca se
// llama a signInWithOtp ni se gasta el límite de envíos del SMTP de DEV.
// Literal a propósito: importar el manejador arrastraría "server-only" al
// proceso de Playwright, y así el test también falla si alguien cambia el texto.
const MENSAJE_CODIGO_SOLICITADO =
  "Si tu correo está autorizado, te llegará un código en un minuto. Si no te llega, espera un minuto y vuelve a pedirlo.";
const EMAIL = "familia@example.com";

// Solo para las capturas que revisa el gatekeeper; en el CI no hay variable.
async function capturar(page: Page, nombre: string) {
  const dir = process.env.CAPTURAS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

async function hastaPedirCodigo(page: Page) {
  // Sin sesión, enviar los criterios responde 401 y eso abre el panel de acceso.
  await page.route("**/api/plan", (ruta) => ruta.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Tesalónica");
  await page.getByLabel("Época del año", { exact: true }).fill("primavera");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(EMAIL);
}

test("una respuesta 200 con el aviso lo muestra, conserva el correo y deja volver a pedir el código", async ({ page }) => {
  await page.route("**/api/acceso/solicitar-codigo", (ruta) =>
    ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mensaje: MENSAJE_CODIGO_SOLICITADO }) }),
  );
  await hastaPedirCodigo(page);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  const formulario = page.getByRole("form", { name: "Introducir código" });
  await expect(formulario).toBeVisible();
  await expect(formulario.getByText(/Si tu correo está autorizado/)).toHaveText(/espera un minuto/);
  await expect(formulario.getByText(EMAIL)).toBeVisible();
  await expect(page.getByText("No se ha podido enviar el código")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pedir otro código/ })).toBeVisible();
  await capturar(page, "mensajes-error-codigo-1-aviso");
});

test("una respuesta 500 sin cuerpo mantiene el texto genérico y no distingue límite de dirección", async ({ page }) => {
  await page.route("**/api/acceso/solicitar-codigo", (ruta) => ruta.fulfill({ status: 500, body: "" }));
  await hastaPedirCodigo(page);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  const alerta = page.getByRole("alert").filter({ hasText: /No se ha podido enviar el código/ });
  await expect(alerta).toBeVisible();
  await expect(page.getByLabel("Tu correo")).toHaveValue(EMAIL);
  await expect(page.getByText(/límite|no válid|rechaz/i)).toHaveCount(0);
  await capturar(page, "mensajes-error-codigo-2-generico");
});
