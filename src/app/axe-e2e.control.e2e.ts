import { expect, test } from "@playwright/test";
import { comprobarAccesibilidad } from "./axe-e2e";

// Control del propio helper: si no fallara ante un botón sin nombre, todos los
// e2e que lo llaman darían verde sin comprobar nada.
test("comprobarAccesibilidad falla con un botón sin nombre accesible (e2e-ac4)", async ({ page }) => {
  await page.setContent('<!doctype html><html lang="es"><head><title>Control</title></head><body><main><button type="button"></button></main></body></html>');
  await expect(comprobarAccesibilidad(page)).rejects.toThrow(/button-name/);
});

test("comprobarAccesibilidad pasa con un botón con nombre (e2e-ac4)", async ({ page }) => {
  await page.setContent('<!doctype html><html lang="es"><head><title>Control</title></head><body><main><button type="button">Guardar</button></main></body></html>');
  await comprobarAccesibilidad(page);
});
