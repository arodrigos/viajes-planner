import { expect, test } from "@playwright/test";

// cola-ac3 (interfaz): el nombre de la etapa se ve, no una barra genérica;
// un trabajo caducado lo dice con su motivo. La API real (estado, etapa,
// caducidad, propiedad del trabajo) ya está probada contra Postgres real en
// consultar.integration.test.ts; aquí se aísla la capa de presentación con
// una respuesta de red interceptada, que es lo único que un test de
// navegador puede aportar por encima de eso.
test("muestra el nombre de la etapa en curso, no una barra genérica", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: { id: "abc", estado: "en-curso", etapa: "verificando sitios", porcentaje: 38, motivo: null },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("verificando sitios")).toBeVisible();
});

test("un trabajo caducado explica el motivo en vez de seguir esperando", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "caducado",
        etapa: null,
        porcentaje: 0,
        motivo: "el trabajador no ha recogido el trabajo a tiempo",
      },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("El trabajo ha caducado.")).toBeVisible();
  await expect(page.getByText("el trabajador no ha recogido el trabajo a tiempo")).toBeVisible();
});
