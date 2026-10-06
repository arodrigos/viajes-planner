import { abrirOpciones } from "./opciones-e2e";
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// reg-ac1: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const DESTINO = "Oporto";

const TEXTO_CONFIRMACION =
  "El plan actual se sustituirá por uno nuevo generado desde cero. Las paradas marcadas como visitadas se perderán. Tarda unos minutos y consume una generación de tu suscripción. ¿Seguir?";

async function sembrarPlanCompletado(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-10", franjas }], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

async function iniciarSesion(contexto: import("@playwright/test").BrowserContext, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

test("regenerar un viaje de punta a punta: cancelar no cambia nada, confirmar reencola el MISMO trabajo (reg-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-regenerar@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-regenerar-${Date.now()}`;
  await sembrarPlanCompletado(supabase, planId);
  const { data: trabajo, error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId })
    .select("id")
    .single();
  if (errorTrabajo || !trabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo?.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await abrirOpciones(pagina);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  const { count: trabajosAntes } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuario.user.id);

  await pagina.getByRole("button", { name: "Regenerar el viaje…" }).click();
  const dialogo = pagina.getByRole("dialog", { name: "Regenerar este viaje" });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText(TEXTO_CONFIRMACION)).toBeVisible();

  // "Cancelar" no cambia nada en `trabajos`.
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
  const { count: trabajosTrasCancelar } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuario.user.id);
  expect(trabajosTrasCancelar).toBe(trabajosAntes);
  const { data: filaTrasCancelar } = await supabase.from("trabajos").select("estado, regenerado_en").eq("id", trabajo.id).single();
  expect(filaTrasCancelar?.estado).toBe("completado");
  expect(filaTrasCancelar?.regenerado_en).toBeNull();

  // "Sí, regenerar": la fila del trabajo propietario pasa a 'encolado', con
  // el MISMO plan_id (no hay fila nueva en `trabajos`), y navega al
  // progreso.
  await pagina.getByRole("button", { name: "Regenerar el viaje…" }).click();
  await pagina.getByRole("dialog", { name: "Regenerar este viaje" }).getByRole("button", { name: "Sí, regenerar" }).click();

  await expect(pagina).toHaveURL(new RegExp(`/trabajos/${trabajo.id}$`));

  const { count: trabajosTrasConfirmar } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuario.user.id);
  expect(trabajosTrasConfirmar).toBe(trabajosAntes);

  const { data: filaTrasConfirmar } = await supabase
    .from("trabajos")
    .select("estado, etapa, plan_id, regenerado_en")
    .eq("id", trabajo.id)
    .single();
  expect(filaTrasConfirmar?.estado).toBe("encolado");
  expect(filaTrasConfirmar?.etapa).toBeNull();
  expect(filaTrasConfirmar?.plan_id).toBe(planId);
  expect(filaTrasConfirmar?.regenerado_en).not.toBeNull();

  await contexto.close();
});

test("usabilidad: objetivo táctil, ayuda, aviso de regeneración en curso y capturas (reg-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-regenerar-ac4@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-regenerar-ac4-${Date.now()}`;
  await sembrarPlanCompletado(supabase, planId);
  const { data: trabajo, error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "en-curso", plan_id: planId, regenerado_en: new Date().toISOString() })
    .select("id")
    .single();
  if (errorTrabajo || !trabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo?.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await abrirOpciones(pagina);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  // reg-ac4: el trabajo está "en-curso" (regenerando) -- la versión
  // anterior (la única que existe) sigue siendo accesible y avisa.
  await expect(pagina.getByText("Este viaje se está regenerando; el plan que ves se sustituirá cuando termine.")).toBeVisible();
  const enlaceProgreso = pagina.getByRole("link", { name: "Ver el progreso" });
  await expect(enlaceProgreso).toHaveAttribute("href", `/trabajos/${trabajo.id}`);

  const botonRegenerar = pagina.getByRole("button", { name: "Regenerar el viaje…" });
  // usabilidad-ac8: nada de `title` -la ayuda va en un texto visible, no en
  // un tooltip de hover que en táctil no existe.
  await expect(pagina.getByText(/Vuelve a generar el plan con las mejoras actuales/)).toBeVisible();

  const resultados = await medirObjetivosTactiles(pagina);
  const botonMedido = resultados.find((r) => r.descripcion.includes("Regenerar el viaje"));
  expect(botonMedido?.alto).toBeGreaterThanOrEqual(44);
  expect(botonMedido?.ancho).toBeGreaterThanOrEqual(44);

  await botonRegenerar.click();
  const dialogo = pagina.getByRole("dialog", { name: "Regenerar este viaje" });
  await expect(dialogo).toBeVisible();

  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-regenerar-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-regenerar-oscuro.png" });

  await contexto.close();
});
