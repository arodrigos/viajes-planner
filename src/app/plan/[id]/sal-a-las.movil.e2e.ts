import { expect, test, type Browser } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// sal-ac1..ac3: la hora de salida de la tarjeta «Ahora». «Ahora» lo fija
// page.clock con segundos de colchón para que un minuto no cambie a mitad
// del test.
test.use({ viewport: { width: 390, height: 844 } });

const RESUELTO_EN = new Date("2026-10-04").toISOString();
const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "11:00" },
  { id: "comida", etiqueta: "Comida", hora_inicio: "11:40", hora_fin: "13:30" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" },
];

interface Destino {
  nombre: string;
  lat: number;
  lon: number;
}
const LISBOA: Destino = { nombre: "Lisboa", lat: 38.7139, lon: -9.1394 };

// Dos paradas a ~0,9 km en línea recta: tramo a pie de 20 min. La segunda
// arranca a las 11:40 por la hora de inicio de su franja.
function paradas(d: Destino) {
  return [
    { id: "p-sal-1", nombre: "Primera (ejemplo)", franja: "manana", lat: d.lat, lon: d.lon },
    { id: "p-sal-2", nombre: "Segunda (ejemplo)", franja: "comida", lat: d.lat + 0.0081, lon: d.lon },
  ];
}

async function sembrar(supabase: SupabaseClient, email: string, sufijo: string, destino: Destino) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-sal-${sufijo}-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: destino.nombre });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha) => ({ fecha, franjas: FRANJAS }));
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of paradas(destino)) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: `${p.id}-${sufijo}`,
      plan_version_id: version.id,
      dia_index: 1,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita guiada",
      lat: p.lat,
      lon: p.lon,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: { fuente: "osm", id: `osm:way/${p.id}-${sufijo}`, url: `https://www.openstreetmap.org/way/${p.id}`, nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
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

// Abre el plan a la hora local de Lisboa indicada (junio: UTC+1), con la
// primera parada ya marcada: la línea cuenta desde la segunda.
async function abrirConLaPrimeraVisitada(browser: Browser, email: string, planId: string, horaLisboa: string, timezoneId: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } });
  expect(verificacion.ok()).toBe(true);
  const [h, m, s] = horaLisboa.split(":").map(Number);
  await pagina.clock.install({ time: new Date(Date.UTC(2027, 5, 9, h - 1, m, s)) });
  await pagina.goto(`/plan/${planId}`);
  const ahora = pagina.getByRole("region", { name: "Ahora" });
  await ahora.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(ahora).toContainText("1 de 2 visitadas");
  return { contexto, ahora };
}

test("a tiempo: «Sal antes de las 11:15» (sal-ac1)", async ({ browser }) => {
  const email = "ci-test-sal-ac1@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "a", LISBOA);
  const { contexto, ahora } = await abrirConLaPrimeraVisitada(browser, email, planId, "10:30:10", "Europe/Lisbon");

  await expect(ahora).toContainText("Sal antes de las 11:15 para llegar a las 11:40 (≈ 20 min a pie)");
  await contexto.close();
});

test("pasada la hora de salida dice cuándo llegarías y cuánto tarde (sal-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const tarde = await sembrar(supabase, "ci-test-sal-ac2a@example.com", "b", LISBOA);
  const a = await abrirConLaPrimeraVisitada(browser, "ci-test-sal-ac2a@example.com", tarde, "11:30:10", "Europe/Lisbon");
  await expect(a.ahora).toContainText("Si sales ya, llegas a las 11:50 (10 min tarde)");
  await a.contexto.close();

  // Dentro del margen de 5 min: ya pasó la hora de salida, pero se llega a tiempo.
  const margen = await sembrar(supabase, "ci-test-sal-ac2b@example.com", "c", LISBOA);
  const b = await abrirConLaPrimeraVisitada(browser, "ci-test-sal-ac2b@example.com", margen, "11:16:10", "Europe/Lisbon");
  await expect(b.ahora).toContainText("Si sales ya, llegas a las 11:36");
  await expect(b.ahora).not.toContainText("tarde");
  await b.contexto.close();
});

test("el resultado no cambia con la zona horaria del móvil (sal-ac3)", async ({ browser }) => {
  const email = "ci-test-sal-ac3@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "d", LISBOA);
  const { contexto, ahora } = await abrirConLaPrimeraVisitada(browser, email, planId, "10:30:10", "America/New_York");

  await expect(ahora).toContainText("Sal antes de las 11:15 para llegar a las 11:40 (≈ 20 min a pie)");
  await contexto.close();
});
