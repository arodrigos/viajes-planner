import { expect, test, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// fic-ac1, fic-ac3, fic-ac5, fic-ac6: el panel de Google contra la ruta real.
// Lo único doblado es el script de Google: se sirve un custom element falso
// que emite gmp-load o gmp-requesterror, así el CI nunca gasta cupo.
test.use({ viewport: { width: 393, height: 851 } });

const DESTINO = "Lisboa";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
const SUFIJO = Date.now();
const PARADAS = [
  { id: "p-ficha-1", nombre: "Museo de prueba uno", franja: "manana", lugar: `osm:node/ficha-1-${SUFIJO}`, estado: "casado", placeId: "ChIJ-prueba-1" },
  { id: "p-ficha-2", nombre: "Museo de prueba dos", franja: "comida", lugar: `osm:node/ficha-2-${SUFIJO}`, estado: "casado", placeId: "ChIJ-prueba-2" },
  { id: "p-ficha-3", nombre: "Sitio sin coincidencia", franja: "tarde", lugar: `osm:node/ficha-3-${SUFIJO}`, estado: "sin-coincidencia", placeId: null },
  { id: "p-ficha-4", nombre: "Sitio sin verificar", franja: "noche", lugar: null, estado: null, placeId: null },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-ficha-e2e-${SUFIJO}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const dias = [{ fecha: "2027-06-09", franjas: franjasComoArray(DESTINO) }];
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: p.lugar ? "osm" : "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita de prueba",
      lat: p.lugar ? 38.7 : null,
      lon: p.lugar ? -9.1 : null,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: p.lugar
        ? { fuente: "osm", id: p.lugar, url: "https://www.openstreetmap.org/node/1", nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN }
        : null,
      resolucion: p.lugar ? { estado: "resuelta", intentado_en: RESUELTO_EN } : { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ningún candidato aceptable" },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
    if (p.estado) {
      const { error: errorLugar } = await supabase
        .from("lugares_google")
        .upsert({ clave: p.lugar, place_id: p.placeId, estado: p.estado, comprobado_en: new Date().toISOString() });
      if (errorLugar) throw new Error(`No se pudo sembrar lugares_google: ${errorLugar.message}`);
    }
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

// El script que sustituye al de Google. Imita lo mínimo del cargador: define
// importLibrary antes de avisar con el callback, y registra los elementos.
function scriptFalso(modo: "carga" | "no-encontrado"): string {
  const evento = modo === "carga" ? `new Event("gmp-load")` : `Object.assign(new Event("gmp-requesterror"), { error: { code: "NOT_FOUND" } })`;
  return `
    window.google = window.google || {};
    google.maps = google.maps || {};
    google.maps.importLibrary = async () => ({});
    class Falso extends HTMLElement {
      connectedCallback() {
        if (this.tagName !== "GMP-PLACE-DETAILS") return;
        this.style.display = "block";
        this.textContent = "Ficha de prueba";
        setTimeout(() => this.dispatchEvent(${evento}), 0);
      }
    }
    if (!customElements.get("gmp-place-details")) customElements.define("gmp-place-details", Falso);
    const callback = new URL(document.currentScript.src).searchParams.get("callback");
    if (callback) callback.split(".").reduce((o, k, i, a) => (i === a.length - 1 ? o[k]() : o[k]), window);
  `;
}

async function abrir(browser: Browser, email: string, planId: string, modo: "carga" | "no-encontrado" = "carga") {
  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  const peticionesGoogle: string[] = [];
  await pagina.route(/(googleapis|gstatic)\.com/, async (ruta) => {
    peticionesGoogle.push(ruta.request().url());
    await ruta.fulfill({ contentType: "text/javascript", body: scriptFalso(modo) });
  });
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(verificacion.ok()).toBe(true);
  const posts: Array<Record<string, unknown>> = [];
  pagina.on("request", (r) => {
    if (r.url().endsWith("/api/google/ficha") && r.method() === "POST") posts.push(r.postDataJSON());
  });
  await pagina.goto(`/plan/${planId}`);
  return { contexto, pagina, peticionesGoogle, posts };
}

const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { hasText: nombre });
const resumen = (pagina: Page, nombre: string) => tarjeta(pagina, nombre).locator("summary", { hasText: "Opiniones y horario · Google Maps" });
const sinScrollHorizontal = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("panel de Google", () => {
  let supabase: SupabaseClient;
  let planId: string;

  test.beforeAll(async () => {
    supabase = clienteDePrueba("servicio");
    planId = await sembrar(supabase, "ci-test-ficha-e2e@example.com");
  });

  test("abrir monta la ficha una vez, reserva una carga y reabrir no repite (fic-ac1, fic-ac5)", async ({ browser }) => {
    const { contexto, pagina, peticionesGoogle, posts } = await abrir(browser, "ci-test-ficha-e2e@example.com", planId);
    expect(peticionesGoogle).toHaveLength(0);
    expect(posts).toHaveLength(0);

    await resumen(pagina, "Museo de prueba uno").click();
    const ficha = tarjeta(pagina, "Museo de prueba uno").locator("gmp-place-details");
    await expect(ficha).toHaveCount(1);
    await expect(ficha).toBeVisible();
    expect(posts).toEqual([{ planId, paradaId: "p-ficha-1" }]);
    await expect(tarjeta(pagina, "Museo de prueba uno").locator("gmp-place-details-place-request")).toHaveAttribute("place", "ChIJ-prueba-1");
    await expect(tarjeta(pagina, "Museo de prueba uno").locator("gmp-place-price")).toHaveCount(0);
    await expect(tarjeta(pagina, "Museo de prueba uno").getByRole("link", { name: "Qué datos salen" })).toHaveAttribute("href", "/privacidad");

    await resumen(pagina, "Museo de prueba uno").click();
    await resumen(pagina, "Museo de prueba uno").click();
    await expect(ficha).toHaveCount(1);
    expect(posts).toHaveLength(1);

    expect(await sinScrollHorizontal(pagina)).toBe(true);
    await comprobarAccesibilidad(pagina, ["gmp-place-details"]);
    await capturar(pagina, "ficha-google", "casada");
    await contexto.close();
  });

  test("sin verificar o sin coincidencia: su mensaje, el enlace a Maps y ningún POST (fic-ac3)", async ({ browser }) => {
    const { contexto, pagina, posts } = await abrir(browser, "ci-test-ficha-e2e@example.com", planId);
    await resumen(pagina, "Sitio sin verificar").click();
    await expect(tarjeta(pagina, "Sitio sin verificar").getByText("Este sitio no tiene la ubicación comprobada; sin ella no buscamos opiniones, para no confundirlo con otro.")).toBeVisible();
    await expect(tarjeta(pagina, "Sitio sin verificar").getByRole("link", { name: "Abrir en Google Maps" })).toBeVisible();

    await resumen(pagina, "Sitio sin coincidencia").click();
    await expect(tarjeta(pagina, "Sitio sin coincidencia").getByText("No lo hemos encontrado en Google Maps con seguridad, así que no enseñamos opiniones de otro sitio.")).toBeVisible();
    expect(posts).toHaveLength(0);
    expect(await sinScrollHorizontal(pagina)).toBe(true);
    await capturar(pagina, "ficha-google", "sin-coincidencia");
    await contexto.close();
  });

  test("cupo agotado (429): mensaje, enlace a Maps y ningún elemento (fic-ac1, fic-ac3)", async ({ browser }) => {
    const { contexto, pagina } = await abrir(browser, "ci-test-ficha-e2e@example.com", planId);
    await pagina.route("**/api/google/ficha", (ruta) => ruta.fulfill({ status: 429, json: { motivo: "cupo-agotado" } }));
    await resumen(pagina, "Museo de prueba dos").click();
    const carta = tarjeta(pagina, "Museo de prueba dos");
    await expect(carta.getByText("Hoy ya se ha consultado Google todas las veces previstas para no pagar; vuelve mañana.")).toBeVisible();
    await expect(carta.getByRole("link", { name: "Abrir en Google Maps" })).toBeVisible();
    await expect(carta.locator("gmp-place-details")).toHaveCount(0);
    expect(await sinScrollHorizontal(pagina)).toBe(true);
    await capturar(pagina, "ficha-google", "cupo");
    await contexto.close();
  });

  test("un place_id que Google no reconoce se marca obsoleto y Reintentar hace otro POST (fic-ac3, fic-ac6)", async ({ browser }) => {
    const { contexto, pagina, posts } = await abrir(browser, "ci-test-ficha-e2e@example.com", planId, "no-encontrado");
    await resumen(pagina, "Museo de prueba dos").click();
    const carta = tarjeta(pagina, "Museo de prueba dos");
    await expect(carta.getByRole("alert")).toContainText("No se ha podido cargar la ficha de Google");
    await expect(carta.getByRole("button", { name: "Reintentar" })).toBeVisible();
    expect(posts).toContainEqual({ planId, paradaId: "p-ficha-2", obsoleto: true });
    await expect
      .poll(async () => (await supabase.from("lugares_google").select("estado").eq("clave", PARADAS[1].lugar!).single()).data?.estado)
      .toBe("obsoleto");

    await carta.getByRole("button", { name: "Reintentar" }).click();
    // La ruta ya no la reconoce como casada: es el trabajador quien la volvería a casar.
    await expect(carta.getByText("No lo hemos encontrado en Google Maps con seguridad, así que no enseñamos opiniones de otro sitio.")).toBeVisible();
    await contexto.close();
  });

  test("a 320 px el panel abierto no desborda y /guia no tiene el panel (fic-ac4, fic-ac5)", async ({ browser }) => {
    const { contexto, pagina } = await abrir(browser, "ci-test-ficha-e2e@example.com", planId);
    await pagina.setViewportSize({ width: 320, height: 740 });
    await resumen(pagina, "Museo de prueba uno").click();
    await expect(tarjeta(pagina, "Museo de prueba uno").locator("gmp-place-details")).toBeVisible();
    expect(await sinScrollHorizontal(pagina)).toBe(true);

    const llamadas: string[] = [];
    pagina.on("request", (r) => llamadas.push(r.url()));
    await pagina.goto("/guia");
    await expect(pagina.getByText("Opiniones y horario · Google Maps")).toHaveCount(0);
    expect(llamadas.filter((u) => u.includes("/api/google/ficha"))).toHaveLength(0);
    await contexto.close();
  });
});
