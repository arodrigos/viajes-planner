import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// ape-ac3 (uat-01, uat-02): conflictos de horario contra la ruta real. El
// gancho `forzarHorarioParada` cambia la etiqueta solo en el navegador.
const DESTINO = "Granada";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
const CORREO = "ci-test-apertura-conflictos@example.com";
const SUFIJO = "apertura";
// 2027-06-07 es lunes. El «hoy» queda antes del viaje para que no salga la tarjeta Ahora.
const ANTES_DEL_VIAJE = "2027-06-01T07:30:00Z";
const PARADAS = [
  { id: "p-ape-1", nombre: "Museo del lunes", franja: "manana", lat: 37.1761, lon: -3.5881 },
  { id: "p-ape-2", nombre: "Museo por cita", franja: "comida", lat: 37.1793, lon: -3.5903 },
  { id: "p-ape-3", nombre: "Museo siempre abierto", franja: "tarde", lat: 37.1815, lon: -3.5925 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-apertura-e2e-${SUFIJO}`;
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
        id: `osm:node/${p.id}-${SUFIJO}`,
        url: `https://www.openstreetmap.org/node/${p.id}`,
        nombre_fuente: p.nombre,
        // Siempre abierto: el cierre lo fuerza cada test en el navegador.
        etiquetas: { opening_hours: "Mo-Su 00:00-24:00", check_date_opening_hours: "2026-05-01" },
        resuelto_en: RESUELTO_EN,
      },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { hasText: nombre });
const forzar = (pagina: Page, paradaId: string, reglaOsm: string) =>
  pagina.evaluate(([id, regla]) => (window as unknown as { __debug: { forzarHorarioParada: (e: object) => void } }).__debug.forzarHorarioParada({ paradaId: id, opening_hours: regla }), [paradaId, reglaOsm]);

const TAMANOS = [
  { nombre: "360x640", width: 360, height: 640 },
  { nombre: "820x1180", width: 820, height: 1180 },
  { nombre: "1180x820", width: 1180, height: 820 },
];

test.describe("conflictos de horario", () => {
  let planId: string;

  test.beforeAll(async () => {
    planId = await sembrar(clienteDePrueba("servicio"), CORREO);
  });

  test("un lunes cerrado sale en rojo, lo desconocido en gris y solo lo primero cuenta (ape-ac3)", async ({ browser }) => {
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const pagina = await contexto.newPage();
    const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } });
    expect(solicitud.ok()).toBe(true);
    const codigo = await leerCodigo(CORREO);
    expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } })).ok()).toBe(true);
    await pagina.clock.install({ time: new Date(ANTES_DEL_VIAJE) });
    await pagina.goto(`/plan/${planId}?pruebas=1`);

    // Sin conflictos: ni contador ni distintivos.
    await expect(tarjeta(pagina, "Museo del lunes")).toBeVisible();
    await expect(pagina.getByTestId("contador-conflictos")).toHaveCount(0);

    await forzar(pagina, "p-ape-1", "Mo off; Tu-Su 10:00-18:00");
    const lunes = tarjeta(pagina, "Museo del lunes");
    await expect(lunes.getByTestId("conflicto-parada")).toContainText("Cerrado el lunes");
    await expect(lunes.getByTestId("fuente-conflicto")).toContainText("Horario de OpenStreetMap");
    await expect(pagina.getByTestId("contador-conflictos")).toHaveText("1 conflicto");

    await forzar(pagina, "p-ape-2", 'Mo-Su 10:00-18:00 "por cita"');
    await expect(tarjeta(pagina, "Museo por cita").getByTestId("horario-sin-confirmar")).toHaveText("Horario sin confirmar");
    await expect(pagina.getByTestId("contador-conflictos")).toHaveText("1 conflicto");

    for (const tamano of TAMANOS) {
      await pagina.setViewportSize({ width: tamano.width, height: tamano.height });
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await pagina.getByTestId("contador-conflictos").scrollIntoViewIfNeeded();
      await capturar(pagina, "apertura-conflictos", `cabecera-${tamano.nombre}`);
      await lunes.scrollIntoViewIfNeeded();
      await capturar(pagina, "apertura-conflictos", `tarjeta-${tamano.nombre}`);
    }
    await tarjeta(pagina, "Museo por cita").scrollIntoViewIfNeeded();
    await capturar(pagina, "apertura-conflictos", "sin-confirmar-1180x820");
    await contexto.close();
  });

  test("sin ?pruebas=1 el gancho no existe", async ({ browser }) => {
    const contexto = await browser.newContext();
    const pagina = await contexto.newPage();
    await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } });
    const codigo = await leerCodigo(CORREO);
    await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } });
    await pagina.goto(`/plan/${planId}`);
    await expect(tarjeta(pagina, "Museo del lunes")).toBeVisible();
    expect(await pagina.evaluate(() => "__debug" in window && "forzarHorarioParada" in (window as unknown as { __debug: object }).__debug)).toBe(false);
    await contexto.close();
  });
});
