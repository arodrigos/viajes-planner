import { expect, test } from "@playwright/test";

// guia-ac1: la guía cuenta el recorrido completo de HOY con las SEIS cosas
// que el brief enumera. Cada bloque de aserciones falla por su cuenta si esa
// pieza desaparece del texto -no es una comprobación conjunta que un solo
// acierto pueda salvar, y es justo lo que faltaba tras maquetacion-del-plan
// y recomendaciones-de-sitios: ninguno de los dos bloques tocó la guía.
test("/guia cuenta las seis piezas del recorrido de hoy", async ({ page }) => {
  await page.goto("/guia");
  const texto = await page.evaluate(() => document.body.innerText);

  // (a) el código de acceso se pide y se teclea sin salir de la pantalla.
  expect(texto).toMatch(/sin salir de (ella|la página|esta pantalla)/i);

  // (b) el código ES un inicio de sesión, con una cuenta ligada al correo.
  expect(texto).toMatch(/inicio de sesión/i);
  expect(texto).toMatch(/cuenta/i);
  expect(texto).toMatch(/correo/i);

  // (c) el plan no es instantáneo: hay una pantalla de progreso.
  expect(texto).toMatch(/progreso/i);

  // (d) el itinerario se ve como línea de tiempo, por días y franjas.
  expect(texto).toMatch(/línea de tiempo/i);
  expect(texto).toMatch(/\bdía\b/i);
  expect(texto).toMatch(/franja/i);

  // (e) las recomendaciones abren una búsqueda, nunca prometen una reserva.
  expect(texto).toMatch(/recomendaci/i);
  expect(texto).toMatch(/búsqueda/i);
  expect(texto).not.toMatch(/puedes reservar|reserva ya|haz tu reserva/i);
  expect(texto).toMatch(/nunca (?:una |la )?reserva/i);

  // (f) se puede eliminar un viaje y el borrado no se puede deshacer.
  expect(texto).toMatch(/eliminar/i);
  expect(texto).toMatch(/no se puede deshacer/i);
});
