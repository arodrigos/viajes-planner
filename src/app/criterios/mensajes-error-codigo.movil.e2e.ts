import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

// reenvio-ac1..ac4, ac6: el fallo de «Pedir otro código» se avisa en el mismo
// paso, debajo del botón, sin mover el foco y sin perder lo escrito.
const AVISO_REENVIO_SERVIDOR =
  "No se ha podido enviar otro código. Inténtalo de nuevo en un momento. Si ya te llegó un código, puedes seguir usándolo mientras no caduque.";
const AVISO_REENVIO_RED =
  "No se ha podido enviar otro código: parece que no hay conexión. Compruébala e inténtalo de nuevo. Si ya te llegó un código, puedes seguir usándolo mientras no caduque.";

async function hastaPasoCodigoReenvio(page: Page, siguientes: Array<"500" | "red" | "ok">) {
  await page.clock.install();
  const cola = [...siguientes];
  let llamadas = 0;
  await page.route("**/api/acceso/solicitar-codigo", (ruta) => {
    llamadas += 1;
    const resultado = llamadas === 1 ? "ok" : (cola.shift() ?? "ok");
    if (resultado === "red") return ruta.abort("internetdisconnected");
    if (resultado === "500") return ruta.fulfill({ status: 500, body: "" });
    return ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mensaje: MENSAJE_CODIGO_SOLICITADO }) });
  });
  await hastaPedirCodigo(page);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(page.getByRole("form", { name: "Introducir código" })).toBeVisible();
  await page.getByLabel("Código de acceso").fill("123");
  await page.clock.runFor(61_000);
  await expect(page.getByRole("button", { name: "Pedir otro código", exact: true })).toBeEnabled();
}

test("un reenvío en 500 avisa debajo del botón, conserva lo escrito y deja el botón libre", async ({ page }) => {
  await hastaPasoCodigoReenvio(page, ["500"]);
  const boton = page.getByRole("button", { name: "Pedir otro código", exact: true });
  await boton.click();

  const alerta = page.getByRole("alert");
  await expect(alerta).toHaveCount(1);
  await expect(alerta).toHaveText(AVISO_REENVIO_SERVIDOR);
  const cajaBoton = await boton.boundingBox();
  const cajaAlerta = await alerta.boundingBox();
  expect(cajaAlerta!.y).toBeGreaterThanOrEqual(cajaBoton!.y + cajaBoton!.height - 1);
  await expect(page.getByLabel("Código de acceso")).toHaveValue("123");
  await expect(page.getByText(`Te hemos enviado un código a ${EMAIL}`)).toBeVisible();
  await expect(boton).toBeEnabled();
  // reenvio-ac6: el aviso se anuncia sin robar el foco.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Pedir otro código");
  const axe = await new AxeBuilder({ page }).include("form[aria-label='Introducir código']").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await capturar(page, "mensajes-error-codigo-3-reenvio-500");
});

test("un reenvío sin red avisa de la conexión en el mismo sitio", async ({ page }) => {
  await hastaPasoCodigoReenvio(page, ["red"]);
  await page.getByRole("button", { name: "Pedir otro código", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(AVISO_REENVIO_RED);
  await expect(page.getByLabel("Código de acceso")).toHaveValue("123");
  await capturar(page, "mensajes-error-codigo-4-reenvio-red");
});

test("tras un fallo, un reintento correcto quita el aviso y vuelve la cuenta atrás", async ({ page }) => {
  await hastaPasoCodigoReenvio(page, ["500", "ok"]);
  const boton = page.getByRole("button", { name: "Pedir otro código", exact: true });
  await boton.click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await boton.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pedir otro código \(\d+ s\)/ })).toBeDisabled();
  await capturar(page, "mensajes-error-codigo-5-reenvio-recuperado");
});
