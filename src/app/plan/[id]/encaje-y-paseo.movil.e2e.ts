import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// enc-ac1/enc-ac2: viewport móvil real, mismo patrón que el resto de
// *.movil.e2e.ts.
test.use({ viewport: { width: 393, height: 851 } });

const DESTINO = "Madrid";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
// Martes real: "Mo-Su 10:00-20:00; Tu off" cierra ese día entero.
const FECHA_MARTES = "2026-10-06";

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo documentado en plan-timeline.movil.e2e.ts.
async function sembrarParada(
  supabase: SupabaseClient,
  versionId: string,
  diaIndex: number,
  datos: { idExterno: string; franjaId: string; nombre: string; lat: number; lon: number; duracion_min: number; categoria?: string },
) {
  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: "propuesto-sin-verificar" })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  const { data: parada, error: errorParada } = await supabase
    .from("paradas")
    .insert({
      id_externo: datos.idExterno,
      plan_version_id: versionId,
      dia_index: diaIndex,
      franja_id: datos.franjaId,
      nombre: datos.nombre,
      descripcion: "Visita",
      lat: datos.lat,
      lon: datos.lon,
      duracion_min: datos.duracion_min,
      prioridad: 60,
      procedencia_id: procedencia.id,
      categoria: datos.categoria ?? null,
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    })
    .select("id")
    .single();
  if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada '${datos.idExterno}': ${errorParada?.message}`);
  return parada.id as string;
}

test("una alternativa muestra sus etiquetas de encaje calculadas (enc-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-encaje@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-encaje-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA_MARTES, franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  // Anterior - parada - siguiente, las tres en la franja de mañana
  // (09:00), muy cerca entre sí para que la alternativa tenga vecinos
  // resueltos a distancia pequeña y comprobable.
  await sembrarParada(supabase, version.id, 0, { idExterno: "anterior", franjaId: "manana", nombre: "Puerta del Sol", lat: 40.4169, lon: -3.7035, duracion_min: 30 });
  const idParada = await sembrarParada(supabase, version.id, 0, {
    idExterno: "parada-1",
    franjaId: "manana",
    nombre: "Museo del Prado",
    lat: 40.4138,
    lon: -3.6921,
    duracion_min: 90,
    categoria: "museo",
  });
  await sembrarParada(supabase, version.id, 0, { idExterno: "siguiente", franjaId: "manana", nombre: "Retiro", lat: 40.4153, lon: -3.6844, duracion_min: 60 });

  const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
    parada_id: idParada,
    origen: "modelo",
    nombre: "Museo Thyssen",
    descripcion: "Pinacoteca",
    motivo: "mismo tipo",
    duracion_min: 95,
    categoria: "museo",
    lat: 40.415,
    lon: -3.694,
    lugar: {
      fuente: "osm",
      id: "osm:node/2",
      url: "https://www.openstreetmap.org/node/2",
      nombre_fuente: "Museo Thyssen",
      etiquetas: { opening_hours: "Mo-Su 10:00-20:00; Tu off" },
      resuelto_en: RESUELTO_EN,
    },
  });
  if (errorAlternativa) throw new Error(`No se pudo sembrar la alternativa: ${errorAlternativa.message}`);

  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "familiar" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Museo del Prado" });
  await tarjeta.getByRole("button", { name: "Cambiar por una alternativa" }).click();
  await expect(tarjeta.getByText("Museo Thyssen")).toBeVisible();

  const etiquetas = tarjeta.locator(".etiquetas-encaje");
  await expect(etiquetas.getByText(/A \d+ m de la parada anterior/)).toBeVisible();
  await expect(etiquetas.getByText(/A \d+ m de la siguiente parada/)).toBeVisible();
  await expect(etiquetas.getByText("Misma categoría (museo)")).toBeVisible();
  await expect(etiquetas.getByText("Duración similar")).toBeVisible();
  // "Tu off": un martes está cerrado todo el día.
  await expect(etiquetas.getByText("Cerrado a esa hora")).toBeVisible();

  await contexto.close();
});

test("un día con mucho paseo muestra el aviso y abre el panel de la parada más alejada (enc-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-paseo@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-paseo-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA_MARTES, franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  // a-b ~1 km, b-c ~9,5 km (en línea recta) -- la parada "Excursión lejana"
  // es la que más desvío añade, igual que el caso de paseo.test.ts.
  await sembrarParada(supabase, version.id, 0, { idExterno: "a", franjaId: "manana", nombre: "Puerta del Sol", lat: 40.4, lon: -3.6, duracion_min: 30 });
  await sembrarParada(supabase, version.id, 0, { idExterno: "b", franjaId: "tarde", nombre: "Plaza Mayor", lat: 40.409, lon: -3.6, duracion_min: 30 });
  await sembrarParada(supabase, version.id, 0, { idExterno: "c", franjaId: "cena", nombre: "Excursión lejana", lat: 40.491, lon: -3.6, duracion_min: 30 });

  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "familiar" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const paseo = pagina.locator(".paseo-dia");
  await expect(paseo).toContainText("Paseo estimado:");
  await expect(paseo).toContainText("Excursión lejana");

  await paseo.getByRole("button", { name: "Ver sus alternativas" }).click();
  const tarjeta = pagina.locator(".tarjeta-parada", { hasText: "Excursión lejana" });
  await expect(tarjeta.locator(".panel-alternativas")).toBeVisible();

  await contexto.close();
});
