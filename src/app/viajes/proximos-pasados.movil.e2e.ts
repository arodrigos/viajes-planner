import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { comprobarAccesibilidad } from "@/app/axe-e2e";

test.use({ viewport: { width: 390, height: 844 } });

const EMAIL = "ci-test-proximos-pasados@example.com";

function iso(desplazamientoDias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function sembrarViaje(
  supabase: SupabaseClient,
  usuarioId: string,
  marca: number,
  destino: string,
  inicio: number,
  fin: number,
): Promise<string> {
  const planId = `plan-pp-${destino.slice(0, 4).toLowerCase()}-${marca}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const { error } = await supabase.from("trabajos").insert({
    usuario_id: usuarioId,
    tipo: "generacion",
    criterios: { destino_o_tipo: destino, fechas: { modo: "fechas", inicio: iso(inicio), fin: iso(fin) } },
    estado: "completado",
    plan_id: planId,
  });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
  return planId;
}

// txt-ac1-a: el reparto va por el último día del viaje, y los viajes se
// siembran con fechas relativas al día de hoy (un margen de decenas de días,
// salvo el «en curso», que solo cruza hoy) para no depender de un reloj fijo.
test("mis-viajes: separa próximos, en curso y pasados; tocar uno abre su plan sin ?dia (txt-ac1-a)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);

  const idRoma = await sembrarViaje(supabase, usuario.user.id, marca, "Roma (ejemplo)", 10, 13);
  await sembrarViaje(supabase, usuario.user.id, marca, "Lisboa (ejemplo)", -62, -60);
  await sembrarViaje(supabase, usuario.user.id, marca, "Turín (ejemplo)", -1, 1);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(verificacion.ok()).toBe(true);

  await pagina.goto("/viajes");
  const proximos = pagina.getByRole("region", { name: "Próximos" });
  const pasados = pagina.getByRole("region", { name: "Pasados" });
  await expect(proximos.getByText("Roma (ejemplo)")).toBeVisible();
  await expect(proximos.getByText("Turín (ejemplo)")).toBeVisible();
  await expect(proximos.getByText("Lisboa (ejemplo)")).toHaveCount(0);
  await expect(pasados.getByText("Lisboa (ejemplo)")).toBeVisible();
  await expect(pasados.getByText("Roma (ejemplo)")).toHaveCount(0);

  await comprobarAccesibilidad(pagina);
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-proximos-pasados.png", fullPage: true });

  await proximos.getByRole("listitem").filter({ hasText: "Roma (ejemplo)" }).getByRole("link", { name: "Ver el itinerario" }).click();
  await expect(pagina).toHaveURL(`/plan/${idRoma}`);
  // El destino aún es un h2 hasta que vista-por-dias estrene el h1 de la cabecera: se comprueba el título sea cual sea su nivel.
  await expect(pagina.getByRole("heading", { name: "Roma (ejemplo)" })).toBeVisible();

  await contexto.close();
});

// mv-ac1..ac5: cinco viajes sembrados en un orden de creación distinto del
// esperado; fechas relativas a hoy para no depender de un reloj fijo.
test("mis-viajes: orden, rango legible con año, situación y accesibilidad (mv-ac1..ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const correo = "ci-test-mis-viajes-fechas@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);

  await sembrarViaje(supabase, usuario.user.id, marca, "Roma (ejemplo)", 30, 33);
  await sembrarViaje(supabase, usuario.user.id, marca, "Sevilla (ejemplo)", -62, -60);
  const idOporto = await sembrarViaje(supabase, usuario.user.id, marca, "Oporto (ejemplo)", -1, 2);
  await sembrarViaje(supabase, usuario.user.id, marca, "Atenas (ejemplo)", -12, -10);
  await sembrarViaje(supabase, usuario.user.id, marca, "Lisboa (ejemplo)", 5, 8);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: correo } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(correo);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: correo, codigo } });
  expect(verificacion.ok()).toBe(true);

  await pagina.goto("/viajes");
  const proximos = pagina.getByRole("region", { name: "Próximos" });
  const pasados = pagina.getByRole("region", { name: "Pasados" });
  await expect(proximos.getByRole("listitem").first()).toBeVisible();

  const destinos = async (region: typeof proximos) =>
    (await region.getByRole("listitem").locator("strong").allTextContents()).map((t) => t.trim());
  expect(await destinos(proximos)).toEqual(["Oporto (ejemplo)", "Lisboa (ejemplo)", "Roma (ejemplo)"]);
  expect(await destinos(pasados)).toEqual(["Atenas (ejemplo)", "Sevilla (ejemplo)"]);

  // mv-ac4: situación y cuenta atrás; los pasados no llevan ninguna.
  const tarjeta = (destino: string) => pagina.getByRole("listitem").filter({ hasText: destino });
  await expect(tarjeta("Oporto (ejemplo)")).toContainText("En curso · día 2 de 4");
  await expect(tarjeta("Lisboa (ejemplo)")).toContainText("Empieza dentro de 5 días");
  await expect(tarjeta("Roma (ejemplo)")).toContainText("Empieza dentro de 30 días");
  await expect(pasados).not.toContainText(/Empieza|En curso/);

  // mv-ac2/ac3: fechas en <time> con año, nunca AAAA-MM-DD, estado en palabras.
  const textoLista = await pagina.locator("main").textContent();
  expect(textoLista).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(textoLista).not.toMatch(/en-curso|encolado|completado|caducado/);
  const tiempos = pagina.locator("main time");
  expect(await tiempos.count()).toBe(5);
  for (const t of await tiempos.all()) {
    await expect(t).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
    expect(await t.textContent()).toMatch(/\d{4}/);
  }

  // mv-ac5
  await comprobarAccesibilidad(pagina);
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-fechas.png", fullPage: true });

  // mv-ac1: el primero de Próximos abre su plan, sin parámetro dia.
  await proximos.getByRole("listitem").first().getByRole("link", { name: "Abrir hoy" }).click();
  await expect(pagina).toHaveURL(`/plan/${idOporto}`);
  await expect(pagina.getByRole("heading", { name: "Oporto (ejemplo)" })).toBeVisible();

  await contexto.close();
});

// txt-ac1-a, límite: sin viajes hay un estado vacío con salida; sin sesión de
// por medio, porque lo que se prueba es cómo reacciona el panel a la API.
test("mis-viajes: sin viajes explica qué hacer y enlaza a crear uno (txt-ac1-a, txt-ac3)", async ({ page }) => {
  await page.route("**/api/viajes", (route) => route.fulfill({ json: { correo: "ejemplo@example.com", viajes: [] } }));
  await page.goto("/viajes");
  await expect(page.getByText("Todavía no has pedido ningún viaje.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cuéntanos tu viaje" })).toHaveAttribute("href", "/criterios");
  await comprobarAccesibilidad(page);
});

// txt-ac4: el error dice qué hacer y el botón vuelve a pedir la lista.
test("mis-viajes: un error de la API ofrece reintentar y se recupera (txt-ac4)", async ({ page }) => {
  let llamadas = 0;
  await page.route("**/api/viajes", (route) => {
    llamadas += 1;
    if (llamadas === 1) return route.fulfill({ status: 500, json: { error: "fallo forzado" } });
    return route.fulfill({ json: { correo: "ejemplo@example.com", viajes: [] } });
  });
  await page.goto("/viajes");

  const aviso = page.getByRole("alert").filter({ hasText: /no se ha podido cargar/i });
  await expect(aviso).toContainText("Vuelve a intentarlo");
  await comprobarAccesibilidad(page);
  await page.screenshot({ path: "artefactos/capturas/mis-viajes-error.png", fullPage: true });

  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Todavía no has pedido ningún viaje.")).toBeVisible();
  await expect(aviso).toHaveCount(0);
});
