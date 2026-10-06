import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { formatearKm } from "@/lib/formato/numeros";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { calcularTramosDia } from "@/lib/plan/tramos";

// tra-ac2 / cp-tra-02: medio, tiempo y enlace entre paradas del día.
test.use({ viewport: { width: 390, height: 844 } });

const DESTINO = "Londres";
const RESUELTO_EN = new Date("2026-10-04").toISOString();

// Siembra directa con la clave de servicio, mismo motivo que en
// encaje-y-paseo.movil.e2e.ts.
async function sembrarParada(
  supabase: SupabaseClient,
  versionId: string,
  diaIndex: number,
  datos: { idExterno: string; franjaId: string; nombre: string; lat: number; lon: number; duracion_min: number; categoria?: string },
) {
  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  const { data: parada, error: errorParada } = await supabase
    .from("paradas")
    .insert({
      id_externo: datos.idExterno,
      plan_version_id: versionId,
      dia_index: diaIndex,
      franja_id: datos.franjaId,
      nombre: datos.nombre,
      descripcion: "Visita",
      lat: datos.lat,
      lon: datos.lon,
      duracion_min: datos.duracion_min,
      prioridad: 60,
      procedencia_id: procedencia.id,
      categoria: datos.categoria ?? null,
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    })
    .select("id")
    .single();
  if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada '${datos.idExterno}': ${errorParada?.message}`);
  return parada.id as string;
}


async function sembrarPlan(supabase: SupabaseClient, email: string, paradas: { franjaId: string; nombre: string; lat: number; lon: number }[]) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-tramos-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-10-06", franjas: franjasComoArray(DESTINO) }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);
  for (const [i, p] of paradas.entries()) await sembrarParada(supabase, version.id, 0, { idExterno: `p${i}`, duracion_min: 60, ...p, franjaId: p.franjaId });
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "familiar" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function abrirPlan(browser: import("@playwright/test").Browser, email: string, planId: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const verificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } });
  expect(verificar.ok()).toBe(true);
  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: /^Día 1 · / })).toBeVisible();
  return { contexto, pagina };
}

test("entre dos paradas lejanas se ve el medio, su tiempo y su enlace (tra-ac2, tra-ac3)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-tramos-e2e@example.com";
  const planId = await sembrarPlan(supabase, email, [
    { franjaId: "manana", nombre: "British Museum", lat: 51.5194, lon: -0.127 },
    { franjaId: "comida", nombre: "Covent Garden", lat: 51.5117, lon: -0.124 },
    { franjaId: "tarde", nombre: "Warner Bros. Studio Tour", lat: 51.6906, lon: -0.4181 },
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  // El km esperado sale de las coordenadas de la semilla: si cambian, el
  // test falla en vez de aceptar cualquier cifra.
  const kmLargo = calcularTramosDia(
    [
      { id: "a", lat: 51.5117, lon: -0.124 },
      { id: "b", lat: 51.6906, lon: -0.4181 },
    ],
    { perfil: null },
  )[0].km;
  expect(kmLargo).toBeGreaterThan(20);

  const tramos = pagina.getByTestId("tramo-parada");
  await expect(tramos).toHaveCount(2);
  await expect(tramos.nth(0)).toContainText("≈");
  await expect(tramos.nth(0)).toContainText("1,1 km");
  await expect(tramos.nth(0)).toContainText("A pie");
  await expect(tramos.nth(0)).toContainText("20 min");
  await expect(tramos.nth(1)).toContainText(formatearKm(kmLargo));
  await expect(tramos.nth(1)).toContainText("Transporte público o taxi");
  await expect(tramos.nth(1)).toContainText("2 h 10 min");
  await expect(tramos.nth(1).getByRole("link", { name: "Cómo ir" })).toHaveAttribute("href", /travelmode=transit/);

  const paseo = pagina.locator(".paseo-dia");
  await expect(paseo).toContainText("A pie: 1,1 km");
  await expect(paseo).toContainText("En transporte:");
  await expect(paseo).not.toContainText("Paseo estimado");

  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Warner Bros." });
  await expect(tarjeta.getByRole("link", { name: "Cómo ir desde la anterior" })).toHaveAttribute("href", /travelmode=transit/);

  const hrefs = await pagina.locator("section.seccion-dia a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.filter((h) => h.includes("51.6906") && h.includes("travelmode=walking"))).toEqual([]);
  // dia-ac4: la frase de estimación ya no se repite en el día.
  await expect(pagina.locator("section.seccion-dia")).not.toContainText("Tiempos estimados por distancia");
  await contexto.close();
});

test("un día de paradas cercanas mantiene un único recorrido andando (tra-ac2, límite)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-tramos-cerca-e2e@example.com";
  const planId = await sembrarPlan(supabase, email, [
    { franjaId: "manana", nombre: "Parada uno", lat: 51.5194, lon: -0.127 },
    { franjaId: "comida", nombre: "Parada dos", lat: 51.5117, lon: -0.124 },
    { franjaId: "tarde", nombre: "Parada tres", lat: 51.5136, lon: -0.1229 },
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);
  const recorrido = pagina.getByRole("link", { name: "Abrir el recorrido en Google Maps" });
  await expect(recorrido).toHaveCount(1);
  await expect(recorrido).toHaveAttribute("href", /travelmode=walking/);
  await contexto.close();
});

test("un día con una sola parada resuelta no pinta tramos ni paseo (tra-ac2, límite)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-tramos-una-e2e@example.com";
  const planId = await sembrarPlan(supabase, email, [{ franjaId: "manana", nombre: "British Museum", lat: 51.5194, lon: -0.127 }]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);
  await expect(pagina.getByTestId("tramo-parada")).toHaveCount(0);
  await expect(pagina.locator(".paseo-dia")).toHaveCount(0);
  await contexto.close();
});
