import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// alt-ac5/alt-ac7: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-alternativas@example.com";
const DESTINO = "Sevilla";
const RESUELTO_EN = new Date("2026-10-04").toISOString();

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo documentado en plan-timeline.movil.e2e.ts.
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

  async function sembrarParada(idExterno: string, nombre: string, conAlternativas: boolean) {
    if (!version) throw new Error("no se pudo sembrar la versión del plan");
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

    const { data: parada, error: errorParada } = await supabase
      .from("paradas")
      .insert({
        id_externo: idExterno,
        plan_version_id: version.id,
        dia_index: 0,
        franja_id: "manana",
        nombre,
        descripcion: "Visita guiada",
        lat: 37.3862,
        lon: -5.9926,
        duracion_min: 90,
        prioridad: 60,
        procedencia_id: procedencia.id,
        categoria: "monumento",
        lugar: { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombre_fuente: nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
        resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      })
      .select("id")
      .single();
    if (errorParada || !parada) throw new Error(`No se pudo sembrar la parada '${idExterno}': ${errorParada?.message}`);

    if (conAlternativas) {
      const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
        parada_id: parada.id,
        origen: "modelo",
        nombre: "Real Alcázar",
        descripcion: "Palacio real",
        motivo: "mismo tipo, misma franja",
        duracion_min: 100,
        categoria: "monumento",
        lat: 37.3834,
        lon: -5.9904,
      });
      if (errorAlternativa) throw new Error(`No se pudo sembrar la alternativa: ${errorAlternativa.message}`);
    }
  }

  await sembrarParada("p-con-alternativas", "Catedral de Sevilla", true);
  await sembrarParada("p-sin-alternativas", "Torre del Oro", false);
}

test("cambiar una parada por una alternativa crea una versión nueva y la antigua queda como alternativa (alt-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-alternativas-${Date.now()}`;
  await sembrarPlan(supabase, planId);

  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const { count: versionesAntes } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);

  const tarjetaConAlternativas = pagina.locator(".tarjeta-parada", { hasText: "Catedral de Sevilla" });
  await tarjetaConAlternativas.getByRole("button", { name: "Cambiar" }).click();
  await expect(tarjetaConAlternativas.getByText("Real Alcázar")).toBeVisible();
  // Acotado a los metadatos de la alternativa: desde encaje-y-paseo, la propia
  // parada también muestra "a N m de la siguiente parada" (etiquetas de encaje),
  // que con un locator sin acotar vuelve ambiguo el texto "a N m".
  await expect(tarjetaConAlternativas.locator(".metadatos-alternativa").getByText(/a \d+ m/i)).toBeVisible();
  await tarjetaConAlternativas.getByRole("button", { name: "Usar esta" }).click();

  // alt-ac5: exactamente una fila más en plan_versiones.
  await expect(async () => {
    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe((versionesAntes ?? 0) + 1);
  }).toPass();

  // La parada nueva lleva el nombre de la alternativa en la misma franja.
  const tarjetaNueva = pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" });
  await expect(tarjetaNueva).toBeVisible();

  await pagina.reload();
  await expect(pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" })).toBeVisible();
  await pagina.locator(".tarjeta-parada", { hasText: "Real Alcázar" }).getByRole("button", { name: "Cambiar" }).click();
  await expect(pagina.getByText("Catedral de Sevilla").last()).toBeVisible();

  await contexto.close();
});

test("usabilidad: parada sin alternativas, ayuda y objetivos táctiles (alt-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-alternativas-vacio@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-alternativas-vacio-${Date.now()}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
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

  const tarjetaSinAlternativas = pagina.locator(".tarjeta-parada", { hasText: "Torre del Oro" });
  const botonCambiar = tarjetaSinAlternativas.getByRole("button", { name: "Cambiar" });
  await botonCambiar.click();
  await expect(tarjetaSinAlternativas.getByText("No hay alternativas comprobadas para esta parada.")).toBeVisible();
  await expect(tarjetaSinAlternativas.getByText(/Puedes regenerar este viaje/)).toBeVisible();
  await expect(tarjetaSinAlternativas.getByText(/crea una nueva versión del plan/)).toBeVisible();

  const resultados = await medirObjetivosTactiles(pagina);
  const botonMedido = resultados.find((r) => r.descripcion.includes("Cambiar"));
  expect(botonMedido?.alto).toBeGreaterThanOrEqual(44);
  expect(botonMedido?.ancho).toBeGreaterThanOrEqual(44);

  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-alternativas-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-alternativas-oscuro.png" });

  await contexto.close();
});
