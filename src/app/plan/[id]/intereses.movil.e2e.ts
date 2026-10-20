import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { capturar } from "@/test-utils/capturas";

const DESTINO = "Valencia";
const RESUELTO_EN = new Date("2026-10-03").toISOString();

const PARADAS = [
  { id: "p-parque", nombre: "Jardín del Turia", categoria: "parque" },
  { id: "p-comida", nombre: "Mercado Central", categoria: "comida" },
] as const;

async function sembrarPlan(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 3, dias: [{ fecha: "2026-12-10", franjas: franjasComoArray(DESTINO) }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);

  for (const parada of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error } = await supabase.from("paradas").insert({
      id_externo: parada.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: "manana",
      nombre: parada.nombre,
      descripcion: "Sitio de prueba.",
      lat: 39.47,
      lon: -0.37,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      categoria: parada.categoria,
      motivo: "Encaja con una familia con un niño de 7 años.",
      lugar: { fuente: "osm", id: "osm:relation/2", url: "https://www.openstreetmap.org/relation/2", nombre_fuente: parada.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      foto_intentada_en: RESUELTO_EN,
    });
    if (error) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${error.message}`);
  }
}

const CRITERIOS_BASE = {
  destino_o_tipo: DESTINO,
  fechas: { modo: "epoca", epoca: "diciembre" },
  dias: 1,
  personas: [{ edad: 40 }, { edad: 7 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};

async function planDe(browser: import("@playwright/test").Browser, email: string, criterios: object) {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-intereses-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();
  return { contexto, pagina };
}

// rit-ac5: manda el orden del usuario, y solo en las paradas que encajan.
test("el panel «por qué» cita el primer interés que encaja y solo en la parada que encaja", async ({ browser }) => {
  const { contexto, pagina } = await planDe(browser, "ci-test-intereses@example.com", {
    ...CRITERIOS_BASE,
    intereses: ["parques-ninos", "naturaleza"],
  });

  const parque = pagina.locator(".tarjeta-parada", { hasText: "Jardín del Turia" });
  await parque.getByText("Por qué te lo proponemos").click();
  await expect(parque.getByTestId("interes-parada")).toHaveText("Encaja con tu interés: Parques y juegos para niños");

  const comida = pagina.locator(".tarjeta-parada", { hasText: "Mercado Central" });
  await comida.getByText("Por qué te lo proponemos").click();
  await expect(comida.getByTestId("interes-parada")).toHaveCount(0);

  for (const [ancho, alto] of [[360, 640], [820, 1180], [1180, 820]] as const) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    await parque.scrollIntoViewIfNeeded();
    await capturar(pagina, "ritmo-e-intereses", `panel-interes-${ancho}`);
  }
  await contexto.close();
});

test("un plan sin intereses no muestra la línea en ninguna parada", async ({ browser }) => {
  const { contexto, pagina } = await planDe(browser, "ci-test-intereses-vacio@example.com", CRITERIOS_BASE);
  for (const nombre of ["Jardín del Turia", "Mercado Central"]) {
    const tarjeta = pagina.locator(".tarjeta-parada", { hasText: nombre });
    await tarjeta.getByText("Por qué te lo proponemos").click();
    await expect(tarjeta.getByText("Por qué te lo proponemos")).toBeVisible();
    await expect(tarjeta.getByTestId("interes-parada")).toHaveCount(0);
  }
  await contexto.close();
});
