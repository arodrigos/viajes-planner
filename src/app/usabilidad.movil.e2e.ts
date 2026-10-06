import { expect, test, type Page } from "@playwright/test";
import { abrirOpciones } from "./plan/[id]/opciones-e2e";

// usabilidad-ac8: solo corre en el proyecto 'movil' -mismo motivo que
// guia.movil.e2e.ts, el viewport real es el que hace que "sin hacer scroll"
// y "junto al origen del problema" signifiquen algo comprobable.

// usabilidad-ac8(c): ningún mensaje puede reducirse al código HTTP, a
// "undefined"/"null" filtrados desde el JSON de error, ni a un "Error:"
// crudo -eso es justo lo que produce un manejador que solo hace
// `String(error)` en vez de escribir una frase para quien lee.
const REGEX_PROHIBIDA = /\b[45]\d\d\b|undefined|null|\[object|Error:/;

const TRABAJO_ENCOLADO = {
  id: "trabajo-usabilidad-e2e",
  estado: "encolado",
  etapa: null,
  porcentaje: 0,
  motivo: null,
  reintento_no_antes_de: null,
};

const TRABAJO_PAUSADO = {
  id: "trabajo-usabilidad-e2e",
  estado: "pausado-por-cuota",
  etapa: null,
  porcentaje: 0,
  motivo: "límite de uso del modelo alcanzado",
  reintento_no_antes_de: "2026-09-20T10:00:00Z",
};

const PLAN_FIXTURE = { id: "plan-usabilidad-e2e", destino: "Sevilla", dias: [], avisos: [] };

async function sinTitleYConDescripcionesVisibles(page: Page) {
  // usabilidad-ac8(a): cero controles con `title` -no hay hover en táctil-,
  // y todo `aria-describedby` apunta a un elemento realmente visible y con
  // texto, no a un id huérfano que un lector de pantalla no puede alcanzar.
  await expect(page.locator("[title]")).toHaveCount(0);

  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-describedby]")).flatMap((el) => el.getAttribute("aria-describedby")!.split(/\s+/)),
  );
  for (const id of ids) {
    const objetivo = page.locator(`#${id}`);
    await expect(objetivo, `aria-describedby="${id}"`).toBeVisible();
    expect((await objetivo.innerText()).trim().length, `aria-describedby="${id}" sin texto`).toBeGreaterThan(0);
  }
}

test("sin atributos title y con toda ayuda aria-describedby visible, en las cuatro páginas", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_ENCOLADO }));
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));

  for (const ruta of ["/", "/criterios", "/trabajos/trabajo-usabilidad-e2e", "/plan/plan-usabilidad-e2e"]) {
    await page.goto(ruta);
    // La ayuda del calendario y de regenerar solo se ve con el menú abierto.
    if (ruta.startsWith("/plan/")) await abrirOpciones(page);
    await sinTitleYConDescripcionesVisibles(page);
  }
});

// usabilidad-ac8(b): el aviso de confirmación de correo está ANTES de
// cualquier interacción, no solo cuando el envío falla con 401.
test("el formulario de criterios avisa de la confirmación de correo antes de interactuar", async ({ page }) => {
  await page.goto("/criterios");
  await expect(page.getByText(/confirmes tu correo/)).toBeVisible();
});

for (const [nombre, fixture] of [
  ["encolado", TRABAJO_ENCOLADO],
  ["pausado-por-cuota", TRABAJO_PAUSADO],
] as const) {
  // usabilidad-ac8(b): >=80 caracteres visibles explicando el estado, más el
  // aviso de que la dirección es la única forma de volver -no una espera
  // muda ni un simple "espera, por favor".
  test(`el estado "${nombre}" explica qué pasa y avisa de guardar la dirección`, async ({ page }) => {
    await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: fixture }));
    await page.goto(`/trabajos/${fixture.id}`);

    const texto = await page.locator("main, body").first().innerText();
    expect(texto.trim().length).toBeGreaterThanOrEqual(80);
    await expect(page.getByText(/esta dirección es la única forma de encontrar este trabajo/)).toBeVisible();
  });
}

test("el plan ya no avisa de que su dirección es la única forma de volver (dia-ac5)", async ({ page }) => {
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));
  await page.goto("/plan/plan-usabilidad-e2e?dia=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/única forma de volver/)).toHaveCount(0);
});

// usabilidad-ac8(c): un mensaje por cada forma real de fallo, comprobando
// forma (nunca solo presencia) y una salida accionable.
test("los criterios inválidos (400) se explican junto al formulario, sin código ni salida", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 400, json: { error: "invalido" } }));
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Sevilla");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();

  const mensaje = page.getByRole("alert").filter({ hasText: /criterios/ });
  await expect(mensaje).toBeVisible();
  await expect(mensaje).not.toHaveText(REGEX_PROHIBIDA);
  await expect(mensaje).toHaveText(/inténtalo de nuevo/);
});

test("sin sesión (401) al enviar los criterios lleva a pedir acceso, no a un error críptico", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 401, json: { error: "no autenticado" } }));
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Sevilla");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("button", { name: "Pedir código de acceso" })).toBeVisible();
});

// pantalla-ac8(d): la respuesta de solicitar-codigo es uniforme para un
// correo autorizado y uno que no lo está -ya no hay un 403 diferenciado que
// probar aquí; esa no-diferenciación se comprueba contra el servidor real en
// solicitarCodigo.integration.test.ts, comparando las dos respuestas byte a
// byte.

test("el límite de envíos (429) explica que lo escrito no se pierde", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 429, json: { error: "límite" } }));
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Sevilla");
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();

  const mensaje = page.getByRole("alert").filter({ hasText: /límite/ });
  await expect(mensaje).toBeVisible();
  await expect(mensaje).not.toHaveText(REGEX_PROHIBIDA);
  await expect(mensaje).toHaveText(/no se pierde/);
});

test("un fallo de red al consultar el trabajo ofrece una salida, no un error críptico", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.abort("failed"));
  await page.goto("/trabajos/trabajo-usabilidad-e2e");

  const mensaje = page.getByRole("alert").filter({ hasText: /consultar el trabajo/ });
  await expect(mensaje).toBeVisible();
  await expect(mensaje).not.toHaveText(REGEX_PROHIBIDA);
  await expect(mensaje).toHaveText(/revisa tu conexión|vuelve a intentarlo/);
});

test("una sesión caducada a mitad de espera ofrece volver a entrar", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ status: 401, json: { error: "no autenticado" } }));
  await page.goto("/trabajos/trabajo-usabilidad-e2e");

  await expect(page.getByText("Tu sesión ha caducado.")).toBeVisible();
  await expect(page.getByRole("link", { name: "/criterios" })).toBeVisible();
});

// usabilidad-ac8(d): capturas representativas para que el gatekeeper juzgue
// si el texto de ayuda nuevo convirtió alguna pantalla en un muro de texto.
test("capturas de los cuatro estados nuevos para juicio visual", async ({ page }) => {
  await page.goto("/criterios");
  await page.screenshot({ path: "artefactos/capturas/usabilidad-criterios.png", fullPage: true });

  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_ENCOLADO }));
  await page.goto("/trabajos/trabajo-usabilidad-e2e");
  await page.screenshot({ path: "artefactos/capturas/usabilidad-trabajos-encolado.png", fullPage: true });

  await page.unroute("**/api/trabajos/*");
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_PAUSADO }));
  await page.goto(`/trabajos/${TRABAJO_PAUSADO.id}`);
  await page.screenshot({ path: "artefactos/capturas/usabilidad-trabajos-pausado.png", fullPage: true });

  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));
  await page.goto("/plan/plan-usabilidad-e2e?dia=1");
  await page.screenshot({ path: "artefactos/capturas/usabilidad-plan.png", fullPage: true });
});
