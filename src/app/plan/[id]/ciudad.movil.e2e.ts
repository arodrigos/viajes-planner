import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// man-ac1: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-ciudad@example.com";
const DESTINO = "Ciudad con niños";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
const TOTAL_PARADAS = 22;

async function sembrarPlanSinCiudad(supabase: SupabaseClient, planId: string, motivo: string) {
  const { error: errorPlan } = await supabase
    .from("planes")
    .insert({ id: planId, destino: DESTINO, ciudad: { estado: "sin-ciudad-identificable", motivo, intentado_en: RESUELTO_EN } });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-12-10", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  for (let i = 0; i < TOTAL_PARADAS; i++) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: `p-ciudad-${i}`,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: `Sitio sin ubicar ${i}`,
      descripcion: "Visita",
      lat: null,
      lon: null,
      duracion_min: 60,
      prioridad: 50,
      procedencia_id: procedencia.id,
      lugar: null,
      resolucion: { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ciudad sin identificar" },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada ${i}: ${errorParada.message}`);
  }
}

async function iniciarSesion(contexto: import("@playwright/test").BrowserContext, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

test("aviso, motivo, ayuda y contador de un plan sin ciudad identificable, sin scroll horizontal (man-ac1, cp-man-01)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-ciudad-${Date.now()}`;
  const motivo = "no hay una ciudad clara (Madrid 2, Valencia 2, Barcelona 1)";
  await sembrarPlanSinCiudad(supabase, planId, motivo);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, EMAIL);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  await expect(pagina.getByText("No hemos identificado la ciudad de este viaje")).toBeVisible();
  await expect(pagina.getByText(motivo)).toBeVisible();
  await expect(pagina.getByText("Dinos de qué ciudad es y buscaremos sus sitios en el mapa")).toBeVisible();
  await expect(pagina.getByText(`0 de ${TOTAL_PARADAS} sitios ubicados`)).toBeVisible();
  await expect(pagina.getByLabel("¿De qué ciudad es este viaje?")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Guardar ciudad" })).toBeVisible();

  // man-ac1: sin scroll horizontal a 393x851.
  const scrollWidth = await pagina.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await pagina.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  await pagina.screenshot({ path: "artefactos/capturas/plan-ciudad-sin-identificar.png" });

  await contexto.close();
});

test("decir la ciudad a mano: confirma y deja pendiente-manual con nombre_pedido y pedido_en (man-ac2, cp-man-02)", async ({ browser }) => {
  // fullyParallel: true -- usuario propio para no competir por el mismo
  // createUser que el test anterior ni compartir su límite de trabajos por
  // hora (mismo criterio que ci-test-destino/ci-test-destino-no-hoy).
  const email = "ci-test-ciudad-manual@example.com";
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const usuarioId = usuario.user.id;

  const planId = `plan-ciudad-manual-${Date.now()}`;
  await sembrarPlanSinCiudad(supabase, planId, "no hay una ciudad clara (Madrid 2, Valencia 2)");
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);
  await pagina.goto(`/plan/${planId}?dia=1`);

  await pagina.getByLabel("¿De qué ciudad es este viaje?").fill("Valencia");
  await pagina.getByRole("button", { name: "Guardar ciudad" }).click();

  await expect(pagina.getByText("Buscaremos los sitios de Valencia en los próximos minutos")).toBeVisible();

  const { data: fila, error: errorLeer } = await supabase.from("planes").select("ciudad").eq("id", planId).single();
  if (errorLeer) throw new Error(`No se pudo leer la fila del plan: ${errorLeer.message}`);
  expect(fila?.ciudad?.estado).toBe("pendiente-manual");
  expect(fila?.ciudad?.nombre_pedido).toBe("Valencia");
  expect(fila?.ciudad?.pedido_en).toBeTruthy();

  await contexto.close();
});
