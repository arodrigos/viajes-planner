import { abrirOpciones } from "./opciones-e2e";
import { expect, test, type Browser, type BrowserContext, type Locator } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { PRESUPUESTO_MULTICIUDAD, planMulticiudadInfografia, sembrarPlan } from "./semillas-e2e";

// ip-ac1/ip-ac2/ip-ac3: la previa de la infografía dentro de la página del plan.
test.use({ viewport: { width: 390, height: 844 } });

// Un correo por test: fullyParallel los ejecuta a la vez y leerCodigo toma el
// último mensaje del correo, así que compartirlo cruzaría los códigos.
async function entrarConPlan(browser: Browser, email: string): Promise<{ contexto: BrowserContext; planId: string }> {
  const supabase = clienteDePrueba("servicio");
  const { data: lista } = await supabase.auth.admin.listUsers();
  let usuarioId = lista?.users.find((u) => u.email === email)?.id;
  if (!usuarioId) {
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    usuarioId = data.user.id;
  }
  const plan = planMulticiudadInfografia(`plan-infografia-previa-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await sembrarPlan(supabase, plan);
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { presupuesto_eur: PRESUPUESTO_MULTICIUDAD }, estado: "completado", plan_id: plan.id });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);
  return { contexto, planId: plan.id };
}

// Un clic antes de hidratar no hace nada (el HTML es estático): se repite
// hasta que el botón responde, en vez de fiarlo a una espera fija.
async function abrirPrevia(boton: Locator) {
  await expect(async () => {
    await boton.click();
    await expect(boton).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass();
}

test("«Ver infografía» enseña la lámina real en la página, sin descargar y a ancho de móvil (ip-ac1, ip-ac3)", async ({ browser }) => {
  const { contexto, planId } = await entrarConPlan(browser, "ci-test-infografia-previa-e2e@example.com");
  const pagina = await contexto.newPage();
  const peticiones: { status: number; tipo: string }[] = [];
  let pedidas = 0;
  pagina.on("request", (r) => {
    if (r.url().includes("infografia.png")) pedidas += 1;
  });
  pagina.on("response", (r) => {
    if (r.url().includes("infografia.png")) peticiones.push({ status: r.status(), tipo: r.headers()["content-type"] ?? "" });
  });
  let descargas = 0;
  pagina.on("download", () => {
    descargas += 1;
  });

  await pagina.goto(`/plan/${planId}?dia=1`);
  await abrirOpciones(pagina);
  await expect(pagina.getByRole("heading", { name: "Portugal", exact: true })).toBeVisible();
  expect(pedidas).toBe(0);

  const boton = pagina.getByRole("button", { name: "Ver infografía" });
  await abrirPrevia(boton);
  const imagen = pagina.getByRole("img", { name: "Infografía del viaje" });
  await expect(imagen).toBeVisible();
  await expect(boton).toHaveAttribute("aria-expanded", "true");
  // El PNG se genera al pedirlo: en CI tarda más que los 5 s por defecto del poll.
  await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 30_000 }).toBe(1080);
  expect(await imagen.evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(1350);
  expect(pedidas).toBe(1);
  expect(peticiones).toEqual([{ status: 200, tipo: "image/png" }]);

  const ancho = (await imagen.boundingBox())?.width ?? 0;
  expect(ancho).toBeLessThanOrEqual(390);
  expect(ancho).toBeGreaterThan(300);
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(descargas).toBe(0);
  await expect(pagina.getByRole("button", { name: "Descargar infografía" })).toBeVisible();

  // ip-ac3: la captura que lee el gatekeeper.
  await pagina.screenshot({ path: "artefactos/capturas/infografia-previa-movil.png", fullPage: true });

  // Cerrar y volver a abrir no repite la petición.
  await boton.click();
  await expect(boton).toHaveAttribute("aria-expanded", "false");
  await expect(imagen).toBeHidden();
  await boton.click();
  await expect(imagen).toBeVisible();
  expect(pedidas).toBe(1);
  await contexto.close();
});

test("la previa dice que está preparando y, si falla, explica y deja reintentar (ip-ac2)", async ({ browser }) => {
  const { contexto, planId } = await entrarConPlan(browser, "ci-test-infografia-previa-estados-e2e@example.com");
  const pagina = await contexto.newPage();
  let intento = 0;
  await pagina.route("**/infografia.png**", async (ruta) => {
    intento += 1;
    if (intento === 1) {
      await new Promise((r) => setTimeout(r, 1500));
      await ruta.fulfill({ status: 500, contentType: "application/json", body: '{"error":"fallo"}' });
    } else {
      await ruta.continue();
    }
  });
  await pagina.goto(`/plan/${planId}?dia=1`);
  await abrirOpciones(pagina);
  await expect(pagina.getByRole("heading", { name: "Portugal", exact: true })).toBeVisible();
  await abrirPrevia(pagina.getByRole("button", { name: "Ver infografía" }));
  await expect(pagina.getByRole("status").filter({ hasText: "Preparando la infografía…" })).toBeVisible();
  const alerta = pagina.getByRole("alert").filter({ hasText: "No hemos podido preparar la imagen" });
  await expect(alerta).toBeVisible({ timeout: 10_000 });
  await pagina.getByRole("button", { name: "Reintentar" }).click();
  // El reintento renderiza la imagen de verdad: en el runner del CI, con todo el
  // e2e en paralelo, supera los 5 s por defecto.
  await expect(pagina.getByRole("img", { name: "Infografía del viaje" })).toBeVisible({ timeout: 30_000 });
  await expect(alerta).toBeHidden();
  await expect.poll(() => pagina.getByRole("img", { name: "Infografía del viaje" }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1080);
  await contexto.close();
});

test("sin sesión la previa no enseña ninguna imagen: responde 401 y sale el error (ip-ac1)", async ({ browser }) => {
  const { contexto, planId } = await entrarConPlan(browser, "ci-test-infografia-previa-sinsesion-e2e@example.com");
  const pagina = await contexto.newPage();
  await pagina.goto(`/plan/${planId}?dia=1`);
  await abrirOpciones(pagina);
  await expect(pagina.getByRole("heading", { name: "Portugal", exact: true })).toBeVisible();
  await contexto.clearCookies();
  const respuesta = pagina.waitForResponse((r) => r.url().includes("infografia.png"));
  await abrirPrevia(pagina.getByRole("button", { name: "Ver infografía" }));
  expect((await respuesta).status()).toBe(401);
  await expect(pagina.getByRole("alert").filter({ hasText: "No hemos podido preparar la imagen" })).toBeVisible();
  await contexto.close();
});
