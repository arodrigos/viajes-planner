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
        motivo: "límite de uso del modelo alcanzado",
        reintento_no_antes_de: "2026-09-20T10:00:00Z",
      },
    }),
  );

  await page.goto("/trabajos/abc");
  await expect(page.getByText("límite de uso del modelo alcanzado")).toBeVisible();
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

// txt-ac2: mientras el trabajo espera, la pantalla explica por qué no
// vuelve a pedir el código -sigue con la sesión que se abrió al teclearlo-,
// en vez de dejar la ausencia de ese paso sin explicar.
test("mientras el trabajo está encolado, explica que sigue con la sesión iniciada", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: { id: "abc", estado: "encolado", etapa: null, porcentaje: 0, motivo: null, reintento_no_antes_de: null },
    }),
  );

  await page.goto("/trabajos/abc");
  const aviso = page.getByText(/sesión que iniciaste/i);
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveText(/no hace falta que vuelvas a pedirlo/);
});

// acceso-ac6(d): un 401 a mitad de espera (el JWT de una hora caducó antes
// que el trabajo) explica que hay que volver a entrar, en vez de repetir el
// genérico "no se ha podido consultar" que no dice qué ha pasado.
test("un 401 a mitad de espera explica que la sesión ha caducado, no un error genérico", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ status: 401, json: { error: "no autenticado" } }));

  await page.goto("/trabajos/abc");
  await expect(page.getByText("Tu sesión ha caducado.")).toBeVisible();
  await expect(page.getByRole("link", { name: "/criterios" })).toBeVisible();
});

// final-ac3: un trabajo completado es el final del recorrido, no otro
// estado de espera. La API real (que la consulta lee y publica plan_id
// respetando la propiedad) ya está probada contra Postgres real en
// consultar.integration.test.ts y contra HTTP real en final-ac2.e2e.ts;
// aquí, como en el resto de este fichero, se aísla la capa de presentación
// con la red doblada.
test("un trabajo completado deja de girar y enlaza al plan, no a la barra de progreso", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "completado",
        etapa: "guardando",
        porcentaje: 100,
        motivo: null,
        reintento_no_antes_de: null,
        plan_id: "plan-progreso-e2e",
      },
    }),
  );

  await page.goto("/trabajos/abc");

  // (a) contra el código de antes de este bloque esto falla: un completado
  // caía en la rama por defecto y seguía enseñando la barra con el nombre
  // de la etapa indefinidamente.
  await expect(page.locator("progress")).toHaveCount(0);
  await expect(page.getByText("guardando")).toHaveCount(0);

  // final-ac3(c), regresión: el <h1> era fijo ("Tu viaje se está
  // generando") y contradecía este mismo estado ("Tu viaje está listo").
  // Contra el código de antes de esta tanda, el heading sigue diciendo
  // "generando" y esta aserción falla.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu viaje está listo");

  const enlace = page.getByRole("link", { name: "Ver el itinerario" });
  await expect(enlace).toBeVisible();
  await expect(enlace).toHaveAttribute("href", "/plan/plan-progreso-e2e");
  // final-ac3(c): el enlace es la ACCIÓN PRINCIPAL, con el mismo estilo de
  // botón que el CTA de la portada -no texto corrido sin marcar.
  await expect(enlace).toHaveClass(/\bboton-principal\b/);

  // (b) el aviso se mueve, no desaparece: ahora señala la dirección del
  // PLAN como la que hay que guardar, no la de esta pantalla. Ya no lleva
  // la caja con borde destacado (`.aviso`) que competía en peso visual con
  // el enlace principal: es una nota secundaria (`.ayuda`).
  const aviso = page.getByText(/dirección que conviene guardar es la del plan/);
  await expect(aviso).toBeVisible();
  expect((await aviso.innerText()).length).toBeGreaterThanOrEqual(60);
  await expect(aviso).toHaveClass(/\bayuda\b/);
});

// final-ac4: estado límite sin dato -una fila completada antes de esta
// tanda, o una escritura a medias, puede no tener plan_id.
test("un trabajo completado sin plan_id no produce un enlace roto, y explica qué hacer", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) =>
    route.fulfill({
      json: {
        id: "abc",
        estado: "completado",
        etapa: "guardando",
        porcentaje: 100,
        motivo: null,
        reintento_no_antes_de: null,
        plan_id: null,
      },
    }),
  );

  await page.goto("/trabajos/abc");

  // Regresión del mismo fallo que final-ac3(c): el <h1> ya no puede decir
  // "generando" cuando el trabajo terminó, con o sin plan_id.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu viaje ha terminado");

  const enlacesRotos = page.locator('a[href*="null"], a[href*="undefined"]');
  await expect(enlacesRotos).toHaveCount(0);

  const mensaje = page.getByText(/itinerario no está disponible/);
  await expect(mensaje).toBeVisible();
  expect((await mensaje.innerText()).length).toBeGreaterThanOrEqual(60);
  const textoCompleto = (await page.locator("main, body").first().innerText()).trim();
  expect(textoCompleto).not.toMatch(/\b[45]\d\d\b|undefined|null|\[object|Error:/);
});
