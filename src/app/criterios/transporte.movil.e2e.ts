import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

const EMAIL = "ci-test-transporte@example.com";

// tra-ac1 / tra-ac2: lo marcado en el formulario llega a la cola y al resumen.
test("marcar Tren y Autobús encola un trabajo con esos medios y el resumen los enseña", async ({ page }) => {
  const supabase = clienteDePrueba("servicio");

  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Portugal");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByLabel("Número de días").fill("8");
  await page.getByLabel("Presupuesto total (€)").fill("3000");

  // tra-ac2: ayuda visible, casillas con etiqueta y área táctil >= 44 px.
  await expect(page.getByText(/Solo cuenta si el destino es un país, una región o varios países/)).toBeVisible();
  for (const nombre of ["Coche", "Avión", "Tren", "Autobús"]) {
    const caja = await page.getByRole("checkbox", { name: nombre }).boundingBox();
    expect(caja?.height, `${nombre}: alto`).toBeGreaterThanOrEqual(44);
    expect(caja?.width, `${nombre}: ancho`).toBeGreaterThanOrEqual(44);
  }
  for (const el of await medirObjetivosTactiles(page)) {
    expect.soft(el.alto, `${el.descripcion}: alto`).toBeGreaterThanOrEqual(44);
  }

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
  const { data, error } = await supabase.from("trabajos").select("estado, criterios").eq("id", id).single();
  if (error || !data) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(data.estado).toBe("encolado");
  expect((data.criterios as { transporte?: string[] }).transporte).toEqual(["tren", "autobus"]);

  await expect(page.getByTestId("resumen-transporte")).toHaveText("Tren, autobús");
});

test("sin marcar nada no hay clave transporte y el resumen dice «Cualquier medio»", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({ json: { id: "abc", estado: "encolado", etapa: null, porcentaje: 0, motivo: null, reintento_no_antes_de: null, transporte: [] } }),
  );
  await page.goto("/trabajos/abc");
  await expect(page.getByTestId("resumen-transporte")).toHaveText("Cualquier medio");
});
