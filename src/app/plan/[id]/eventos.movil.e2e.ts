import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// eve-ac1 (cp-eve-01) y eve-ac2: festivos y fiestas con fuente y enlace, y el
// estado vacío de un plan de época, en 360×740.
test.use({ viewport: { width: 360, height: 740 } });

const EMAIL = "ci-test-eventos@example.com";
const FECHA = "2027-06-10";

const BASE = { fuente: "openholidays", url: "https://www.openholidaysapi.org/en/", etapa: 0, pais: "PT" };

async function sembrar(supabase: SupabaseClient, usuarioId: string, planId: string, eventos: unknown) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Lisboa") }], avisos: [], eventos, eventos_intentados_en: "2026-10-05T10:00:00Z" });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: 900 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

test("eventos con fuente y enlace, y estado de época (eve-ac1, eve-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const conEventos = `plan-eve-${Date.now()}`;
  const deEpoca = `plan-eve-epoca-${Date.now()}`;
  await sembrar(supabase, usuario.user.id, conEventos, {
    estado: "consultado",
    consultado_en: "2026-10-05T10:00:00Z",
    eventos: [{ ...BASE, fecha: FECHA, nombre: "Portugal Day", tipo: "festivo" }],
  });
  await sembrar(supabase, usuario.user.id, deEpoca, { estado: "epoca", consultado_en: "2026-10-05T10:00:00Z", eventos: [] });

  const contexto = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${conEventos}`);
  const seccion = pagina.getByTestId("eventos-viaje");
  await expect(seccion).toContainText("Festivo nacional: Portugal Day · OpenHolidays");
  await expect(seccion.getByRole("link", { name: "Ver en OpenHolidays: Portugal Day" })).toHaveAttribute("href", "https://www.openholidaysapi.org/en/");
  await expect(pagina.getByTestId("eventos-dia")).toContainText("Algunos museos cierran o cambian de horario en festivo");
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await pagina.goto(`/plan/${deEpoca}`);
  await expect(pagina.getByTestId("eventos-viaje")).toContainText("Indica fechas concretas para ver festivos y fiestas");
  await expect(pagina.getByTestId("evento")).toHaveCount(0);
  await contexto.close();
});
