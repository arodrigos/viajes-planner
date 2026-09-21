import { expect, test } from "@playwright/test";

// pantalla-ac7(a): la ruta del enlace mágico no responde ni por accidente.
// Contra la aplicación construida de verdad (webServer de playwright.config.ts
// hace `next build && next start`), así que un 404 aquí es el de producción,
// no el del servidor de desarrollo.
test("GET /auth/confirm responde 404: la ruta del enlace mágico ya no existe", async ({ request }) => {
  const respuesta = await request.get("/auth/confirm?token_hash=cualquiera&type=magiclink");
  expect(respuesta.status()).toBe(404);
});
