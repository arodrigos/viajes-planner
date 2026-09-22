import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const EMAIL = "ci-test-pantalla-ac5@example.com";
const DESTINO = "Oporto";
const EPOCA = "otoño";
const DIAS = 7;
const PRESUPUESTO = 900;
const EDAD = 29;

// pantalla-ac5: EL criterio de las dos razones del bloque. Corre en el
// proyecto `movil` (viewport de teléfono real) y contra la pila local con
// `site_url = http://127.0.0.1:9999` en supabase/config.toml -un origen
// donde no corre nada-, así que si el producto todavía dependiera de esa
// URL para construir un enlace, este test no tendría con qué navegar.
test("sin sesión previa, pedir y teclear el código en la misma pestaña encola el trabajo escrito", async ({ page, baseURL }) => {
  const supabase = clienteDePrueba("servicio");

  // Escucha de navegaciones de principio a fin: la prueba mecánica de que
  // el usuario no sale nunca de la pestaña. `/auth/**` ya no existe, y
  // cualquier navegación a un origen distinto del de la app delataría que
  // algo sigue construyendo una URL contra `site_url`.
  const navegaciones: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navegaciones.push(frame.url());
  });

  // (a) rellenar /criterios con criterios válidos.
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO);
  await page.getByLabel("Época del año", { exact: true }).fill(EPOCA);
  await page.getByLabel("Número de días").fill(String(DIAS));
  await page.getByLabel("Presupuesto total (€)").fill(String(PRESUPUESTO));
  await page.getByLabel("Persona 1, edad").fill(String(EDAD));

  // (b) borrar localStorage justo después de escribirlos: si el producto
  // volviera a depender de que el borrador sobreviva a un salto de
  // contexto -el flujo anterior, del enlace mágico-, este test se pondría
  // rojo aquí, no al final.
  await page.evaluate(() => localStorage.clear());

  // (c) pulsar «Continuar» y comprobar que aparece el paso del correo.
  await page.getByRole("button", { name: "Continuar" }).click();
  const pasoEmail = page.getByRole("form", { name: "Pedir acceso" });
  await expect(pasoEmail).toBeVisible();

  // (d) introducir el correo y pedir el código.
  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  const pasoCodigo = page.getByRole("form", { name: "Introducir código" });
  await expect(pasoCodigo).toBeVisible();

  // (e) leer el CÓDIGO REAL del servidor de correo de la pila, sin
  // interceptar la llamada a Supabase.
  const codigo = await leerCodigo(EMAIL);

  // (f) teclearlo en el campo de la MISMA página y enviar.
  await page.getByLabel("Código de acceso").fill(codigo);
  await page.getByRole("button", { name: "Confirmar código" }).click();

  // (g) el navegador acaba en /trabajos/<id>.
  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  // (h) fila real en `trabajos` con ese id, encolado, con lo escrito en (a).
  const { data: trabajo, error } = await supabase.from("trabajos").select("estado, criterios").eq("id", id).single();
  if (error || !trabajo) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(trabajo.estado).toBe("encolado");
  expect(trabajo.criterios).toMatchObject({
    destino_o_tipo: DESTINO,
    fechas: { modo: "epoca", epoca: EPOCA },
    dias: DIAS,
    presupuesto_eur: PRESUPUESTO,
    personas: [{ edad: EDAD }],
  });

  // Ninguna navegación a /auth/** ni a un origen distinto del de la app.
  for (const url of navegaciones) {
    expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
    expect(new URL(url).pathname.startsWith("/auth")).toBe(false);
  }
});
