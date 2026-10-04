import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// ics-ac2: viewport móvil real, mismo patrón que destino.movil.e2e.ts.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-calendario@example.com";
const DESTINO = "Córdoba";

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only, repositorio.ts): fuera del build de Next.js "server-only"
// lanza siempre, y Playwright no tiene ese alias -mismo motivo ya
// documentado en plan-timeline.movil.e2e.ts y fotos.movil.e2e.ts.
async function sembrarPlanDeUnaParada(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-10", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  const { error: errorParada } = await supabase.from("paradas").insert({
    id_externo: "p-calendario-a",
    plan_version_id: version.id,
    dia_index: 0,
    franja_id: franjas[0].id,
    nombre: "Mezquita-Catedral",
    descripcion: "Visita guiada",
    lat: 37.8789,
    lon: -4.7794,
    duracion_min: 90,
    prioridad: 80,
    procedencia_id: procedencia.id,
    lugar: { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombre_fuente: "Mezquita-Catedral", etiquetas: {}, resuelto_en: new Date().toISOString() },
    resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() },
  });
  if (errorParada) throw new Error(`No se pudo sembrar la parada 'p-calendario-a': ${errorParada.message}`);
}

async function iniciarSesion(contexto: import("@playwright/test").BrowserContext, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

// ics-ac2: el enlace existe, tiene objetivo táctil >=44x44 y descarga un
// fichero .ics real al pulsarlo.
test("«Añadir al calendario» descarga un fichero .ics (ics-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-calendario-e2e-${Date.now()}`;
  await sembrarPlanDeUnaParada(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, EMAIL);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const enlace = pagina.getByRole("link", { name: "Añadir al calendario" });
  await expect(enlace).toBeVisible();

  const elementos = await medirObjetivosTactiles(pagina);
  const objetivoEnlace = elementos.find((el) => el.descripcion.includes("Añadir al calendario"));
  expect(objetivoEnlace?.alto).toBeGreaterThanOrEqual(44);
  expect(objetivoEnlace?.ancho).toBeGreaterThanOrEqual(44);

  const [descarga] = await Promise.all([pagina.waitForEvent("download"), enlace.click()]);
  expect(descarga.suggestedFilename()).toBe("cordoba.ics");

  await contexto.close();
});
