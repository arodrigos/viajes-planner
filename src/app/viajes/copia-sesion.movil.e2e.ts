import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// ses-ac1..ses-ac3: el borrado de la copia local contra el build real con su
// service worker. El corte de red es el del navegador, no un mock.
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });

const BLOQUE = "copia-y-sesion";
const CORREO = "ci-test-copia-sesion@example.com";
const DESTINO = "Oporto";
const FECHAS = ["2027-06-08", "2027-06-09"];

async function sembrarPlan(supabase: SupabaseClient, planId: string, usuarioId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: FECHAS.map((fecha) => ({ fecha, franjas: franjasComoArray(destino) })), avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { destino_o_tipo: destino }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

async function esperarControlador(pagina: Page) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
}

// Abre el plan con red y espera a que su JSON esté de verdad en la caché.
async function guardarCopia(pagina: Page, planId: string) {
  await pagina.goto(`/plan/${planId}`);
  await esperarControlador(pagina);
  await expect(pagina.getByText(/Disponible sin conexión · guardado a las \d{2}:\d{2}/).first()).toBeVisible({ timeout: 30_000 });
}

const claves = (pagina: Page, nombre: string) =>
  pagina.evaluate(async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname) : []), nombre);

test.describe("copia y sesión", () => {
  test.describe.configure({ mode: "serial" });
  let supabase: SupabaseClient;
  let usuarioId: string;
  let planA: string;
  let planB: string;
  // Pedir otro código al mismo correo en seguida lo deja sin entregar: se reutiliza la sesión.
  let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

  test.beforeAll(async () => {
    supabase = clienteDePrueba("servicio");
    const { data: usuario, error } = await supabase.auth.admin.createUser({ email: CORREO, email_confirm: true });
    if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = usuario.user.id;
    planA = `plan-cs-a-${Date.now()}`;
    planB = `plan-cs-b-${Date.now()}`;
    await sembrarPlan(supabase, planA, usuarioId, DESTINO);
    await sembrarPlan(supabase, planB, usuarioId, "Braga");
  });

  test("canjear un código borra las copias de una sesión anterior (ses-ac2)", async ({ browser }) => {
    test.setTimeout(180_000);
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pagina = await contexto.newPage();
    // Sin sesión, /viajes pide el acceso. Se siembra una copia como si fuera de la sesión anterior.
    await pagina.goto("/viajes");
    await pagina.evaluate(async () => {
      await (await caches.open("viajes-datos")).put("/api/plan/plan-anterior", new Response("{}", { headers: { "content-type": "application/json" } }));
      await (await caches.open("viajes-fotos")).put("/foto-anterior", new Response("x"));
    });
    expect(await claves(pagina, "viajes-datos")).toEqual(["/api/plan/plan-anterior"]);
    await pagina.getByLabel("Tu correo").fill(CORREO);
    await pagina.getByRole("form", { name: "Pedir acceso" }).getByRole("button").click();
    const codigo = await leerCodigo(CORREO);
    await pagina.getByLabel("Código de acceso").fill(codigo);
    await pagina.getByRole("form", { name: "Introducir código" }).getByRole("button", { name: "Confirmar código" }).click();
    await expect(pagina.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect.poll(() => pagina.evaluate(async () => [await caches.has("viajes-datos"), await caches.has("viajes-fotos")])).toEqual([false, false]);
    // Las pruebas siguientes reutilizan esta sesión: pedir otro código al mismo correo falla en CI.
    cookies = await contexto.cookies();
    await contexto.close();
  });

  test("eliminar un viaje borra solo la copia de su plan (ses-ac3)", async ({ browser }) => {
    test.setTimeout(180_000);
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pagina = await contexto.newPage();
    await contexto.addCookies(cookies);
    await guardarCopia(pagina, planA);
    await guardarCopia(pagina, planB);
    await expect.poll(() => claves(pagina, "viajes-datos")).toEqual(expect.arrayContaining([`/api/plan/${planA}`, `/api/plan/${planB}`]));

    await pagina.goto("/viajes");
    const tarjeta = pagina.locator("li", { hasText: DESTINO });
    await tarjeta.getByRole("button", { name: "Eliminar" }).click();
    await pagina.getByRole("button", { name: /Eliminar de verdad/ }).click();
    await expect(pagina.getByText(DESTINO)).toHaveCount(0);
    await expect.poll(() => claves(pagina, "viajes-datos")).toEqual([`/api/plan/${planB}`]);
    await contexto.close();
  });

  test("cerrar sesión borra las cachés aunque el POST falle, y sin red no queda nada (ses-ac1)", async ({ browser }) => {
    test.setTimeout(180_000);
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    await contexto.addCookies(cookies);
    const pagina = await contexto.newPage();
    await guardarCopia(pagina, planB);
    await pagina.goto("/viajes");
    await expect(pagina.getByText("Braga")).toBeVisible();
    expect(await pagina.evaluate(() => caches.has("viajes-datos"))).toBe(true);

    // El cierre de sesión falla a propósito: la limpieza local no depende de él.
    await contexto.route("**/api/auth/cerrar-sesion", (ruta) => ruta.abort());
    await pagina.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect.poll(() => pagina.evaluate(async () => [await caches.has("viajes-datos"), await caches.has("viajes-fotos")])).toEqual([false, false]);
    await contexto.unroute("**/api/auth/cerrar-sesion");

    await contexto.setOffline(true);
    await pagina.goto(`/plan/${planB}`);
    await expect(pagina.getByText("Este plan no está guardado en este dispositivo")).toBeVisible();
    await capturar(pagina, BLOQUE, "tras-cerrar-sesion");
    await pagina.goto("/viajes");
    await expect(pagina).toHaveURL(/\/sin-conexion$/);
    await expect(pagina.getByRole("heading", { name: "Planes guardados en este dispositivo" })).toBeVisible();
    await expect(pagina.getByText(/Aún no hay planes guardados/)).toBeVisible();
    await contexto.close();
  });
});
