import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// off-ac1..off-ac4 (uat-17, uat-18): apuntar sin conexión, subir solo al volver
// la red (una sola vez), el aviso de sesión caducada y el rechazo en rojo. La
// pestaña se queda abierta con la página ya cargada: lo que se prueba es la cola,
// no el service worker (que este bloque no toca).
test.use({ viewport: { width: 390, height: 844 } });

const BLOQUE = "gastos-sin-conexion";
const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-off-${Date.now()}`;
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
    id_externo: `p-off-${Date.now()}`,
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
    await capturar(pagina, BLOQUE, `${nombre}-${t.ancho}`);
  }
}

async function entrar(browser: import("@playwright/test").Browser, email: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } })).ok()).toBe(true);
  return contexto;
}

async function apuntarEntradas(pagina: Page, importe: string) {
  await pagina.getByLabel("Importe (€)").fill(importe);
  await pagina.getByRole("button", { name: "Entradas" }).click();
  await pagina.getByRole("button", { name: "Apuntar" }).click();
}

async function abrirGastos(contexto: BrowserContext, planId: string) {
  const pagina = await contexto.newPage();
  await pagina.goto(`/plan/${planId}`);
  await pagina.getByText("Gastos", { exact: true }).click();
  await expect(pagina.getByTestId("gastos-titular")).toBeVisible();
  return pagina;
}

test("sin conexión se apunta, se ve pendiente y al volver la red se sube una sola vez (off-ac1, off-ac2)", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = "ci-test-sin-conexion@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await entrar(browser, email);
  const pagina = await abrirGastos(contexto, planId);

  // Un gasto ya subido, para que haya espejo y se vea que no se pierde ni se duplica.
  await pagina.getByLabel("Importe (€)").fill("10");
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  await expect(pagina.getByTestId("gasto")).toHaveCount(1);
  await expect(pagina.getByTestId("gasto-pendiente")).toHaveCount(0);
  const titularAntes = await pagina.getByTestId("gastos-titular").innerText();

  // uat-17
  await contexto.setOffline(true);
  await apuntarEntradas(pagina, "12");
  await expect(pagina.getByTestId("gasto")).toHaveCount(2);
  await expect(pagina.getByTestId("gasto-pendiente")).toHaveText("Pendiente de subir");
  await expect(pagina.getByTestId("gastos-sin-subir")).toHaveText("1 gasto sin subir");
  await expect(pagina.getByTestId("gastos-titular")).not.toHaveText(titularAntes);
  await pagina.getByTestId("gastos-sin-subir").scrollIntoViewIfNeeded();
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "pendiente");

  // uat-18
  await contexto.setOffline(false);
  await expect(pagina.getByTestId("gasto-pendiente")).toHaveCount(0, { timeout: 5_000 });
  await expect(pagina.getByTestId("gastos-sin-subir")).toHaveCount(0);
  await pagina.getByTestId("gastos-titular").scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "subido");
  const lista = (await (await contexto.request.get(`/api/plan/${planId}/gastos`)).json()) as { importe_centimos: number; categoria: string }[];
  expect(lista).toHaveLength(2);
  expect(lista.filter((g) => g.importe_centimos === 1200 && g.categoria === "entradas")).toHaveLength(1);
  await pagina.reload();
  await pagina.getByText("Gastos", { exact: true }).click();
  await expect(pagina.getByTestId("gasto")).toHaveCount(2);
  await contexto.close();
});

test("con la sesión caducada el gasto no se pierde y un rechazo se queda en rojo (off-ac3, off-ac4)", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = "ci-test-sin-conexion-401@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await entrar(browser, email);
  const pagina = await abrirGastos(contexto, planId);

  // off-ac3: el servidor contesta 401 a la subida, como con la cookie caducada.
  await contexto.route("**/api/plan/*/gastos/*", (ruta) => (ruta.request().method() === "PUT" ? ruta.fulfill({ status: 401, json: { error: "Sin sesión" } }) : ruta.continue()));
  await apuntarEntradas(pagina, "12");
  await expect(pagina.getByTestId("gastos-sin-sesion")).toContainText("Inicia sesión para subir 1 gasto");
  await expect(pagina.getByTestId("gasto")).toHaveCount(1);
  await pagina.getByTestId("gastos-sin-sesion").scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "sin-sesion");
  await contexto.unroute("**/api/plan/*/gastos/*");
  await pagina.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pagina.getByTestId("gastos-sin-sesion")).toHaveCount(0, { timeout: 5_000 });
  await expect(pagina.getByTestId("gasto-pendiente")).toHaveCount(0);

  // off-ac4: un rechazo (400) no desaparece solo y deja Editar y Descartar.
  await contexto.route("**/api/plan/*/gastos/*", (ruta) => (ruta.request().method() === "PUT" ? ruta.fulfill({ status: 400, json: { error: "Ese gasto no se puede guardar" } }) : ruta.continue()));
  await pagina.getByLabel("Importe (€)").fill("5");
  await pagina.getByRole("button", { name: "Apuntar" }).click();
  const rechazado = pagina.getByTestId("gasto-rechazado");
  await expect(rechazado).toHaveText("No se ha podido subir: Ese gasto no se puede guardar");
  const fila = pagina.locator("li[data-estado=rechazado]");
  await expect(fila.getByRole("button", { name: "Editar" })).toBeVisible();
  await rechazado.scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "rechazado");
  await fila.getByRole("button", { name: "Descartar" }).click();
  await expect(pagina.getByTestId("gasto-rechazado")).toHaveCount(0);
  await contexto.close();
});
