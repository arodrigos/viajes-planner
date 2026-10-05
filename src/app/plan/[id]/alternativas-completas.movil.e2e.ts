import { expect, test } from "@playwright/test";
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

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const tarjeta = pagina.locator(".tarjeta-parada");
  const nombresDelPanel = () => tarjeta.locator(".tarjeta-alternativa strong").allTextContents();
  const alternativa = (nombre: string) => tarjeta.locator(".tarjeta-alternativa", { hasText: nombre });

  // Versión 1: dos alternativas; la que tiene foto la pinta, la otra enseña «Sin foto».
  await tarjeta.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  expect((await nombresDelPanel()).sort()).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);
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
  await expect(tarjeta.locator(":scope > div > strong").filter({ hasText: "Casa de Pilatos" })).toBeVisible();
  await tarjeta.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect.poll(async () => (await nombresDelPanel()).sort()).toEqual(["Palacio de las Dueñas", "Real Alcázar"]);

  // Vuelta: versión 3 otra vez con Real Alcázar y las otras dos como alternativas.
  await alternativa("Real Alcázar").getByRole("button", { name: "Usar esta" }).click();
  await expect(async () => {
    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(3);
  }).toPass();
  await expect(tarjeta.locator(":scope > div > strong").filter({ hasText: "Real Alcázar" })).toBeVisible();
  await tarjeta.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect.poll(async () => (await nombresDelPanel()).sort()).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);

  await contexto.close();
});
