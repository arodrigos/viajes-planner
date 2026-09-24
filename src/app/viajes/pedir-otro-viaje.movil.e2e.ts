import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// otro-ac1/ac4/ac5: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-otro-viaje@example.com";
const DESTINO_SEMBRADO = "Lisboa";
const DESTINO_NUEVO = "Oporto";
const EPOCA = "primavera";
const DIAS = 3;
const PRESUPUESTO = 600;
const EDAD = 35;

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en mis-viajes.movil.e2e.ts y
// peso-visual.movil.e2e.ts. Un plan mínimo basta: lo que prueba este bloque
// es el camino hacia un viaje nuevo, no el contenido del primero.
async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

test("pedir-otro-viaje: «Mis viajes» con viajes lleva a pedir uno nuevo, y pulsarlo encola un trabajo de verdad (otro-ac1/ac2/ac4/ac5)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const planId = `plan-otro-viaje-${marca}`;

  const { data: usuario, error: errorUsuario } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (errorUsuario || !usuario.user) throw new Error(`No se pudo crear el usuario: ${errorUsuario?.message}`);

  await sembrarPlanMinimo(supabase, planId, DESTINO_SEMBRADO);
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({
    usuario_id: usuario.user.id,
    tipo: "generacion",
    criterios: { destino_o_tipo: DESTINO_SEMBRADO },
    estado: "completado",
    plan_id: planId,
  });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  // otro-ac1: el destino del control nuevo tiene que ser EXACTAMENTE el
  // mismo que el enlace principal de la portada, leído aquí mismo -nunca
  // una cadena escrita a mano, que es justo el precedente del "test de
  // destino seguro circular" que este bloque tiene que evitar.
  await pagina.goto("/");
  const hrefPortada = await pagina.getByRole("link", { name: "Cuéntanos tu viaje" }).getAttribute("href");
  expect(hrefPortada).toBeTruthy();

  await pagina.goto("/viajes");
  await expect(pagina.getByText(DESTINO_SEMBRADO)).toBeVisible();

  const control = pagina.getByRole("link", { name: "Pedir otro viaje" });
  await expect(control).toBeVisible();
  const hrefControl = await control.getAttribute("href");
  expect(hrefControl, "otro-ac1: mismo destino que el enlace principal de la portada").toBe(hrefPortada);

  const primerLi = pagina.locator("li").first();
  const cajaControl = await control.boundingBox();
  const cajaPrimerLi = await primerLi.boundingBox();
  if (!cajaControl || !cajaPrimerLi) throw new Error("No se pudo medir la posición del control o de la lista de viajes");
  expect(cajaControl.y, "otro-ac1: el control va por encima del primer viaje de la lista").toBeLessThan(cajaPrimerLi.y);

  // otro-ac4: capturas reales de «Mis viajes» CON viajes, a 393x851, en los
  // dos modos -para que el gatekeeper juzgue si el control se ve y se
  // entiende sin competir con «Ver el itinerario» ni con «Eliminar».
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-con-viajes-claro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-con-viajes-oscuro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "light" });

  // otro-ac5(a): el texto nombra la acción -pedir/planear un viaje nuevo-,
  // no un genérico "Continuar" o "Nuevo".
  await expect(control).toHaveText(/viaje/i);

  // otro-ac5(b): objetivo táctil >=44x44 medido en el propio control -no en
  // el de medirObjetivosTactiles, que exime de exigir ancho a los enlaces
  // dentro de un <p> (mismo motivo que el enlace principal de la portada);
  // aquí el criterio pide el ancho explícitamente, así que se mide aparte.
  expect(cajaControl.height, "otro-ac5: objetivo táctil de «Pedir otro viaje», alto").toBeGreaterThanOrEqual(44);
  expect(cajaControl.width, "otro-ac5: objetivo táctil de «Pedir otro viaje», ancho").toBeGreaterThanOrEqual(44);

  // otro-ac5(c): sin desbordamiento horizontal con el control añadido, a
  // 393px y a 320px -misma técnica que peso-ac6, vía medirObjetivosTactiles.
  for (const ancho of [393, 320]) {
    await pagina.setViewportSize({ width: ancho, height: 851 });
    const anchoDocumento = await pagina.evaluate(() => document.documentElement.scrollWidth);
    expect(anchoDocumento, `desbordamiento horizontal en /viajes a ${ancho}px`).toBeLessThanOrEqual(ancho);

    const elementos = await medirObjetivosTactiles(pagina);
    for (const el of elementos) {
      expect.soft(el.alto, `${el.descripcion} a ${ancho}px: alto`).toBeGreaterThanOrEqual(44);
      if (el.exigirAncho) {
        expect.soft(el.ancho, `${el.descripcion} a ${ancho}px: ancho`).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await pagina.setViewportSize({ width: 393, height: 851 });

  // otro-ac2: el camino sirve de verdad -pulsar el control encola un
  // trabajo nuevo en la base, no solo cambia la URL (issue #151: un botón
  // que no hacía nada, con un test que se conformaba con eso).
  const { count: trabajosAntes, error: errorAntes } = await supabase
    .from("trabajos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuario.user.id);
  if (errorAntes) throw new Error(`No se pudo contar los trabajos previos: ${errorAntes.message}`);

  await control.click();
  await expect(pagina).toHaveURL("/criterios");

  await pagina.getByLabel("Destino o tipo de viaje").fill(DESTINO_NUEVO);
  await pagina.getByLabel("Época del año", { exact: true }).fill(EPOCA);
  await pagina.getByLabel("Número de días").fill(String(DIAS));
  await pagina.getByLabel("Presupuesto total (€)").fill(String(PRESUPUESTO));
  await pagina.getByLabel("Persona 1, edad").fill(String(EDAD));
  await pagina.getByRole("button", { name: "Continuar" }).click();

  // La sesión ya está iniciada en este mismo contexto (verificamos el código
  // arriba): el envío no vuelve a pedir acceso, va directo a la pantalla de
  // progreso del trabajo nuevo.
  await pagina.waitForURL(/\/trabajos\/[^/]+$/);

  const { count: trabajosDespues, error: errorDespues } = await supabase
    .from("trabajos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuario.user.id);
  if (errorDespues) throw new Error(`No se pudo contar los trabajos tras el envío: ${errorDespues.message}`);
  expect(trabajosDespues, "otro-ac2: se encoló exactamente un trabajo nuevo").toBe((trabajosAntes ?? 0) + 1);

  const { data: trabajoNuevo, error: errorTrabajoNuevo } = await supabase
    .from("trabajos")
    .select("criterios")
    .eq("usuario_id", usuario.user.id)
    .order("creado_en", { ascending: false })
    .limit(1)
    .single();
  if (errorTrabajoNuevo || !trabajoNuevo) throw new Error(`No se pudo leer el trabajo nuevo: ${errorTrabajoNuevo?.message}`);
  expect(trabajoNuevo.criterios).toMatchObject({ destino_o_tipo: DESTINO_NUEVO });

  // Y al volver a «Mis viajes», el destino nuevo ya está en la lista.
  await pagina.goto("/viajes");
  await expect(pagina.getByText(DESTINO_NUEVO)).toBeVisible();
  await expect(pagina.getByText(DESTINO_SEMBRADO)).toBeVisible();

  await contexto.close();
});
