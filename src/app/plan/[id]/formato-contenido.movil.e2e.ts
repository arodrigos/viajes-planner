import { expect, test, type Browser } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// fmt-ac2 y cur-ac1-b: importes con punto de miles y curiosidades ya guardadas
// que se pintan limpias, a 390×844.
test.use({ viewport: { width: 390, height: 844 } });

const FECHA = "2026-11-07";

async function sembrarPlan(supabase: SupabaseClient, usuarioId: string, planId: string, parada: Record<string, unknown>, presupuesto: number) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Londres" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Londres") }], avisos: [] })
    .select("id")
    .single();
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (!version || !procedencia) throw new Error("No se pudo sembrar la versión");
  const { error } = await supabase
    .from("paradas")
    .insert({ plan_version_id: version.id, dia_index: 0, franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 80, procedencia_id: procedencia.id, guia_intentada_en: "2026-10-05T10:00:00Z", ...parada });
  if (error) throw new Error(`No se pudo sembrar la parada: ${error.message}`);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: presupuesto }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
}

async function abrirPlan(browser: Browser, email: string, planId: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}?dia=1`);
  return { contexto, pagina };
}

async function usuarioDePrueba(supabase: SupabaseClient, email: string) {
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  return data.user.id;
}

test("fmt-ac2: los importes de cuatro cifras llevan punto de miles y espacio duro", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-formato-miles@example.com";
  const planId = `plan-formato-miles-${Date.now()}`;
  await sembrarPlan(supabase, await usuarioDePrueba(supabase, email), planId, {
    id_externo: "f-miles", nombre: "Visita privada (ejemplo)", coste: { importe_eur: 1500, por: "grupo", procedencia: "estimado", fecha: "2026-10-05" },
  }, 3000);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  await pagina.goto(`/plan/${planId}?dia=resumen`);
  const presupuesto = pagina.getByTestId("presupuesto-plan");
  await expect(presupuesto).toContainText("Tu presupuesto: 3.000 €");
  const texto = (await presupuesto.textContent()) ?? "";
  expect(texto).toContain("3.000 €");
  expect(texto).toContain("1.500 €");
  expect((await pagina.evaluate(() => document.body.textContent ?? "")).match(/\b\d{4}\s?€/g) ?? []).toHaveLength(0);
  await contexto.close();
});

test("cur-ac1-b: la curiosidad con invisibles se limpia y la cortada por «Bros.» no se pinta", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-formato-curiosidades@example.com";
  const planId = `plan-formato-curiosidades-${Date.now()}`;
  const url = "https://en.wikipedia.org/wiki/Warner_Bros._Studio_Tour_London";
  const item = (texto: string) => ({ texto, idioma: "en", fuente: "wikipedia", url, seleccion: "modelo" });
  await sembrarPlan(supabase, await usuarioDePrueba(supabase, email), planId, {
    id_externo: "f-cur", nombre: "Studio Tour (ejemplo)", coste: { importe_eur: 20, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
    curiosidades: {
      frases: [],
      url: "",
      seleccion: "modelo",
      items: [item("The tour​ covers the sets used in the films."), item("The attraction is operated by Warner Bros."), item("It opened to the public in 2012.")],
    },
  }, 900);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  const curiosidades = pagina.locator("li.tarjeta-parada", { hasText: "Studio Tour (ejemplo)" }).getByTestId("curiosidades-parada");
  await expect(curiosidades).toContainText("The tour covers the sets used in the films.");
  await expect(curiosidades).toContainText("It opened to the public in 2012.");
  await expect(curiosidades).not.toContainText("operated by Warner Bros.");
  expect((await curiosidades.textContent()) ?? "").not.toMatch(/[​‌‍⁠­﻿]/);
  await contexto.close();
});
