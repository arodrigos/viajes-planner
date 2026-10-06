import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// hor-ac1 (cp-hor-01): rangos encadenados en la tarjeta y los mismos en el
// .ics, con la zona del lugar.
test.use({ viewport: { width: 390, height: 844 } });

const EMAIL = "ci-test-horario@example.com";
const DESTINO = "Lisboa";

// Tres paradas de Belém en la franja de mañana (09:00, la de por defecto):
// los intervalos esperados salen de duración + paseo a 4,5 km/h + 5 min.
const PARADAS = [
  { id: "p-hor-a", nombre: "Mosteiro dos Jerónimos", lat: 38.6979, lon: -9.2063, duracion: 90 },
  { id: "p-hor-b", nombre: "Torre de Belém", lat: 38.6916, lon: -9.216, duracion: 45 },
  { id: "p-hor-c", nombre: "Padrão dos Descobrimentos", lat: 38.6937, lon: -9.2057, duracion: 30 },
];

async function sembrarPlan(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  for (const p of PARADAS) {
    const { error } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: p.nombre,
      descripcion: "Visita",
      lat: p.lat,
      lon: p.lon,
      duracion_min: p.duracion,
      prioridad: 80,
      procedencia_id: procedencia.id,
      lugar: { fuente: "osm", id: `osm:way/${p.id}`, url: "https://www.openstreetmap.org/way/1", nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: new Date().toISOString() },
      resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() },
    });
    if (error) throw new Error(`No se pudo sembrar la parada '${p.id}': ${error.message}`);
  }
}

test("cada tarjeta enseña su rango y el .ics trae los mismos con TZID (hor-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-horario-e2e-${Date.now()}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  // Los rangos de la tarjeta, sin depender de que haya más texto alrededor.
  const rangos = await pagina.getByTestId("horario-parada").locator("time").allTextContents();
  expect(rangos).toHaveLength(PARADAS.length);
  expect(rangos[0]).toBe("09:00 – 10:30");
  for (const rango of rangos) expect(rango).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2}$/);
  // Sin horario OSM conocido, «Horario no disponible» y nunca uno inventado.
  await expect(pagina.getByTestId("horario-parada").first()).toContainText("Horario no disponible");

  // El .ics sale de la misma función: mismos rangos, en la zona del lugar.
  const respuesta = await contexto.request.get(`/api/plan/${planId}/calendario.ics`);
  expect(respuesta.ok()).toBe(true);
  const ics = await respuesta.text();
  const inicios = [...ics.matchAll(/^DTSTART;TZID=Europe\/Lisbon:\d{8}T(\d{2})(\d{2})00/gm)].map((m) => `${m[1]}:${m[2]}`);
  const fines = [...ics.matchAll(/^DTEND;TZID=Europe\/Lisbon:\d{8}T(\d{2})(\d{2})00/gm)].map((m) => `${m[1]}:${m[2]}`);
  expect(inicios.map((inicio, i) => `${inicio} – ${fines[i]}`)).toEqual(rangos);
  expect(ics).toContain("DTSTART;TZID=Europe/Lisbon:20261107T090000");

  await contexto.close();
});
