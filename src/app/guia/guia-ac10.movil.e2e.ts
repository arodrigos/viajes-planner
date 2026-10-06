import { expect, test } from "@playwright/test";

// guia-ac10: la guía tiene que describir el recorrido que el producto hace
// AHORA (código de acceso, tecleado sin salir de la página) y no debe
// quedar ni rastro del recorrido anterior (enlace, mismo navegador/dispositivo).
// La mitad (b) es la que de verdad detecta una guía desactualizada: si el
// bloque `codigo-en-la-misma-pantalla` se construye y nadie toca la guía,
// este test se pone rojo. No se exige un número de dígitos concreto (issue
// #181, tercer caso real): quién decide la longitud es Supabase Auth, no
// este texto -- exigirla aquí habría vuelto a fijarla en un tercer sitio.
const PALABRAS_DEL_ENLACE_RETIRADO = /\benlace\b|\blink\b|\bábrelo\b|\babrelo\b|mismo navegador|mismo dispositivo/i;

test("la guía menciona el código de acceso y que se teclea sin salir de la página", async ({ page }) => {
  await page.goto("/guia");
  const texto = await page.evaluate(() => document.body.innerText);

  // (a) presencia.
  expect(texto).toMatch(/código de acceso/i);
  expect(texto).toMatch(/sin salir de (ella|la página|esta pantalla)/i);

  // (b) ausencia: nada del recorrido del enlace mágico sobrevive en el texto.
  expect(texto).not.toMatch(PALABRAS_DEL_ENLACE_RETIRADO);
});

test("la guía conserva su extensión, estructura y carácter público sin relajarse", async ({ page, request }) => {
  // (c) lo que no cambia. GET directo, sin cookie de sesión previa.
  const respuesta = await request.get("/guia", { headers: {} });
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  await page.goto("/guia");
  const numeroDePalabras = await page.evaluate(() => document.body.innerText.trim().split(/\s+/).length);
  expect(numeroDePalabras).toBeGreaterThan(120);
  expect(numeroDePalabras).toBeLessThan(450);

  const pasos = await page.locator("ol > li").count();
  expect(pasos).toBeGreaterThanOrEqual(5);

  const alto = await page.evaluate(() => document.body.scrollHeight);
  const viewport = page.viewportSize()!;
  expect(alto).toBeLessThanOrEqual(4 * viewport.height);

  // discreción: ni un correo real en el texto -nombre propio y destino real
  // los conserva el gatekeeper en su juicio sobre la captura de (d), porque
  // "no suena a un destino inventado" no es una propiedad mecánica.
  const texto = await page.evaluate(() => document.body.innerText);
  expect(texto).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);

  // (d) captura para el juicio del gatekeeper.
  await page.screenshot({ path: "artefactos/capturas/guia.png", fullPage: true });
});
