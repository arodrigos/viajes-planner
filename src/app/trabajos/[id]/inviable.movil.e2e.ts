import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const EMAIL = "ci-test-inviable@example.com";

test.use({ viewport: { width: 390, height: 844 } });

// dmc-ac3 / cp-dmc-03: de punta a punta, con sesión real. El tick lo ejecuta
// el propio test sobre ese trabajo, con el doble del modelo que cuenta
// invocaciones y las respuestas grabadas de Nominatim.
test("un viaje imposible se descarta sin modelo, se explica y se puede cambiar con los datos precargados", async ({ page }) => {
  const supabase = clienteDePrueba("servicio");

  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Portugal y Grecia");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByLabel("Número de días").fill("10");
  await page.getByLabel("Presupuesto total (€)").fill("5000");
  // Cuatro personas, como pide el caso: el formulario arranca con una.
  const edades = [41, 39, 11, 8];
  for (let i = 1; i < edades.length; i++) await page.getByRole("button", { name: "+ Añadir persona" }).click();
  for (const [i, edad] of edades.entries()) await page.locator(`#edad-${i}`).fill(String(edad));
  await page.getByRole("checkbox", { name: "Tren" }).check();
  await page.getByRole("checkbox", { name: "Autobús" }).check();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("form", { name: "Pedir acceso" }).waitFor();
  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await page.getByRole("form", { name: "Introducir código" }).waitFor();
  await page.getByLabel("Código de acceso").fill(await leerCodigo(EMAIL));
  await page.getByRole("button", { name: "Confirmar código" }).click();

  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  const salida = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/procesar-trabajo-con-dobles.ts", id], {
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(salida).toContain("INVOCACIONES=0");

  const { data, error } = await supabase.from("trabajos").select("estado, motivo, inviable").eq("id", id).single();
  if (error || !data) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(data.estado).toBe("fallido");
  expect(data.motivo).toBe("inviable");
  expect((data.inviable as { razones: { codigo: string }[] }).razones[0].codigo).toBe("distancia");

  await expect(page.getByRole("heading", { name: "No hemos generado tu plan" })).toBeVisible({ timeout: 15_000 });
  const razon = page.getByTestId("razones-inviable");
  await expect(razon).toContainText("Portugal");
  await expect(razon).toContainText("Grecia");
  await expect(razon).toContainText("4 h");
  await expect(page.getByRole("heading", { name: "Qué puedes hacer" })).toBeVisible();
  await expect(page.getByTestId("sugerencias-inviable")).toContainText("Marca «Avión» o elige países más cercanos");

  // Sin desbordamiento horizontal en 390 px.
  const ancho = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, cliente: document.documentElement.clientWidth }));
  expect(ancho.scroll).toBeLessThanOrEqual(ancho.cliente);
  await page.screenshot({ path: "artefactos/capturas/destino-multiciudad-inviable-390x844.png", fullPage: true });

  await page.getByRole("button", { name: "Cambiar el viaje" }).click();
  await page.waitForURL(/\/criterios$/);
  await expect(page.getByLabel("Destino o tipo de viaje")).toHaveValue("Portugal y Grecia");
  await expect(page.getByLabel("Número de días")).toHaveValue("10");
  await expect(page.getByRole("checkbox", { name: "Tren" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Autobús" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Coche" })).not.toBeChecked();
});

// Un fallo que no es un descarte previo sigue enseñando el mensaje de siempre.
test("un trabajo fallido por otra causa no enseña «No hemos generado tu plan»", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({ json: { id: "abc", estado: "fallido", etapa: null, porcentaje: 0, motivo: "dias.0: falta la fecha", reintento_no_antes_de: null, plan_id: null, transporte: [], inviable: null, criterios_inviable: null } }),
  );
  await page.goto("/trabajos/abc");
  await expect(page.getByRole("heading", { name: "No se ha podido generar tu viaje" })).toBeVisible();
  await expect(page.getByText("No hemos generado tu plan")).toHaveCount(0);
});
