import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerEnlaceMagico } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";

const EMAIL = "ci-test-final-ac2@example.com";

// Siembra directa con clienteDePrueba('servicio'), sin pasar por
// guardarPlan (server-only, repositorio.ts): fuera del build de Next.js
// "server-only" lanza siempre (mismo motivo documentado en
// vitest.integration.config.mts), y Playwright no tiene ese alias -por eso
// ningún otro *.e2e.ts de este repo importa un módulo server-only.
async function sembrarPlanDelFixture(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: planFixture.destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const primerDia = planFixture.dias[0];
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: planId,
      version: 1,
      personas: planFixture.personas,
      dias: [{ fecha: primerDia.fecha, ancla_alojamiento: primerDia.ancla_alojamiento, franjas: primerDia.franjas }],
      avisos: planFixture.avisos ?? [],
    })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  const primeraParada = primerDia.paradas[0];
  const { data: procedencia, error: errorProcedencia } = await supabase
    .from("procedencias")
    .insert({ fuente: primeraParada.procedencia.fuente })
    .select("id")
    .single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

  const { error: errorParada } = await supabase.from("paradas").insert({
    id_externo: primeraParada.id,
    plan_version_id: version.id,
    dia_index: 0,
    franja_id: primeraParada.franja_id,
    nombre: primeraParada.nombre,
    descripcion: primeraParada.descripcion,
    lat: primeraParada.coordenadas?.lat ?? null,
    lon: primeraParada.coordenadas?.lon ?? null,
    duracion_min: primeraParada.duracion_min,
    prioridad: primeraParada.prioridad,
    procedencia_id: procedencia.id,
  });
  if (errorParada) throw new Error(`No se pudo sembrar la parada: ${errorParada.message}`);
}

// final-ac2: punta a punta y SIN doblar la red -el efecto observable tiene
// que ser el dato persistido, no una respuesta fabricada por el propio
// test. La capa de presentación (completado con/sin plan_id) ya se prueba
// con la red doblada en progreso.e2e.ts; aquí se prueba que un toque real
// desde una pantalla de progreso real lleva al itinerario real.
test("desde la pantalla de progreso de un trabajo terminado, un toque lleva al itinerario de ESE plan", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const usuarioId = usuario.user.id;

  const planId = `plan-final-ac2-${Date.now()}`;
  await sembrarPlanDelFixture(supabase, planId);

  const { data: trabajo, error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId })
    .select("id")
    .single();
  if (errorTrabajo || !trabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo?.message}`);

  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();

  // Sesión real: se pide el enlace, se lee de Mailpit y se confirma.
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-enlace", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const enlace = await leerEnlaceMagico(EMAIL);
  await pagina.goto(enlace);
  await expect(pagina).toHaveURL(/\/criterios\?acceso=confirmado/);

  await pagina.goto(`/trabajos/${trabajo.id}`);

  // (i) existe un enlace VISIBLE cuyo href es exactamente /plan/<plan_id>.
  const enlacePlan = pagina.getByRole("link", { name: "Ver el itinerario" });
  await expect(enlacePlan).toBeVisible();
  await expect(enlacePlan).toHaveAttribute("href", `/plan/${planId}`);

  // (ii) se pulsa y la página de destino muestra contenido del plan
  // SEMBRADO, reconocido por su contenido y no por la URL.
  await enlacePlan.click();
  await expect(pagina).toHaveURL(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: planFixture.destino })).toBeVisible();
  await expect(pagina.getByText(planFixture.dias[0].paradas[0].nombre)).toBeVisible();

  await contexto.close();
});
