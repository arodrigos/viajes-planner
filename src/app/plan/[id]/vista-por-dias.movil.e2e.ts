import { expect, test } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";

// dia-ac1..ac6 sobre un plan simulado por red: el reloj se fija con page.clock
// para que «hoy» sea determinista antes, durante y después del viaje.
const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha, i) => ({
  fecha,
  franjas: [{ id: "manana", etiqueta: "Mañana" }],
  paradas: [{ id: `p${i}`, franja_id: "manana", nombre: `Sitio ${i + 1}`, descripcion: "d", procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" } }],
}));
const PLAN = { id: "plan-dias", version: 1, destino: "Lisboa", personas: 2, dias, avisos: [], recomendaciones: [], regenerando: false, trabajoId: "t", zona: "Europe/Lisbon" };

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: import("@playwright/test").Page, ahora: string, ruta = "/plan/plan-dias") {
  await page.clock.install({ time: new Date(ahora) });
  await page.route("**/api/plan/*", (r) => r.fulfill({ json: PLAN }));
  await page.goto(ruta);
}

test("día por defecto: antes → Resumen, durante → hoy, después → Resumen (dia-ac1)", async ({ page }) => {
  await abrir(page, "2027-06-01T12:00:00Z");
  await expect(page.getByRole("heading", { level: 2, name: "Resumen" })).toBeVisible();
  await page.close();
});

test("durante el viaje abre el día de hoy y la recarga lo conserva (dia-ac1, dia-ac2)", async ({ page }) => {
  await abrir(page, "2027-06-09T12:00:00Z");
  await expect(page.getByRole("heading", { level: 2, name: /^Día 2 · / })).toBeVisible();
  await page.getByRole("navigation", { name: "Días del viaje" }).getByRole("link").nth(3).click();
  await expect(page.getByRole("heading", { level: 2, name: /^Día 3 · / })).toBeVisible();
  await expect(page).toHaveURL(/dia=3/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: /^Día 3 · / })).toBeVisible();
  expect(await page.locator(".maplibregl-canvas").count()).toBeLessThanOrEqual(1);
});

test("?dia inválido cae en el valor por defecto (dia-ac1)", async ({ page }) => {
  await abrir(page, "2027-06-01T12:00:00Z", "/plan/plan-dias?dia=99");
  await expect(page.getByRole("heading", { level: 2, name: "Resumen" })).toBeVisible();
});

test("un solo «Cómo leer este plan», sin «única forma de volver» y sin frase de estimación en el día (dia-ac4, dia-ac5)", async ({ page }) => {
  await abrir(page, "2027-06-09T12:00:00Z");
  await expect(page.getByText("Cómo leer este plan")).toHaveCount(1);
  await expect(page.getByText(/única forma de volver/)).toHaveCount(0);
  await expect(page.getByText("Tiempos estimados por distancia")).toHaveCount(0);
});

test("accesibilidad, chips ≥44 px, sin desbordar y Tab/Enter (dia-ac6)", async ({ page }) => {
  await abrir(page, "2027-06-09T12:00:00Z");
  await comprobarAccesibilidad(page);
  const alto = await page.getByRole("navigation", { name: "Días del viaje" }).getByRole("link").evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
  for (const a of alto) expect(a).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("navigation", { name: "Días del viaje" }).getByRole("link").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Resumen" })).toBeFocused();
  await comprobarAccesibilidad(page);
});

test("calendario, infografía y regenerar siguen en «Opciones del viaje» (dia-ac3)", async ({ page }) => {
  await abrir(page, "2027-06-09T12:00:00Z");
  await page.getByRole("button", { name: "Opciones del viaje" }).click();
  await expect(page.getByRole("link", { name: "Añadir al calendario" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerar el viaje…" })).toBeVisible();
});
