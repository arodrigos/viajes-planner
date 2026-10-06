import { expect, test, type Browser } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// alc-ac1/alc-ac4: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-alternativas-completas@example.com";
const DESTINO = "Sevilla";
const RESUELTO_EN = new Date("2026-10-04").toISOString();

// PNG de 1x1: Playwright responde con él a la URL de Wikimedia sembrada, así
// que naturalWidth > 0 prueba que la imagen se pinta de verdad sin red real.
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const FOTO_PILATOS = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Casa-de-Pilatos.jpg/640px-Casa-de-Pilatos.jpg",
  fichero: "Casa-de-Pilatos.jpg",
  autor: "Autora De Prueba",
  licencia: "CC BY-SA 4.0",
  licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
  pagina_url: "https://commons.wikimedia.org/wiki/File:Casa-de-Pilatos.jpg",
  fuente: "commons",
};

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo documentado en plan-timeline.movil.e2e.ts.
async function sembrarPlan(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas: franjasComoArray(DESTINO) }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  const { data: parada, error: errorParada } = await supabase
    .from("paradas")
    .insert({
      id_externo: "p-alcazar",
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: "Real Alcázar",
      descripcion: "Palacio real",
      lat: 37.3834,
      lon: -5.9904,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia.id,
      categoria: "monumento",
      lugar: { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombre_fuente: "Real Alcázar", etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    })
    .select("id")
    .single();
  if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada: ${errorParada?.message}`);

  const { error: errorAlternativas } = await supabase.from("paradas_alternativas").insert([
    {
      parada_id: parada.id,
      origen: "modelo",
      nombre: "Casa de Pilatos",
      descripcion: "Palacio andaluz",
      motivo: "mismo tipo, misma franja",
      duracion_min: 90,
      categoria: "monumento",
      lat: 37.3925,
      lon: -5.9906,
      foto: FOTO_PILATOS,
    },
    {
      parada_id: parada.id,
      origen: "cercano",
      nombre: "Palacio de las Dueñas",
      descripcion: "Palacio",
      motivo: "A 900 m, misma categoría según OpenStreetMap.",
      duracion_min: 60,
      categoria: "monumento",
      lat: 37.3989,
      lon: -5.9902,
    },
  ]);
  if (errorAlternativas) throw new Error(`No se pudieron sembrar las alternativas: ${errorAlternativas.message}`);
}

test("«Usar esta» conserva las alternativas, se vuelve con otro «Usar esta» y las fotos se pintan (alc-ac1, alc-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-alternativas-completas-${Date.now()}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  await contexto.route("https://upload.wikimedia.org/**", (ruta) => ruta.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }));
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  const tarjeta = pagina.locator(".tarjeta-parada");
  const nombresDelPanel = () => tarjeta.locator(".tarjeta-alternativa strong").allTextContents();
  const alternativa = (nombre: string) => tarjeta.locator(".tarjeta-alternativa", { hasText: nombre });
  // Tras sustituir, la tarjeta puede conservar el panel abierto: solo se pulsa si está cerrado.
  const abrirAlternativas = async () => {
    const resumen = tarjeta.locator("summary", { hasText: /^Alternativas \(\d+\)$/ });
    const panel = tarjeta.locator("details", { has: pagina.locator("summary", { hasText: /^Alternativas \(\d+\)$/ }) });
    if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) await resumen.click();
    await expect(panel).toHaveAttribute("open", "");
  };

  // Versión 1: dos alternativas; la que tiene foto la pinta, la otra enseña «Sin foto».
  await abrirAlternativas();
  await expect.poll(async () => (await nombresDelPanel()).sort()).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);
  const imagen = alternativa("Casa de Pilatos").locator("img");
  await expect(imagen).toHaveCount(1);
  await expect.poll(() => imagen.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(alternativa("Palacio de las Dueñas").locator(".foto-ausente")).toBeVisible();
  await expect(alternativa("Palacio de las Dueñas").locator("img")).toHaveCount(0);

  // Ida: versión 2 con Casa de Pilatos y, como alternativas, la no elegida y la sustituida.
  await alternativa("Casa de Pilatos").getByRole("button", { name: "Usar esta" }).click();
  await expect(async () => {
    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(2);
  }).toPass();
  await expect(tarjeta.locator("h4").filter({ hasText: "Casa de Pilatos" })).toBeVisible();
  await abrirAlternativas();
  await expect.poll(async () => (await nombresDelPanel()).sort()).toEqual(["Palacio de las Dueñas", "Real Alcázar"]);

  // Vuelta: versión 3 otra vez con Real Alcázar y las otras dos como alternativas.
  await alternativa("Real Alcázar").getByRole("button", { name: "Usar esta" }).click();
  await expect(async () => {
    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(3);
  }).toPass();
  await expect(tarjeta.locator("h4").filter({ hasText: "Real Alcázar" })).toBeVisible();
  await abrirAlternativas();
  await expect.poll(async () => (await nombresDelPanel()).sort()).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);

  await contexto.close();
});

// alg-ac2 (cp-alg-02): la parada nueva trae la guía de su alternativa sin que
// el trabajador intervenga (en la pila de CI no corre ningún tick durante el test).
async function sembrarPlanConGuia(supabase: SupabaseClient, planId: string, alternativaConGuia: boolean) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Londres" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas: franjasComoArray("Londres") }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  const guia = (consejo: string) => ({ consejo, url: "https://es.wikivoyage.org/wiki/Londres", licencia: "CC BY-SA" });
  const { data: parada, error: errorParada } = await supabase
    .from("paradas")
    .insert({
      id_externo: "p-torre",
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: "Torre de Londres",
      descripcion: "Fortaleza",
      lat: 51.508,
      lon: -0.076,
      duracion_min: 120,
      prioridad: 60,
      procedencia_id: procedencia?.id,
      categoria: "monumento",
      lugar: { fuente: "osm", id: "osm:way/2", url: "https://www.openstreetmap.org/way/2", nombre_fuente: "Torre de Londres", etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      guia: guia("Consejo T"),
      curiosidades: { frases: ["Frase T1", "Frase T2"], url: "https://es.wikipedia.org/wiki/Torre_de_Londres" },
      guia_intentada_en: RESUELTO_EN,
      guia_formato: 2,
    })
    .select("id")
    .single();
  if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada: ${errorParada?.message}`);
  const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
    parada_id: parada.id,
    origen: "modelo",
    nombre: "Museo de Ciencias",
    descripcion: "Museo",
    motivo: "mismo tipo, misma franja",
    duracion_min: 120,
    categoria: "monumento",
    lat: 51.497,
    lon: -0.174,
    ...(alternativaConGuia
      ? {
          guia: guia("Consejo M"),
          curiosidades: { frases: ["Frase M1", "Frase M2", "Frase M3"], url: "https://es.wikipedia.org/wiki/Museo_de_Ciencias" },
          guia_intentada_en: RESUELTO_EN,
          guia_formato: 2,
        }
      : {}),
  });
  if (errorAlternativa) throw new Error(`No se pudo sembrar la alternativa: ${errorAlternativa.message}`);
}

async function entrarYAbrirAlternativas(browser: Browser, supabase: SupabaseClient, email: string, planId: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: "Londres", exact: true })).toBeVisible();
  const tarjeta = pagina.locator(".tarjeta-parada");
  await tarjeta.locator("summary", { hasText: /^Alternativas \(\d+\)$/ }).click();
  await tarjeta.locator(".tarjeta-alternativa", { hasText: "Museo de Ciencias" }).getByRole("button", { name: "Usar esta" }).click();
  await expect(pagina.getByText(/^Hecho: ahora vas a Museo de Ciencias/)).toBeVisible();
  return { contexto, pagina, tarjeta };
}

test("«Usar esta» enseña la guía y las curiosidades de la alternativa sin esperar al trabajador (alg-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const planId = `plan-alternativas-guia-${Date.now()}`;
  await sembrarPlanConGuia(supabase, planId, true);
  const { contexto, pagina } = await entrarYAbrirAlternativas(browser, supabase, "ci-test-alternativas-guia@example.com", planId);

  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Museo de Ciencias" });
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  await expect(tarjeta.getByTestId("guia-parada")).toContainText("Consejo M");
  await expect(tarjeta.getByTestId("guia-parada").getByRole("link", { name: /Ver en Wikivoyage/ })).toBeVisible();
  await expect(tarjeta.getByTestId("curiosidades-parada").locator("li")).toHaveText(["Frase M1", "Frase M2", "Frase M3"]);
  await expect(tarjeta).not.toContainText("Todavía no hemos consultado la guía");
  await expect(tarjeta).not.toContainText("Buscando consejos");
  await contexto.close();
});

test("«Usar esta» sobre una alternativa sin guía todavía dice que la busca, no deja un hueco (alg-ac2, límite)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const planId = `plan-alternativas-singuia-${Date.now()}`;
  await sembrarPlanConGuia(supabase, planId, false);
  const { contexto, pagina } = await entrarYAbrirAlternativas(browser, supabase, "ci-test-alternativas-singuia@example.com", planId);

  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Museo de Ciencias" });
  await expect(tarjeta.getByTestId("guia-parada")).toContainText("Buscando consejos y curiosidades de Museo de Ciencias; aparecerán en unos minutos");
  await contexto.close();
});
