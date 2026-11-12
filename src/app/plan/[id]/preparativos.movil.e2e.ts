import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// lis-ac1, lis-ac2, lis-ac4, lis-ac7, lis-ac11: la lista de preparativos de un
// plan familiar, marcada con y sin red, en los tamaños de referencia.
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 390, alto: 844 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
  { ancho: 1280, alto: 800 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-prep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Roma" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
  const dias = Array.from({ length: 7 }, (_, i) => ({ fecha: `2027-07-0${3 + i}`, franjas }));
  const { error: errorVersion } = await supabase.from("plan_versiones").insert({ plan_id: planId, version: 1, personas: 4, dias, avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const criterios = {
    perfil: "familiar",
    personas: [{ edad: 1 }, { edad: 6 }, { edad: 38 }, { edad: 40 }],
    fechas: { inicio: "2027-07-03", fin: "2027-07-09" },
    dias: 7,
  };
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function entrar(contexto: BrowserContext, email: string) {
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } })).ok()).toBe(true);
}

async function enTodosLosTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await pagina.mouse.move(-1, -1);
    await capturar(pagina, "preparativos-lista", `${nombre}-${t.ancho}`);
  }
  await pagina.setViewportSize({ width: 390, height: 844 });
}

test("marcar sobrevive a la recarga, funciona sin red y 'No me hace falta' se deshace (lis-ac1, lis-ac2, lis-ac4, lis-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba();
  const email = "ci-test-prep-duenyo@example.com";
  const planId = await sembrar(supabase, email);
  const contexto = await browser.newContext();
  await entrar(contexto, email);
  const pagina = await contexto.newPage();
  await pagina.goto(`/plan/${planId}`);

  const seccion = pagina.locator("details.seccion-preparativos");
  await seccion.locator("summary").click();
  await expect(pagina.getByTestId("preparativos-progreso")).toBeVisible();
  await expect(pagina.getByText("Pañales").first()).toBeVisible();
  await enTodosLosTamanos(pagina, "lista");

  // Con red: marca, recarga y sigue marcada.
  const primera = pagina.getByTestId("preparativo").first();
  const nombre = (await primera.locator(".casilla-preparativo span").innerText()).trim();
  await primera.getByRole("checkbox").check();
  await expect(primera).toHaveAttribute("data-estado", "hecho");
  await expect(pagina.getByTestId("preparativos-sin-subir")).toHaveCount(0, { timeout: 15_000 });
  await pagina.reload();
  await seccion.locator("summary").click();
  await expect(pagina.getByTestId("preparativo").filter({ hasText: nombre }).first()).toHaveAttribute("data-estado", "hecho");

  // Sin red: la marca es inmediata y queda pendiente de subir.
  await contexto.setOffline(true);
  const segunda = pagina.getByTestId("preparativo").nth(1);
  await segunda.getByRole("checkbox").check();
  await expect(segunda).toHaveAttribute("data-estado", "hecho");
  await expect(pagina.getByTestId("preparativos-sin-subir")).toBeVisible();
  await enTodosLosTamanos(pagina, "sin-red");
  await contexto.setOffline(false);
  await pagina.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pagina.getByTestId("preparativos-sin-subir")).toHaveCount(0, { timeout: 20_000 });

  // "No me hace falta" con deshacer.
  const tercera = pagina.getByTestId("preparativo").nth(2);
  const textoTercera = (await tercera.locator(".casilla-preparativo span").innerText()).trim();
  await tercera.getByRole("button", { name: "No me hace falta" }).click();
  await expect(pagina.getByTestId("preparativos-deshacer")).toBeVisible();
  await pagina.getByTestId("preparativos-deshacer").getByRole("button").click();
  await expect(pagina.getByTestId("preparativo").filter({ hasText: textoTercera }).first()).toBeVisible();

  await comprobarAccesibilidad(pagina);
  await contexto.close();
});
