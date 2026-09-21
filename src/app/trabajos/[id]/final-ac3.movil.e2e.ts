import { test } from "@playwright/test";

// final-ac3(c): captura real en viewport de móvil (proyecto 'movil',
// Pixel 5, 393x851 -playwright.config.ts) para que el gatekeeper juzgue si
// la pantalla se lee como un final y si el enlace al itinerario destaca
// como la acción principal (rubrica.md, eje 6). Las comprobaciones
// mecánicas (a y b: sin barra de progreso, aviso que señala la dirección
// del plan) ya están en progreso.e2e.ts; esta prueba no repite ninguna
// aserción, solo produce el artefacto -mismo patrón que
// usabilidad.movil.e2e.ts, "capturas de los cuatro estados nuevos para
// juicio visual".
test("captura del final del recorrido: trabajo completado con enlace al plan", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "trabajo-final-ac3-movil",
        estado: "completado",
        etapa: "guardando",
        porcentaje: 100,
        motivo: null,
        reintento_no_antes_de: null,
        plan_id: "plan-final-ac3-movil",
      },
    }),
  );

  await page.goto("/trabajos/trabajo-final-ac3-movil");
  await page.getByRole("link", { name: "Ver el itinerario" }).waitFor();
  await page.screenshot({ path: "artefactos/capturas/final-recorrido-completado.png", fullPage: true });
});
