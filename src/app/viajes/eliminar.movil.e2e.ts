import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// borrar-ac1/ac4: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-eliminar@example.com";
const DESTINO = "Sevilla";

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en mis-viajes.movil.e2e.ts y
// plan-timeline.movil.e2e.ts. Un plan mínimo basta: lo que prueba este
// bloque es el efecto del borrado, no el contenido del plan.
async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

test("eliminar: cancelar no borra nada; confirmar elimina de la lista, el plan pasa a 404 para su dueño, y el borrado sobrevive a una recarga (borrar-ac1, contraste-ac3)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const planId = `plan-eliminar-${marca}`;

  const { data: usuario, error: errorUsuario } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (errorUsuario || !usuario.user) throw new Error(`No se pudo crear el usuario: ${errorUsuario?.message}`);

  await sembrarPlanMinimo(supabase, planId, DESTINO);
  const { data: trabajo, error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { destino_o_tipo: DESTINO }, estado: "completado", plan_id: planId })
    .select("id")
    .single();
  if (errorTrabajo || !trabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo?.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto("/viajes");
  await expect(pagina.getByText(DESTINO)).toBeVisible();

  // (a) Cancelar: no desaparece nada.
  await pagina.getByRole("button", { name: "Eliminar" }).click();
  const dialogo = pagina.getByRole("alertdialog", { name: new RegExp(DESTINO) });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(pagina.getByText(DESTINO)).toBeVisible();
  const { data: filaTrasCancelar } = await supabase.from("trabajos").select("eliminado_en").eq("id", trabajo.id).single();
  expect(filaTrasCancelar?.eliminado_en).toBeNull();

  // (b) Confirmar: el viaje deja la lista y su plan responde 404 a su dueño.
  await pagina.getByRole("button", { name: "Eliminar" }).click();
  await pagina.getByRole("alertdialog", { name: new RegExp(DESTINO) }).getByRole("button", { name: "Eliminar de verdad" }).click();
  await expect(pagina.getByText(DESTINO)).toHaveCount(0);

  const { data: filaTrasConfirmar } = await supabase.from("trabajos").select("eliminado_en").eq("id", trabajo.id).single();
  expect(filaTrasConfirmar?.eliminado_en).not.toBeNull();

  const respuestaPlan = await contexto.request.get(`/api/plan/${planId}`);
  expect(respuestaPlan.status()).toBe(404);

  // contraste-ac3: recargar la página -no solo el estado del componente- y
  // comprobar que el viaje sigue sin aparecer, para demostrar que el
  // borrado se persistió de verdad en la base y no solo en memoria.
  await pagina.reload();
  await expect(pagina.getByText(DESTINO)).toHaveCount(0);

  await contexto.close();
});
