import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// gas-ac1, gas-ac3, gas-ac5 (uat-14..uat-16): pestaña de gastos vacía, alta de
// comida en el día 2, alojamiento a todo el viaje y error de importe. Cada paso se
// captura en los tres tamaños.
test.use({ viewport: { width: 390, height: 844 } });

const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-gas-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Roma" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha) => ({ fecha, franjas }));
  const etapas = [{ ciudad: { estado: "resuelta", nombre: "Roma", intentado_en: "2026-10-01T00:00:00Z" }, pais: "IT", dias: 3, dia_inicio: 0, alojamiento_noche_eur: 100, zona: 0, ajustes: [] }];
  const traslados = [{ desde: "Madrid", hasta: "Roma", modo: "avion", distancia_km: 1360, duracion_min: 150, coste_eur: 1000, procedencia: "estimado" }];
  const { data: version, error: errorVersion } = await supabase.from("plan_versiones").insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [], etapas, traslados }).select("id").single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
  const { error: errorParada } = await supabase.from("paradas").insert({
    id_externo: `p-gas-${Date.now()}`,
    plan_version_id: version.id,
    dia_index: 0,
    franja_id: "manana",
    nombre: "Panteón (ejemplo)",
    descripcion: "Visita",
    duracion_min: 60,
    prioridad: 60,
    procedencia_id: procedencia.id,
  });
  if (errorParada) throw new Error(`No se pudo sembrar la parada: ${errorParada.message}`);
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "amigos" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function enTodosLosTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await capturar(pagina, "gastos-datos-y-comparacion", `${nombre}-${t.ancho}`);
  }
}

test("vacío, alta de comida, alojamiento y error de importe (gas-ac1, gas-ac3, gas-ac5)", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = "ci-test-gastos@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}`);

  // uat-14
  await pagina.getByText("Gastos", { exact: true }).click();
  await expect(pagina.getByTestId("gastos-titular")).toContainText("Queda")
  await expect(pagina.getByTestId("gastos-resumen")).toContainText("Gastado 0,00");
  await expect(pagina.getByTestId("gastos-vacio")).toContainText("Aún no has apuntado gastos. Apunta lo que vayas pagando y verás cuánto te queda del presupuesto estimado");
  await pagina.getByTestId("gastos-titular").scrollIntoViewIfNeeded();
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "vacio");

  // uat-15
  await pagina.getByLabel("Importe (€)").fill("25,50");
  await pagina.getByLabel("Día", { exact: true }).selectOption("2027-06-09");
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  await expect(pagina.getByTestId("gastos-resumen")).toContainText("Gastado 25,50");
  await expect(pagina.getByTestId("gasto")).toContainText("Comida · 25,50");
  await expect(pagina.getByTestId("gastos-fila-dia").nth(1)).toContainText("25,50");
  await pagina.reload();
  await pagina.getByText("Gastos", { exact: true }).click();
  await expect(pagina.getByTestId("gasto")).toHaveCount(1);
  await expect(pagina.getByTestId("gastos-resumen")).toContainText("Gastado 25,50");
  await pagina.getByTestId("gastos-titular").scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "comida-dia-2");

  // uat-15b
  await pagina.getByLabel("Importe (€)").fill("600");
  await pagina.getByRole("button", { name: "Alojamiento" }).click();
  await expect(pagina.getByText("El alojamiento se compara con el alojamiento estimado de todo el viaje")).toBeVisible();
  await expect(pagina.getByLabel("Día", { exact: true })).toBeDisabled();
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  await expect(pagina.getByTestId("gastos-fila-alojamiento")).toContainText("600,00");
  await expect(pagina.getByTestId("gastos-resumen")).toContainText("Gastado 625,50");
  await pagina.getByTestId("gastos-fila-alojamiento").scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "alojamiento");

  // uat-16
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  await expect(pagina.getByText("Escribe un importe entre 0,01 € y 100.000 €")).toBeVisible();
  await pagina.getByLabel("Importe (€)").fill("0");
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  await expect(pagina.getByText("Escribe un importe entre 0,01 € y 100.000 €")).toBeVisible();
  await expect(pagina.getByTestId("gasto")).toHaveCount(2);
  await pagina.getByText("Escribe un importe entre 0,01 € y 100.000 €").scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "error-importe");
  await contexto.close();
});
