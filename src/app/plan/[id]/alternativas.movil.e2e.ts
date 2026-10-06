import { expect, test, type Browser } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// alt-ac5/alt-ac7: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-alternativas@example.com";
const DESTINO = "Sevilla";
const RESUELTO_EN = new Date("2026-10-04").toISOString();

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo documentado en plan-timeline.movil.e2e.ts.
async function sembrarPlan(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  async function sembrarParada(idExterno: string, nombre: string, conAlternativas: boolean) {
    if (!version) throw new Error("no se pudo sembrar la versión del plan");
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

    const { data: parada, error: errorParada } = await supabase
      .from("paradas")
      .insert({
        id_externo: idExterno,
        plan_version_id: version.id,
        dia_index: 0,
        franja_id: "manana",
        nombre,
        descripcion: "Visita guiada",
        lat: 37.3862,
        lon: -5.9926,
        duracion_min: 90,
        prioridad: 60,
        procedencia_id: procedencia.id,
        categoria: "monumento",
        lugar: { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombre_fuente: nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
        resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      })
      .select("id")
      .single();
    if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada '${idExterno}': ${errorParada?.message}`);

    if (conAlternativas) {
      const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
        parada_id: parada.id,
        origen: "modelo",
        nombre: "Real Alcázar",
        descripcion: "Palacio real",
        motivo: "mismo tipo, misma franja",
        duracion_min: 100,
        categoria: "monumento",
        lat: 37.3834,
        lon: -5.9904,
      });
      if (errorAlternativa) throw new Error(`No se pudo sembrar la alternativa: ${errorAlternativa.message}`);
    }
  }

  await sembrarParada("p-con-alternativas", "Catedral de Sevilla", true);
  await sembrarParada("p-sin-alternativas", "Torre del Oro", false);
}

test("cambiar una parada por una alternativa crea una versión nueva y la antigua queda como alternativa (alt-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-alternativas-${Date.now()}`;
  await sembrarPlan(supabase, planId);

  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const { count: versionesAntes } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);

  const tarjetaConAlternativas = pagina.locator(".tarjeta-parada", { hasText: "Catedral de Sevilla" });
  await tarjetaConAlternativas.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect(tarjetaConAlternativas.getByText("Real Alcázar")).toBeVisible();
  // Acotado a los metadatos de la alternativa: desde encaje-y-paseo, la propia
  // parada también muestra "a N m de la siguiente parada" (etiquetas de encaje),
  // que con un locator sin acotar vuelve ambiguo el texto "a N m".
  await expect(tarjetaConAlternativas.locator(".metadatos-alternativa").getByText(/a \d+ m/i)).toBeVisible();
  await tarjetaConAlternativas.getByRole("button", { name: "Usar esta" }).click();

  // alt-ac5: exactamente una fila más en plan_versiones.
  await expect(async () => {
    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe((versionesAntes ?? 0) + 1);
  }).toPass();

  // La parada nueva lleva el nombre de la alternativa en la misma franja.
  const tarjetaNueva = pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" });
  await expect(tarjetaNueva).toBeVisible();

  await pagina.reload();
  await expect(pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" })).toBeVisible();
  await pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" }).getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect(pagina.getByText("Catedral de Sevilla").last()).toBeVisible();

  await contexto.close();
});

test("usabilidad: parada sin alternativas, ayuda y objetivos táctiles (alt-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-alternativas-vacio@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-alternativas-vacio-${Date.now()}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const tarjetaSinAlternativas = pagina.locator(".tarjeta-parada", { hasText: "Torre del Oro" });
  // cam-ac1: sin alternativas no hay ningún botón de cambio.
  await expect(tarjetaSinAlternativas.getByRole("button", { name: /Cambiar/ })).toHaveCount(0);

  // El botón de una tarjeta CON alternativas mide al menos 44×44 y su texto cabe.
  const tarjetaConAlternativas = pagina.locator(".tarjeta-parada", { hasText: "Catedral de Sevilla" });
  await expect(tarjetaConAlternativas.getByRole("button", { name: "Cambiar por una alternativa" })).toHaveCount(1);
  await tarjetaConAlternativas.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect(tarjetaConAlternativas.getByText(/crea una nueva versión del plan/)).toBeVisible();

  const resultados = await medirObjetivosTactiles(pagina);
  const botonMedido = resultados.find((r) => r.descripcion.includes("Cambiar"));
  expect(botonMedido?.alto).toBeGreaterThanOrEqual(44);
  expect(botonMedido?.ancho).toBeGreaterThanOrEqual(44);

  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-alternativas-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-alternativas-oscuro.png" });

  await contexto.close();
});

// alr-ac2/alr-ac3: «Museo A» con dos alternativas, para ver el estado mientras
// se cambia. Siembra directa por el mismo motivo que sembrarPlan.
async function sembrarMuseos(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-alr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas: franjasComoArray(DESTINO) }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  const { data: parada, error: errorParada } = await supabase
    .from("paradas")
    .insert({
      id_externo: "p-museo",
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: "Museo A",
      descripcion: "Colección permanente",
      lat: 37.3862,
      lon: -5.9926,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia?.id,
      categoria: "museo",
      lugar: { fuente: "osm", id: "osm:way/7", url: "https://www.openstreetmap.org/way/7", nombre_fuente: "Museo A", etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    })
    .select("id")
    .single();
  if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada: ${errorParada?.message}`);
  const { error: errorAlternativas } = await supabase.from("paradas_alternativas").insert(
    ["Museo B", "Parque C"].map((nombre) => ({
      parada_id: parada.id,
      origen: "modelo",
      nombre,
      descripcion: "Otra opción",
      motivo: "mismo tipo, misma franja",
      duracion_min: 90,
      categoria: "museo",
      lat: 37.3834,
      lon: -5.9904,
    })),
  );
  if (errorAlternativas) throw new Error(`No se pudieron sembrar las alternativas: ${errorAlternativas.message}`);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
  return planId;
}

async function abrirPanelMuseo(browser: Browser, email: string) {
  const supabase = clienteDePrueba("servicio");
  const planId = await sembrarMuseos(supabase, email);
  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}`);
  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Museo A" });
  await tarjeta.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  return { contexto, pagina, tarjeta };
}

test("cp-alr-02: mientras cambia se ve «Cambiando…» y al terminar qué ha cambiado (alr-ac2)", async ({ browser }) => {
  const { contexto, pagina, tarjeta } = await abrirPanelMuseo(browser, "ci-test-alternativas-estado@example.com");
  let envios = 0;
  await pagina.route("**/sustituir", async (route) => {
    envios++;
    await new Promise((resolver) => setTimeout(resolver, 1500));
    await route.continue();
  });

  const panel = tarjeta.getByRole("region", { name: /Alternativas a Museo A/ });
  const botonB = tarjeta.locator(".tarjeta-alternativa", { hasText: "Museo B" }).getByRole("button");
  await botonB.click();
  // Espera por estado, no por un sleep: el retraso es de 1.500 ms y esto solo exige verlo antes de que acabe.
  await expect(botonB).toHaveText("Cambiando…");
  await expect(botonB).toBeDisabled();
  await expect(tarjeta.locator(".tarjeta-alternativa", { hasText: "Parque C" }).getByRole("button")).toBeDisabled();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await expect(pagina.getByRole("status").filter({ hasText: "Cambiando la parada…" })).toBeVisible();

  const tarjetaNueva = pagina.locator(".tarjeta-parada", { hasText: "Museo B" });
  await expect(tarjetaNueva).toBeVisible({ timeout: 15_000 });
  await expect(pagina.getByRole("status").filter({ hasText: "Hecho: ahora vas a Museo B" })).toBeVisible();
  await expect(tarjetaNueva.getByRole("region", { name: /Alternativas a/ })).toHaveCount(0);
  await expect(async () => {
    const dentro = await tarjetaNueva.evaluate((el) => el.contains(document.activeElement));
    expect(dentro).toBe(true);
  }).toPass();
  expect(envios).toBe(1);
  await contexto.close();
});

test("cp-alr-02: error del servidor y red caída dejan el panel abierto con su mensaje (alr-ac2)", async ({ browser }) => {
  const { contexto, pagina, tarjeta } = await abrirPanelMuseo(browser, "ci-test-alternativas-error@example.com");
  const mensaje = "esa alternativa no es de este plan o el plan ha cambiado; recarga";
  await pagina.route("**/sustituir", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: mensaje }) }));
  const botonB = tarjeta.locator(".tarjeta-alternativa", { hasText: "Museo B" }).getByRole("button");
  await botonB.click();
  await expect(pagina.getByRole("alert").filter({ hasText: mensaje })).toBeVisible();
  await expect(botonB).toBeEnabled();
  await expect(tarjeta.getByRole("region", { name: /Alternativas a Museo A/ })).toBeVisible();
  await expect(pagina.locator(".tarjeta-parada", { hasText: "Museo A" })).toBeVisible();

  await pagina.unroute("**/sustituir");
  await pagina.route("**/sustituir", (route) => route.abort());
  await botonB.click();
  await expect(pagina.getByRole("alert")).toHaveText("No se ha podido cambiar la parada. El plan sigue como estaba; vuelve a intentarlo.");
  await contexto.close();
});

test("doble pulsación u otra alternativa mientras cambia lanzan un solo POST (alr-ac3)", async ({ browser }) => {
  const { contexto, pagina, tarjeta } = await abrirPanelMuseo(browser, "ci-test-alternativas-doble@example.com");
  let envios = 0;
  await pagina.route("**/sustituir", async (route) => {
    envios++;
    await new Promise((resolver) => setTimeout(resolver, 1500));
    await route.continue();
  });
  const botonB = tarjeta.locator(".tarjeta-alternativa", { hasText: "Museo B" }).getByRole("button");
  const botonC = tarjeta.locator(".tarjeta-alternativa", { hasText: "Parque C" }).getByRole("button");
  await botonB.click();
  await botonB.click({ force: true });
  await botonC.click({ force: true });
  await expect(pagina.locator(".tarjeta-parada", { hasText: "Museo B" })).toBeVisible({ timeout: 15_000 });
  expect(envios).toBe(1);
  await contexto.close();
});
