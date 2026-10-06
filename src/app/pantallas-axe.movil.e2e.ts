import { test } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";

test.use({ viewport: { width: 390, height: 844 } });

// txt-ac3: portada, criterios y progreso no necesitan sesión para pintarse;
// la de progreso recibe su estado de una respuesta interceptada.
test("portada: sin violaciones serious ni critical (txt-ac3)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await comprobarAccesibilidad(page);
});

test("criterios: sin violaciones serious ni critical (txt-ac3)", async ({ page }) => {
  await page.goto("/criterios");
  await page.getByRole("heading", { level: 1, name: "Cuéntanos tu viaje" }).waitFor();
  await comprobarAccesibilidad(page);
});

test("progreso: sin violaciones serious ni critical en curso y completado (txt-ac3)", async ({ page }) => {
  let estado: object = {
    id: "trabajo-axe",
    estado: "en-curso",
    etapa: "pensando",
    porcentaje: 40,
    motivo: null,
    reintento_no_antes_de: null,
    plan_id: null,
  };
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: estado }));
  await page.goto("/trabajos/trabajo-axe");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await comprobarAccesibilidad(page);

  estado = { ...estado, estado: "completado", etapa: "guardando", porcentaje: 100, plan_id: "plan-axe" };
  await page.reload();
  await page.getByRole("link", { name: "Ver el itinerario" }).waitFor();
  await comprobarAccesibilidad(page);
});
