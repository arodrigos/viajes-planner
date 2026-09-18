import { expect, test } from "@playwright/test";

// vista-ac1 (interfaz): el nombre de la etapa se ve, no una barra genérica,
// y cada estado que no es éxito se explica con su motivo y, cuando lo hay,
// con su hora de reanudación. La API real (estado, etapa, caducidad,
// propiedad del trabajo) ya está probada contra Postgres real en
// consultar.integration.test.ts; aquí se aísla la capa de presentación con
// una respuesta de red interceptada, que es lo único que un test de
// navegador puede aportar por encima de eso.
test("muestra el nombre de la etapa en curso, no una barra genérica", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "en-curso",
        etapa: "verificando sitios",
        porcentaje: 38,
        motivo: null,
        reintento_no_antes_de: null,
      },
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
        reintento_no_antes_de: null,
      },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("El trabajo ha caducado.")).toBeVisible();
  await expect(page.getByText("el trabajador no ha recogido el trabajo a tiempo")).toBeVisible();
});

test("un trabajo pausado por cuota explica el motivo y la hora de reanudación", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "pausado-por-cuota",
        etapa: null,
        porcentaje: 0,
        motivo: "reserva-de-flota",
        reintento_no_antes_de: "2026-09-20T10:00:00Z",
      },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("reserva-de-flota")).toBeVisible();
  await expect(page.getByText(/Se retomará a partir de/)).toBeVisible();
});

test("un trabajo fallido explica el motivo", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "fallido",
        etapa: null,
        porcentaje: 0,
        motivo: "la respuesta del modelo no es JSON válido",
        reintento_no_antes_de: null,
      },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("No se ha podido generar el viaje.")).toBeVisible();
  await expect(page.getByText("la respuesta del modelo no es JSON válido")).toBeVisible();
});
