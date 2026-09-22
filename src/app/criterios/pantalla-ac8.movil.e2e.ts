import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// usabilidad-ac8(c) define el mismo patrón: nunca reducible al código HTTP
// ni a "undefined"/"null"/"[object"/"Error:" crudos.
const REGEX_PROHIBIDA = /\b[45]\d\d\b|undefined|null|\[object|Error:/;

const DESTINO = "Tesalónica";
const EPOCA = "primavera";

async function pedirCodigoDesdeCero(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO);
  await page.getByLabel("Época del año", { exact: true }).fill(EPOCA);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(email);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(page.getByRole("form", { name: "Introducir código" })).toBeVisible();
}

// (a) código incorrecto: mensaje junto al campo, campo disponible y con
// foco, correo y criterios sobreviven -y el criterio se comprueba de
// verdad tecleando después el código correcto y confirmando que el trabajo
// encolado lleva los criterios escritos ANTES del error.
test("un código incorrecto se explica junto al campo y no pierde ni el correo ni los criterios", async ({ page }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-pantalla-ac8a@example.com";

  await pedirCodigoDesdeCero(page, email);

  const campoCodigo = page.getByLabel("Código de acceso");
  await campoCodigo.fill("000000");
  await page.getByRole("button", { name: "Confirmar código" }).click();

  // filtrado por texto: descarta el otro role="alert" que Next.js inyecta
  // siempre (el route announcer), que si no haría fallar en modo estricto.
  const mensaje = page.getByRole("alert").filter({ hasText: /código/ });
  await expect(mensaje).toBeVisible();
  await expect(mensaje).toHaveText(/no es correcto/);
  await expect(mensaje).toHaveText(/volver a intentarlo/);
  const texto = await mensaje.innerText();
  expect(texto).not.toMatch(REGEX_PROHIBIDA);

  // el campo sigue disponible, vacío y con el foco.
  await expect(campoCodigo).toBeFocused();
  await expect(campoCodigo).toHaveValue("");

  // el correo introducido no se pierde: se sigue en el paso del código,
  // sin haber vuelto al paso del correo.
  await expect(page.getByText(email)).toBeVisible();

  // los criterios escritos ANTES del error siguen intactos: se completa el
  // acceso con el código real y se comprueba el trabajo encolado.
  const codigo = await leerCodigo(email);
  await campoCodigo.fill(codigo);
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const { data: trabajo, error } = await supabase.from("trabajos").select("criterios").eq("id", id).single();
  if (error || !trabajo) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(trabajo.criterios).toMatchObject({ destino_o_tipo: DESTINO, fechas: { modo: "epoca", epoca: EPOCA } });
});

// (b) código consumido: canjeado con éxito en otro contexto de navegador y
// reintentado en el de la prueba -el mismo mensaje unificado (cod-ac2 ya
// responde el mismo 401 a incorrecto/caducado/consumido, sin distinguir
// por diseño) sigue ofreciendo pedir uno nuevo.
test("un código ya consumido en otro contexto se explica y ofrece pedir uno nuevo", async ({ page, request }) => {
  const email = "ci-test-pantalla-ac8b@example.com";

  await pedirCodigoDesdeCero(page, email);
  const codigo = await leerCodigo(email);

  // Se consume en OTRO contexto: una petición aparte, no la sesión del
  // navegador de esta prueba.
  const respuestaAjena = await request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaAjena.ok()).toBe(true);

  const campoCodigo = page.getByLabel("Código de acceso");
  await campoCodigo.fill(codigo);
  await page.getByRole("button", { name: "Confirmar código" }).click();

  const mensaje = page.getByRole("alert").filter({ hasText: /código/ });
  await expect(mensaje).toBeVisible();
  await expect(mensaje).toHaveText(/ha caducado o ya se ha usado/);
  const texto = await mensaje.innerText();
  expect(texto).not.toMatch(REGEX_PROHIBIDA);

  // ofrece pedir uno nuevo: el control de reenvío sigue en pantalla.
  await expect(page.getByRole("button", { name: /Pedir otro código/ })).toBeVisible();
});

// (c) reenvío: cuenta atrás visible de 60s sobre el estado del control, sin
// esperar a que acabe -el propio enunciado del bloque lo prohíbe (issue
// #151): nunca dormir hasta que termine una ventana de tiempo.
test("tras pedir el código, «pedir otro» queda deshabilitado con una cuenta atrás de 60s", async ({ page }) => {
  const email = "ci-test-pantalla-ac8c@example.com";
  await pedirCodigoDesdeCero(page, email);

  const botonReenvio = page.getByRole("button", { name: /Pedir otro código/ });
  await expect(botonReenvio).toBeDisabled();
  await expect(botonReenvio).toHaveText(/Pedir otro código \(\d+ s\)/);
  const segundos = Number((await botonReenvio.innerText()).match(/\((\d+) s\)/)?.[1]);
  expect(segundos).toBeGreaterThan(0);
  expect(segundos).toBeLessThanOrEqual(60);
});
