import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// aud-ac1/aud-ac2/aud-ac3: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL_A = "ci-test-recorrido@example.com";
const DESTINO_A = "Valencia";
const EPOCA_A = "verano";
const DIAS_A = 4;
const PRESUPUESTO_A = 800;
const EDAD_A = 40;
const DESTINO_B = "Refugio Secreto de B";

const RECOMENDACIONES_A = [
  { tipo: "comida", nombre: "Mercado Central de Valencia", motivo: "Producto fresco y ambiente local." },
  { tipo: "recinto", nombre: "Ciudad de las Artes y las Ciencias", motivo: "Imprescindible, reserva con antelación." },
];

// aud-ac3: capturas de las cinco pantallas del recorrido, en claro y oscuro,
// sobre el estado final de main -eje visual que el issue #41 dejó sin
// verificar por no adjuntar ninguna.
async function capturarDosTemas(pagina: Page, nombre: string) {
  await pagina.screenshot({ path: `artefactos/capturas/recorrido-${nombre}-claro.png`, fullPage: true });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: `artefactos/capturas/recorrido-${nombre}-oscuro.png`, fullPage: true });
  await pagina.emulateMedia({ colorScheme: "light" });
}

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en plan-timeline.movil.e2e.ts y
// recomendaciones.movil.e2e.ts, los otros e2e que necesitan sembrar un plan
// real. Dos días con franjas no contiguas, como plan-timeline.movil.e2e.ts:
// si el orden del DOM viniera de las paradas o de la siembra en vez de
// `dia.franjas`/config-franjas.ts, este fixture lo pondría de manifiesto.
async function sembrarPlanDeDosDias(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO_A });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO_A);
  const dias = [
    {
      fecha: "2026-11-10",
      franjas,
      paradas: [
        { id: "d1-amanecer", franja_id: "manana-temprano", nombre: "Mirador del Turia al amanecer", descripcion: "Vistas antes del calor." },
        { id: "d1-comida", franja_id: "comida", nombre: "Taberna de la Lonja", descripcion: "Comida tradicional valenciana." },
        { id: "d1-cena", franja_id: "cena", nombre: "Arrocería del Cabanyal", descripcion: "Cena frente al mar." },
      ],
    },
    {
      fecha: "2026-11-11",
      franjas,
      paradas: [
        { id: "d2-manana", franja_id: "manana", nombre: "Torres de Serranos", descripcion: "Recorrido por la muralla histórica." },
        { id: "d2-tarde", franja_id: "tarde", nombre: "Jardín del Turia", descripcion: "Paseo por el cauce ajardinado." },
      ],
    },
  ];

  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: planId,
      version: 1,
      personas: 1,
      dias: dias.map((dia) => ({ fecha: dia.fecha, franjas: dia.franjas })),
      avisos: [],
      recomendaciones: RECOMENDACIONES_A,
    })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  for (const [diaIndex, dia] of dias.entries()) {
    for (const parada of dia.paradas) {
      const { data: procedencia, error: errorProcedencia } = await supabase
        .from("procedencias")
        .insert({ fuente: "propuesto-sin-verificar" })
        .select("id")
        .single();
      if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

      const { error: errorParada } = await supabase.from("paradas").insert({
        id_externo: `${planId}-${parada.id}`,
        plan_version_id: version.id,
        dia_index: diaIndex,
        franja_id: parada.franja_id,
        nombre: parada.nombre,
        descripcion: parada.descripcion,
        lat: 39.47 + diaIndex * 0.01,
        lon: -0.38,
        duracion_min: 90,
        prioridad: 60,
        procedencia_id: procedencia.id,
      });
      if (errorParada) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${errorParada.message}`);
    }
  }

  return dias;
}

async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 1, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

test("el recorrido completo funciona de punta a punta, y un segundo usuario no ve ni toca nada del primero (aud-ac1/aud-ac2/aud-ac3)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();

  // Usuario B: sembrado con la clave de servicio, sin iniciar sesión nunca
  // -mismo motivo ya documentado en mis-viajes.movil.e2e.ts- con un destino
  // literal inconfundible para poder afirmar su ausencia del HTML servido a A.
  const { data: usuarioB, error: errorB } = await supabase.auth.admin.createUser({
    email: `recorrido-b-${marca}@ej.com`,
    email_confirm: true,
  });
  if (errorB || !usuarioB.user) throw new Error(`No se pudo crear el usuario B: ${errorB?.message}`);
  const planIdB = `plan-recorrido-b-${marca}`;
  await sembrarPlanMinimo(supabase, planIdB, DESTINO_B);
  const { data: trabajoB, error: errorTrabajoB } = await supabase
    .from("trabajos")
    .insert({
      usuario_id: usuarioB.user.id,
      tipo: "generacion",
      criterios: { destino_o_tipo: DESTINO_B },
      estado: "completado",
      plan_id: planIdB,
    })
    .select("id")
    .single();
  if (errorTrabajoB || !trabajoB) throw new Error(`No se pudo sembrar el trabajo de B: ${errorTrabajoB?.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  // (a) desde la portada se llega al formulario, y al enviarlo se pide el correo.
  await pagina.goto("/");
  await pagina.getByRole("link", { name: "Cuéntanos tu viaje" }).click();
  await expect(pagina).toHaveURL("/criterios");

  await pagina.getByLabel("Destino o tipo de viaje").fill(DESTINO_A);
  await pagina.getByLabel("Época del año", { exact: true }).fill(EPOCA_A);
  await pagina.getByLabel("Número de días").fill(String(DIAS_A));
  await pagina.getByLabel("Presupuesto total (€)").fill(String(PRESUPUESTO_A));
  await pagina.getByLabel("Persona 1, edad").fill(String(EDAD_A));
  await pagina.getByRole("button", { name: "Continuar" }).click();
  await expect(pagina.getByRole("form", { name: "Pedir acceso" })).toBeVisible();

  await pagina.getByLabel("Tu correo").fill(EMAIL_A);
  await pagina.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(pagina.getByRole("form", { name: "Introducir código" })).toBeVisible();

  // aud-ac3: captura del panel de acceso en su paso de código.
  await capturarDosTemas(pagina, "acceso-codigo");

  // (b) código real leído de Mailpit, tecleado sin salir de la pantalla.
  const codigo = await leerCodigo(EMAIL_A);
  await pagina.getByLabel("Código de acceso").fill(codigo);
  await pagina.getByRole("button", { name: "Confirmar código" }).click();

  await pagina.waitForURL(/\/trabajos\/[^/]+$/);
  const trabajoId = new URL(pagina.url()).pathname.split("/").pop()!;

  const { data: trabajoEncolado, error: errorTrabajoEncolado } = await supabase
    .from("trabajos")
    .select("estado, criterios")
    .eq("id", trabajoId)
    .single();
  if (errorTrabajoEncolado || !trabajoEncolado) throw new Error(`No se encontró el trabajo ${trabajoId}: ${errorTrabajoEncolado?.message}`);
  expect(trabajoEncolado.estado).toBe("encolado");
  expect(trabajoEncolado.criterios).toMatchObject({
    destino_o_tipo: DESTINO_A,
    fechas: { modo: "epoca", epoca: EPOCA_A },
    dias: DIAS_A,
    presupuesto_eur: PRESUPUESTO_A,
    personas: [{ edad: EDAD_A }],
  });

  // (c) la pantalla de progreso muestra el estado real de ese trabajo.
  await expect(pagina.getByRole("heading", { name: "Tu viaje se está generando" })).toBeVisible();
  await capturarDosTemas(pagina, "progreso");

  // No hay binario `claude` en CI: el plan se siembra con la clave de
  // servicio, como el resto de e2e del producto -la invocación real del
  // modelo la cubre el bloque siguiente, enlaces-nunca-del-modelo.
  const planId = `plan-recorrido-${marca}`;
  const dias = await sembrarPlanDeDosDias(supabase, planId);
  const { error: errorCompletar } = await supabase
    .from("trabajos")
    .update({ estado: "completado", plan_id: planId })
    .eq("id", trabajoId);
  if (errorCompletar) throw new Error(`No se pudo completar el trabajo: ${errorCompletar.message}`);

  // La pantalla de progreso consulta cada 3s (PantallaProgreso.tsx):
  // esperamos su propio sondeo en vez de recargar, para probar el mismo
  // camino que recorre un usuario real que deja la pestaña abierta.
  const enlacePlan = pagina.getByRole("link", { name: "Ver el itinerario" });
  await expect(enlacePlan).toBeVisible({ timeout: 15000 });
  await expect(enlacePlan).toHaveAttribute("href", `/plan/${planId}`);

  // (d) el plan se ve como línea de tiempo, con los días en orden, las
  // franjas en el orden de config-franjas.ts, y sus recomendaciones visibles.
  await enlacePlan.click();
  await expect(pagina).toHaveURL(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO_A })).toBeVisible();

  const encabezadosDia = pagina.locator("section.seccion-dia h2");
  await expect(encabezadosDia).toHaveText([dias[0].fecha, dias[1].fecha]);
  const seccionDia1 = pagina.locator("section.seccion-dia").nth(0);
  await expect(seccionDia1.locator(".cabecera-franja h3")).toHaveText(["Mañana temprano", "Comida", "Cena"]);
  const seccionDia2 = pagina.locator("section.seccion-dia").nth(1);
  await expect(seccionDia2.locator(".cabecera-franja h3")).toHaveText(["Mañana", "Tarde"]);

  await expect(pagina.getByRole("heading", { name: "Más sitios recomendados" })).toBeVisible();
  for (const reco of RECOMENDACIONES_A) {
    await expect(pagina.getByRole("link", { name: reco.nombre, exact: true })).toBeVisible();
    await expect(pagina.getByText(reco.motivo)).toBeVisible();
  }

  await capturarDosTemas(pagina, "plan");

  // aud-ac2: aislamiento entre dos usuarios sobre el estado final -ni el
  // trabajo, ni el plan, ni el destino de B aparecen en nada servido a A.
  const respuestaViajesA = await contexto.request.get("/api/viajes");
  expect(respuestaViajesA.ok()).toBe(true);
  const cuerpoViajesA = await respuestaViajesA.json();

  const respuestaViajesConParametroB = await contexto.request.get(`/api/viajes?usuario_id=${usuarioB.user.id}`);
  expect(respuestaViajesConParametroB.ok()).toBe(true);
  const cuerpoViajesConParametroB = await respuestaViajesConParametroB.json();
  // El filtro vive en el SERVIDOR: nombrar a B en la petición no cambia nada.
  expect(cuerpoViajesConParametroB).toEqual(cuerpoViajesA);

  const respuestaBorradoB = await contexto.request.delete(`/api/viajes/${trabajoB.id}`);
  expect(respuestaBorradoB.status()).toBe(404);
  const { data: filaB } = await supabase.from("trabajos").select("eliminado_en").eq("id", trabajoB.id).single();
  expect(filaB?.eliminado_en).toBeNull();

  const respuestaPlanB = await contexto.request.get(`/api/plan/${planIdB}`);
  expect(respuestaPlanB.status()).toBe(404);

  // (e) «Mis viajes», alcanzado desde el pie sin teclear ninguna dirección,
  // lista ese viaje y su enlace lleva a su plan.
  await pagina.goto("/");
  await pagina.locator("footer").getByRole("link", { name: "Mis viajes" }).click();
  await expect(pagina).toHaveURL("/viajes");
  await expect(pagina.getByText(DESTINO_A)).toBeVisible();

  const html = await pagina.content();
  expect(html).not.toContain(trabajoB.id);
  expect(html).not.toContain(planIdB);
  expect(html).not.toContain(DESTINO_B);

  const enlacePlanDesdeListado = pagina.getByRole("link", { name: "Ver el itinerario" });
  await expect(enlacePlanDesdeListado).toHaveAttribute("href", `/plan/${planId}`);

  await capturarDosTemas(pagina, "mis-viajes");

  // (f) al eliminarlo con confirmación, desaparece de la lista Y su plan
  // pasa a responder 404 a su propio dueño.
  await pagina.getByRole("button", { name: "Eliminar" }).click();
  const dialogo = pagina.getByRole("alertdialog", { name: new RegExp(DESTINO_A) });
  await expect(dialogo).toBeVisible();
  await capturarDosTemas(pagina, "eliminar");

  await dialogo.getByRole("button", { name: "Eliminar de verdad" }).click();
  await expect(pagina.getByText(DESTINO_A)).toHaveCount(0);

  const { data: filaTrasConfirmar } = await supabase.from("trabajos").select("eliminado_en").eq("id", trabajoId).single();
  expect(filaTrasConfirmar?.eliminado_en).not.toBeNull();

  const respuestaPlanPropio = await contexto.request.get(`/api/plan/${planId}`);
  expect(respuestaPlanPropio.status()).toBe(404);

  await contexto.close();
});

// aud-ac4(a): un fallo de /api/viajes se explica con un mensaje, nunca con
// una lista vacía silenciosa -re-verificado sobre el estado final de main,
// mismo patrón que mis-viajes.movil.e2e.ts (viajes-ac4).
test("un fallo de /api/viajes muestra un mensaje de error, no el estado vacío (aud-ac4)", async ({ page }) => {
  await page.route("**/api/viajes", (route) => route.fulfill({ status: 500, json: { error: "fallo forzado" } }));
  await page.goto("/viajes");

  const aviso = page.getByRole("alert").filter({ hasText: /no se ha podido cargar/i });
  await expect(aviso).toBeVisible();
  await expect(page.getByText(/todavía no has pedido ningún viaje/i)).toHaveCount(0);
});
