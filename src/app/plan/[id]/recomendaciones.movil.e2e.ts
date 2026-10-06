import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// reco-ac4: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-recomendaciones@example.com";
const DESTINO = "Sevilla";

const RECOMENDACIONES = [
  { tipo: "comida", nombre: "Bar de la Alameda", motivo: "Tapas locales, poco turístico." },
  { tipo: "recinto", nombre: "Real Alcázar", motivo: "Imprescindible, reserva con antelación." },
];

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en plan-timeline.movil.e2e.ts,
// el otro e2e que necesita sembrar un plan real.
async function sembrarPlanConRecomendaciones(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);

  const { error: errorVersion } = await supabase.from("plan_versiones").insert({
    plan_id: planId,
    version: 1,
    personas: 2,
    dias: [{ fecha: "2026-11-10", franjas }],
    avisos: [],
    recomendaciones: RECOMENDACIONES,
  });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

test("las recomendaciones se ven en la línea de tiempo, con enlace en pestaña nueva y el nombre como texto accesible (reco-ac4)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-reco-${Date.now()}`;
  await sembrarPlanConRecomendaciones(supabase, planId);

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
  await expect(pagina.getByRole("heading", { name: "Más sitios recomendados" })).toBeVisible();

  for (const reco of RECOMENDACIONES) {
    // El texto accesible del enlace es el nombre del sitio -nunca "aquí" ni
    // "ver".
    const enlace = pagina.getByRole("link", { name: reco.nombre, exact: true });
    await expect(enlace).toBeVisible();
    await expect(enlace).toHaveAttribute("target", "_blank");
    const rel = await enlace.getAttribute("rel");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    await expect(enlace).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${reco.nombre} ${DESTINO}`)}`,
    );
    await expect(pagina.getByText(reco.motivo)).toBeVisible();
  }

  // reco-ac7(c): el aviso de que cada enlace es una búsqueda, no una
  // reserva ni un listado verificado, sigue siendo fijo.
  await expect(pagina.getByText(/no una reserva ni un listado verificado/i)).toBeVisible();

  // reco-ac4: capturas del gatekeeper, en claro y oscuro.
  await pagina.screenshot({ path: "artefactos/capturas/recomendaciones-claro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/recomendaciones-oscuro.png", fullPage: true });

  await contexto.close();
});
