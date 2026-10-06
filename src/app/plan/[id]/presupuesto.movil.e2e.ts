import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// mot-ac1 (cp-mot-01): motivo rotulado, precio con procedencia y cabecera
// frente al presupuesto, con los estados vacíos explícitos.
test.use({ viewport: { width: 390, height: 844 } });

const EMAIL = "ci-test-presupuesto@example.com";
const FECHA = "2026-11-07";
const MOTIVO_LARGO = "Muy largo ".repeat(30).trim();

interface ParadaSembrada {
  id: string;
  nombre: string;
  motivo?: string;
  coste?: { importe_eur: number; por: "persona" | "grupo" | "gratis"; procedencia: "estimado"; fecha: string };
}

const coste = (importe_eur: number, por: "persona" | "gratis") => ({ importe_eur, por, procedencia: "estimado" as const, fecha: "2026-10-05" });

async function sembrarPlan(
  supabase: SupabaseClient,
  usuarioId: string,
  planId: string,
  destino: string,
  presupuesto: number,
  paradas: ParadaSembrada[],
) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 4, dias: [{ fecha: FECHA, franjas: franjasComoArray(destino) }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  for (const p of paradas) {
    const { error } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: p.nombre,
      descripcion: "Visita",
      duracion_min: 60,
      prioridad: 80,
      procedencia_id: procedencia.id,
      motivo: p.motivo ?? null,
      coste: p.coste ?? null,
    });
    if (error) throw new Error(`No se pudo sembrar la parada '${p.id}': ${error.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: presupuesto }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
}

test("motivo, precio y cabecera de presupuesto con sus estados vacíos (mot-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const sufijo = Date.now();
  const planSevilla = `plan-pres-sevilla-${sufijo}`;
  const planRoma = `plan-pres-roma-${sufijo}`;
  const planCadiz = `plan-pres-cadiz-${sufijo}`;
  await sembrarPlan(supabase, usuario.user.id, planSevilla, "Sevilla", 900, [
    { id: "s-alcazar", nombre: "Real Alcázar", motivo: "Patios y jardines que a los niños les encantan", coste: coste(15, "persona") },
    { id: "s-plaza", nombre: "Plaza de España", coste: coste(0, "gratis") },
    { id: "s-catedral", nombre: "Catedral de Sevilla" },
  ]);
  await sembrarPlan(supabase, usuario.user.id, planRoma, "Roma", 900, [{ id: "r-foro", nombre: "Foro Romano" }]);
  // 4 personas × 300 €: 1.200 € frente a 900 €.
  await sembrarPlan(supabase, usuario.user.id, planCadiz, "Cádiz", 900, [
    { id: "c-caleta", nombre: "Castillo de Santa Catalina", motivo: MOTIVO_LARGO.slice(0, 300), coste: coste(300, "persona") },
  ]);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${planSevilla}?dia=1`);
  const alcazar = pagina.locator("li.tarjeta-parada", { hasText: "Real Alcázar" });
  await expect(alcazar).toContainText("Por qué te lo proponemos");
  await expect(alcazar).toContainText("Lo dice el planificador");
  await expect(alcazar).toContainText("Patios y jardines que a los niños les encantan");
  await expect(alcazar.getByTestId("precio-parada")).toHaveText("Precio orientativo: 15\u00a0€/persona · estimado");
  await expect(pagina.locator("li.tarjeta-parada", { hasText: "Plaza de España" }).getByTestId("precio-parada")).toHaveText("Gratis");
  await expect(pagina.locator("li.tarjeta-parada", { hasText: "Catedral de Sevilla" }).getByTestId("precio-parada")).toHaveText("Sin precio orientativo");
  await pagina.goto(`/plan/${planSevilla}?dia=resumen`);
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText("Visitas: ~60 € estimados · Tu presupuesto: 900 €");

  await pagina.goto(`/plan/${planRoma}?dia=1`);
  const foro = pagina.locator("li.tarjeta-parada", { hasText: "Foro Romano" });
  await expect(foro.getByTestId("precio-parada")).toHaveText("Sin precio orientativo");
  await expect(pagina.getByText("Por qué te lo proponemos")).toHaveCount(0);
  await pagina.goto(`/plan/${planRoma}?dia=resumen`);
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText("Sin estimación de gasto en visitas");

  await pagina.goto(`/plan/${planCadiz}?dia=resumen`);
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText("Las visitas estimadas superan tu presupuesto en ~300 €");
  await pagina.goto(`/plan/${planCadiz}?dia=1`);
  await expect(pagina.getByTestId("motivo-parada")).toBeVisible();
  const desborda = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(desborda).toBe(false);

  await contexto.close();
});
