import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

const EMAIL = "ci-test-ritmo-intereses@example.com";

const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
] as const;

async function rellenarBase(page: import("@playwright/test").Page) {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Valencia");
  await page.getByLabel("Época del año", { exact: true }).fill("diciembre");
  await page.getByLabel("Número de días").fill("3");
  await page.getByLabel("Presupuesto total (€)").fill("900");
}

// rit-ac1 / rit-ac7: lo marcado en el formulario llega a la cola.
test("Tranquilo y dos intereses se encolan en ese orden; la ayuda y el límite de 3 se ven", async ({ page }) => {
  const supabase = clienteDePrueba("servicio");
  await rellenarBase(page);

  await expect(page.getByText("Marca hasta 3; si no marcas ninguno, el plan sale como siempre.")).toBeVisible();
  await page.getByRole("radio", { name: "Tranquilo" }).click();
  await expect(page.getByRole("radio", { name: "Tranquilo" })).toBeChecked();
  await expect(page.getByTestId("ayuda-ritmo")).toHaveText("Menos paradas cada día");

  await page.getByRole("checkbox", { name: "Museos" }).click();
  await page.getByRole("checkbox", { name: "Parques y juegos para niños" }).click();

  // rit-ac7: el cuarto interés no se marca y se explica.
  await page.getByRole("checkbox", { name: "Naturaleza" }).click();
  await page.getByRole("checkbox", { name: "Compras" }).click();
  await expect(page.getByRole("checkbox", { name: "Compras" })).not.toBeChecked();
  await expect(page.getByText("Puedes marcar hasta 3 intereses")).toBeVisible();
  // Desmarcar uno de los tres deja sitio otra vez.
  await page.getByRole("checkbox", { name: "Naturaleza" }).click();
  await expect(page.getByText("Puedes marcar hasta 3 intereses")).toHaveCount(0);

  for (const { ancho, alto } of TAMANOS) {
    await page.setViewportSize({ width: ancho, height: alto });
    await capturar(page, "ritmo-e-intereses", `formulario-${ancho}`);
  }

  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("form", { name: "Pedir acceso" }).waitFor();
  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await page.getByRole("form", { name: "Introducir código" }).waitFor();
  await page.getByLabel("Código de acceso").fill(await leerCodigo(EMAIL));
  await page.getByRole("button", { name: "Confirmar código" }).click();

  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const { data, error } = await supabase.from("trabajos").select("criterios").eq("id", id).single();
  if (error || !data) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(data.criterios).toMatchObject({ ritmo: "tranquilo", intereses: ["museos", "parques-ninos"] });
});

test("sin tocar ritmo ni intereses los criterios no traen ninguna de las dos claves", async ({ page }) => {
  let cuerpo: Record<string, unknown> | null = null;
  await page.route("**/api/plan", async (route) => {
    cuerpo = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 202, json: { id: "abc" } });
  });
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({ json: { id: "abc", estado: "encolado", etapa: null, porcentaje: 0, motivo: null, reintento_no_antes_de: null, transporte: [] } }),
  );
  await rellenarBase(page);
  await expect(page.getByRole("radio", { name: "Normal" })).toBeChecked();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/trabajos\/abc$/);
  expect(cuerpo).not.toBeNull();
  expect(cuerpo).not.toHaveProperty("ritmo");
  expect(cuerpo).not.toHaveProperty("intereses");
});
