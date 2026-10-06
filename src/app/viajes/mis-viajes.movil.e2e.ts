import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";

// viajes-ac1/ac2(b)/viajes-ac3: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL_A = "ci-test-mis-viajes@example.com";

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only, repositorio.ts): fuera del build de Next.js "server-only"
// lanza siempre, y Playwright no tiene ese alias -mismo motivo ya
// documentado en plan-timeline.movil.e2e.ts y final-ac2.e2e.ts. Un plan
// mínimo (sin paradas) basta: lo que prueba este bloque es que el listado
// enlaza al plan correcto, no el contenido del propio plan.
async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

test("mis-viajes: el listado muestra exactamente los viajes propios, enlaza al plan del completado, y «Cerrar sesión» funciona (viajes-ac1/ac5)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();

  const { data: usuarioA, error: errorA } = await supabase.auth.admin.createUser({ email: EMAIL_A, email_confirm: true });
  if (errorA || !usuarioA.user) throw new Error(`No se pudo crear el usuario A: ${errorA?.message}`);

  const { data: usuarioB, error: errorB } = await supabase.auth.admin.createUser({
    email: `mis-viajes-b-${marca}@ej.com`,
    email_confirm: true,
  });
  if (errorB || !usuarioB.user) throw new Error(`No se pudo crear el usuario B: ${errorB?.message}`);

  const planIdA = `plan-mis-viajes-a-${marca}`;
  await sembrarPlanMinimo(supabase, planIdA, planFixture.destino);
  const { data: trabajoCompletadoA, error: errorTrabajoA1 } = await supabase
    .from("trabajos")
    .insert({
      usuario_id: usuarioA.user.id,
      tipo: "generacion",
      criterios: { destino_o_tipo: planFixture.destino },
      estado: "completado",
      plan_id: planIdA,
    })
    .select("id")
    .single();
  if (errorTrabajoA1 || !trabajoCompletadoA) throw new Error(`No se pudo sembrar el trabajo completado de A: ${errorTrabajoA1?.message}`);

  const { error: errorTrabajoA2 } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioA.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Oporto" }, estado: "encolado" });
  if (errorTrabajoA2) throw new Error(`No se pudo sembrar el trabajo encolado de A: ${errorTrabajoA2.message}`);

  const planIdB = `plan-mis-viajes-b-${marca}`;
  await sembrarPlanMinimo(supabase, planIdB, "Secreto de B");
  const { data: trabajoB, error: errorTrabajoB } = await supabase
    .from("trabajos")
    .insert({
      usuario_id: usuarioB.user.id,
      tipo: "generacion",
      criterios: { destino_o_tipo: "Secreto de B" },
      estado: "completado",
      plan_id: planIdB,
    })
    .select("id")
    .single();
  if (errorTrabajoB || !trabajoB) throw new Error(`No se pudo sembrar el trabajo de B: ${errorTrabajoB?.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  // Acceso real: se pide el código, se lee de Mailpit y se canjea.
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL_A } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL_A);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL_A, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  // viajes-ac1: llega desde un acceso visible del pie, sin teclear ninguna
  // dirección. La portada también enlaza a «Mis viajes» (viajes-ac1), así
  // que hay que acotar al pie -presente en todas las páginas- para no
  // chocar con el modo estricto de Playwright.
  await pagina.goto("/");
  await pagina.locator("footer").getByRole("link", { name: "Mis viajes" }).click();
  await expect(pagina).toHaveURL("/viajes");

  await expect(pagina.getByText(planFixture.destino)).toBeVisible();
  await expect(pagina.getByText("Oporto")).toBeVisible();
  await expect(pagina.getByText("Plan listo")).toBeVisible();
  await expect(pagina.getByText("Preparando el plan…")).toBeVisible();

  // (b) nada de B aparece en el HTML servido: ni su trabajo ni su plan.
  const html = await pagina.content();
  expect(html).not.toContain(trabajoB.id);
  expect(html).not.toContain(planIdB);
  expect(html).not.toContain("Secreto de B");

  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-claro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-oscuro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "light" });

  // (c) el viaje completado enlaza a su plan, y la página de destino carga
  // con su destino visible.
  const enlacePlan = pagina.getByRole("link", { name: "Ver el itinerario" });
  await expect(enlacePlan).toHaveAttribute("href", `/plan/${planIdA}`);
  await enlacePlan.click();
  await expect(pagina).toHaveURL(`/plan/${planIdA}`);
  await expect(pagina.getByRole("heading", { name: planFixture.destino })).toBeVisible();

  // viajes-ac5: «Cerrar sesión» real, visible desde el listado, y tras
  // usarlo /viajes vuelve al panel de acceso y /api/viajes vuelve a 401.
  await pagina.goto("/viajes");
  await pagina.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(pagina.getByRole("form", { name: "Pedir acceso" })).toBeVisible();

  const respuestaTrasCierre = await contexto.request.get("/api/viajes");
  expect(respuestaTrasCierre.status()).toBe(401);

  await contexto.close();
});

// viajes-ac4: un fallo de /api/viajes se explica con un mensaje, nunca con
// una lista en blanco indistinguible del estado vacío -sin sesión real:
// interceptar la petición basta, porque lo que se prueba es la reacción del
// panel ante una respuesta que falla, no quién la sirve.
test("mis-viajes: un fallo de /api/viajes muestra un mensaje de error, no una lista vacía silenciosa (viajes-ac4)", async ({ page }) => {
  await page.route("**/api/viajes", (route) => route.fulfill({ status: 500, json: { error: "fallo forzado" } }));
  await page.goto("/viajes");

  // El filtro por texto descarta el otro role="alert" que Next.js inyecta
  // siempre (el route announcer), que si no haría fallar en modo estricto
  // -mismo patrón que acceso-ac6c.e2e.ts y pantalla-ac8.movil.e2e.ts.
  const aviso = page.getByRole("alert").filter({ hasText: /no se ha podido cargar/i });
  await expect(aviso).toBeVisible();
  await expect(page.getByText(/todavía no has pedido ningún viaje/i)).toHaveCount(0);
});
