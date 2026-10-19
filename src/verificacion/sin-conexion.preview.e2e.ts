import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { DIRECTORIO, planDePrueba } from "./entorno";

// sc-ac13: el recorrido de sc-ac1 contra el preview real, con el service
// worker de verdad y la red cortada por el navegador.
test.use({ serviceWorkers: "allow" });

test("pv-sin-conexion: abrir el plan una vez, cortar la red y ver la copia con su franja (sc-ac13)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const id = planDePrueba();
  await page.goto(`/plan/${id}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
  await expect(page.getByText(/Disponible sin conexión · guardado a las \d{2}:\d{2}/)).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/sin-conexion\\?plan=${id}`));
  const franja = page.getByRole("status").filter({ hasText: "Sin conexión" });
  await expect(franja).toBeVisible();
  await expect(franja).toContainText("copia guardada");
  await expect(page.locator("li.tarjeta-parada").first()).toBeVisible();

  mkdirSync(`${DIRECTORIO}/capturas`, { recursive: true });
  await page.screenshot({ path: `${DIRECTORIO}/capturas/pv-sin-conexion-copia.png`, fullPage: true });
  await context.setOffline(false);
});
