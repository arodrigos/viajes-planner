import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// arr-ac1..ac5 (uat-04, uat-05, uat-06): arreglar un conflicto de horario con
// un toque contra la ruta y la función SQL reales. El cierre del lunes lo fuerza
// el gancho `forzarHorarioParada`, solo en el navegador.
const DESTINO = "Granada";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
const CORREO = "ci-test-arreglo-un-toque@example.com";
// 2027-06-07 es lunes. El «hoy» queda antes del viaje para que no salga la tarjeta Ahora.
const ANTES_DEL_VIAJE = "2027-06-01T07:30:00Z";
const CIERRA_EL_LUNES = "Mo off; Tu-Su 08:00-20:00";
const PARADAS = [
  { id: "p-arr-1", nombre: "Museo del lunes", franja: "manana", lat: 37.1761, lon: -3.5881 },
  { id: "p-arr-2", nombre: "Museo siempre abierto", franja: "tarde", lat: 37.1815, lon: -3.5925 },
];
const TAMANOS = [
  { nombre: "360x640", width: 360, height: 640 },
  { nombre: "820x1180", width: 820, height: 1180 },
  { nombre: "1180x820", width: 1180, height: 820 },
];

async function sembrarPlan(supabase: SupabaseClient, usuarioId: string, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = franjasComoArray(DESTINO);
  const dias = ["2027-06-07", "2027-06-08"].map((fecha) => ({ fecha, franjas }));
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita de prueba",
      lat: p.lat,
      lon: p.lon,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: {
        fuente: "osm",
        id: `osm:node/${p.id}-${planId}`,
        url: `https://www.openstreetmap.org/node/${p.id}`,
        nombre_fuente: p.nombre,
        etiquetas: { opening_hours: "Mo-Su 00:00-24:00", check_date_opening_hours: "2026-05-01" },
        resuelto_en: RESUELTO_EN,
      },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
}

async function versionMaxima(supabase: SupabaseClient, planId: string): Promise<number> {
  const { data } = await supabase.from("plan_versiones").select("version").eq("plan_id", planId).order("version", { ascending: false }).limit(1).single();
  return data?.version ?? 0;
}

const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { hasText: nombre });
const forzar = (pagina: Page, paradaId: string, reglaOsm: string) =>
  pagina.evaluate(([id, regla]) => (window as unknown as { __debug: { forzarHorarioParada: (e: object) => void } }).__debug.forzarHorarioParada({ paradaId: id, opening_hours: regla }), [paradaId, reglaOsm]);

async function entrar(pagina: Page, planId: string, dia: number) {
  const contexto = pagina.context();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } })).ok()).toBe(true);
  const codigo = await leerCodigo(CORREO);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } })).ok()).toBe(true);
  await pagina.clock.install({ time: new Date(ANTES_DEL_VIAJE) });
  await pagina.goto(`/plan/${planId}?dia=${dia}&pruebas=1`);
  // Los ganchos de prueba se instalan al montar el panel del día.
  await expect(tarjeta(pagina, "Museo del lunes")).toBeVisible();
}

test.describe("arreglar un conflicto con un toque", () => {
  // Un solo worker siembra: createUser falla si dos beforeAll compiten por el mismo correo.
  test.describe.configure({ mode: "serial" });
  let usuarioId: string;
  const supabase = clienteDePrueba("servicio");

  test.beforeAll(async () => {
    const { data, error } = await supabase.auth.admin.createUser({ email: CORREO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  for (const tamano of TAMANOS) {
    test(`llevar la parada al martes y deshacer, a ${tamano.nombre} (arr-ac1, arr-ac2, arr-ac3)`, async ({ browser }) => {
      const planId = `plan-arreglo-e2e-${tamano.nombre}`;
      await sembrarPlan(supabase, usuarioId, planId);
      const contexto = await browser.newContext({ viewport: { width: tamano.width, height: tamano.height } });
      const pagina = await contexto.newPage();
      await entrar(pagina, planId, 1);
      await forzar(pagina, "p-arr-1", CIERRA_EL_LUNES);
      const lunes = tarjeta(pagina, "Museo del lunes");
      await expect(pagina.getByTestId("contador-conflictos")).toHaveText("1 conflicto");

      // uat-04: la hoja con su opción, su motivo y «Dejarla como está».
      await lunes.getByTestId("arreglar-parada").click();
      const hoja = pagina.getByTestId("hoja-arreglos");
      await expect(hoja).toBeVisible();
      await expect(hoja.getByTestId("arreglo-otro-dia")).toContainText(/Llevar al martes.*abre de 08:00 a 20:00/);
      await expect(hoja.getByTestId("arreglo-dejarla")).toBeVisible();
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await capturar(pagina, "arreglo-un-toque", `hoja-${tamano.nombre}`);

      // uat-05: la parada sale del lunes y el aviso ofrece Deshacer.
      await hoja.getByTestId("arreglo-otro-dia").click();
      await expect(lunes).toHaveCount(0);
      await expect(pagina.getByTestId("contador-conflictos")).toHaveCount(0);
      const aviso = pagina.getByTestId("aviso-arreglo");
      await expect(aviso).toContainText("Movida al martes 8");
      await expect(aviso.getByRole("button", { name: "Deshacer" })).toBeVisible();
      await capturar(pagina, "arreglo-un-toque", `movida-${tamano.nombre}`);

      // uat-06: Deshacer devuelve la parada al lunes, a su franja y en primer lugar, con otra versión.
      await aviso.getByRole("button", { name: "Deshacer" }).click();
      await expect(aviso).toContainText("Parada restaurada");
      await expect(lunes).toBeVisible();
      await expect(pagina.getByTestId("contador-conflictos")).toHaveText("1 conflicto");
      await expect.poll(() => versionMaxima(supabase, planId)).toBe(3);
      await expect(pagina.locator("li.tarjeta-parada").first()).toContainText("Museo del lunes");
      await capturar(pagina, "arreglo-un-toque", `deshecha-${tamano.nombre}`);
      await contexto.close();
    });
  }

  test("Deshacer tocado cuando el arreglo ya se guardó devuelve la parada al lunes (arr-ac1, arr-ac3)", async ({ browser }) => {
    const planId = "plan-arreglo-e2e-deshacer-tarde";
    await sembrarPlan(supabase, usuarioId, planId);
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, planId, 1);
    await forzar(pagina, "p-arr-1", CIERRA_EL_LUNES);
    await tarjeta(pagina, "Museo del lunes").getByTestId("arreglar-parada").click();
    await pagina.getByTestId("arreglo-otro-dia").click();
    const aviso = pagina.getByTestId("aviso-arreglo");
    await expect(aviso).toContainText("Movida al martes 8");
    // arr-ac1: la versión subió en uno; con el arreglo ya guardado (y releído), el
    // Deshacer debe salir con la versión que devolvió el servidor, no la de antes.
    await expect.poll(() => versionMaxima(supabase, planId)).toBe(2);
    await pagina.waitForTimeout(1500);
    await aviso.getByRole("button", { name: "Deshacer" }).click();
    await expect(tarjeta(pagina, "Museo del lunes")).toBeVisible();
    await expect(aviso).toContainText("Parada restaurada");
    await expect.poll(() => versionMaxima(supabase, planId)).toBe(3);
    await expect(pagina.locator("li.tarjeta-parada").first()).toContainText("Museo del lunes");
    await contexto.close();
  });

  test("tras recargar la parada sigue en el día de destino (arr-ac1)", async ({ browser }) => {
    const planId = "plan-arreglo-e2e-recarga";
    await sembrarPlan(supabase, usuarioId, planId);
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, planId, 1);
    await forzar(pagina, "p-arr-1", CIERRA_EL_LUNES);
    await tarjeta(pagina, "Museo del lunes").getByTestId("arreglar-parada").click();
    await pagina.getByTestId("arreglo-otro-dia").click();
    await expect(pagina.getByTestId("aviso-arreglo")).toContainText("Movida al martes 8");
    await expect.poll(() => versionMaxima(supabase, planId)).toBe(2);
    await pagina.goto(`/plan/${planId}?dia=2&pruebas=1`);
    await expect(tarjeta(pagina, "Museo del lunes")).toBeVisible();
    await pagina.goto(`/plan/${planId}?dia=1&pruebas=1`);
    await expect(tarjeta(pagina, "Museo siempre abierto")).toBeVisible();
    await expect(tarjeta(pagina, "Museo del lunes")).toHaveCount(0);
    await contexto.close();
  });

  test("arreglo, Deshacer y otro arreglo seguidos, con el servidor lento, no pierden ningún toque (arr-ac1, arr-ac3)", async ({ browser }) => {
    const planId = "plan-arreglo-e2e-encadenado";
    await sembrarPlan(supabase, usuarioId, planId);
    const contexto = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, planId, 1);
    await forzar(pagina, "p-arr-1", CIERRA_EL_LUNES);
    // El servidor tarda 2 s en cada movimiento: reproduce el UAT, donde se toca
    // Deshacer y el siguiente arreglo con el guardado anterior aún en vuelo.
    await pagina.route("**/mover-dia", async (ruta) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await ruta.continue();
    });
    const lunes = tarjeta(pagina, "Museo del lunes");
    await lunes.getByTestId("arreglar-parada").click();
    await pagina.getByTestId("arreglo-otro-dia").click();
    const aviso = pagina.getByTestId("aviso-arreglo");
    await expect(aviso).toContainText("Movida al martes 8", { timeout: 1_000 });
    await aviso.getByRole("button", { name: "Deshacer" }).click();
    await expect(lunes).toBeVisible({ timeout: 1_000 });
    await expect(pagina.locator("li.tarjeta-parada").first()).toContainText("Museo del lunes");
    await lunes.getByTestId("arreglar-parada").click();
    await pagina.getByTestId("arreglo-otro-dia").click();
    await expect(lunes).toHaveCount(0, { timeout: 1_000 });
    await expect(aviso).toContainText("Movida al martes 8", { timeout: 1_000 });
    await expect.poll(() => versionMaxima(supabase, planId), { timeout: 20_000 }).toBe(4);
    await contexto.close();
  });

  test("si el servidor falla la parada se queda donde estaba y se dice (arr-ac5)", async ({ browser }) => {
    const planId = "plan-arreglo-e2e-fallo";
    await sembrarPlan(supabase, usuarioId, planId);
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, planId, 1);
    await forzar(pagina, "p-arr-1", CIERRA_EL_LUNES);
    await pagina.route("**/mover-dia", (ruta) => ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "interno", mensaje: "x" }) }));
    const lunes = tarjeta(pagina, "Museo del lunes");
    await lunes.getByTestId("arreglar-parada").click();
    await pagina.getByTestId("arreglo-otro-dia").click();
    await expect(pagina.getByTestId("aviso-arreglo")).toContainText("No se ha podido mover la parada");
    await expect(lunes).toBeVisible();
    await expect(lunes.getByTestId("conflicto-parada")).toBeVisible();
    expect(await versionMaxima(supabase, planId)).toBe(1);
    for (const tamano of TAMANOS) {
      await pagina.setViewportSize({ width: tamano.width, height: tamano.height });
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await capturar(pagina, "arreglo-un-toque", `error-${tamano.nombre}`);
    }
    await contexto.close();
  });
});
