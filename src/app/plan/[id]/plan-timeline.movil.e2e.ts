import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// maq-ac1/maq-ac2(b)/maq-ac3: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-plan-timeline@example.com";
const DESTINO = "Lisboa";

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only, repositorio.ts): fuera del build de Next.js "server-only"
// lanza siempre, y Playwright no tiene ese alias -mismo motivo ya
// documentado en final-ac2.e2e.ts, el único otro e2e de este repo que
// necesita sembrar un plan real. DESVIACIÓN declarada del diseño
// (maq-ac1 pedía llamar a guardarPlan en sí): se replican sus mismas
// escrituras fila a fila para no reintroducir el problema ya resuelto ahí.
async function sembrarPlanDeDosDias(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);

  // Día 1: paradas en tres franjas no contiguas (mañana temprano, comida,
  // cena) -si el orden del DOM viniera de las paradas en vez de
  // `dia.franjas`, este fixture lo pondría de manifiesto.
  // Día 2: paradas en dos franjas (mañana, tarde).
  const dias = [
    {
      fecha: "2026-11-10",
      franjas,
      paradas: [
        { id: "d1-amanecer", franja_id: "manana-temprano", nombre: "Mirador de Lisboa al amanecer", descripcion: "Vistas de la ciudad antes del calor." },
        { id: "d1-comida", franja_id: "comida", nombre: "Marisqueria do Bairro", descripcion: "Comida tradicional junto al río." },
        { id: "d1-cena", franja_id: "cena", nombre: "Taberna da Rua", descripcion: "Cena con fado en vivo." },
      ],
    },
    {
      fecha: "2026-11-11",
      franjas,
      paradas: [
        { id: "d2-manana", franja_id: "manana", nombre: "Castillo de San Jorge", descripcion: "Recorrido por las murallas." },
        { id: "d2-tarde", franja_id: "tarde", nombre: "Barrio de Alfama", descripcion: "Paseo por las calles empedradas." },
      ],
    },
  ];

  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: planId,
      version: 1,
      personas: 2,
      dias: dias.map((dia) => ({ fecha: dia.fecha, franjas: dia.franjas })),
      avisos: [],
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
        id_externo: parada.id,
        plan_version_id: version.id,
        dia_index: diaIndex,
        franja_id: parada.franja_id,
        nombre: parada.nombre,
        descripcion: parada.descripcion,
        lat: 38.7 + diaIndex * 0.01,
        lon: -9.13,
        duracion_min: 90,
        prioridad: 60,
        procedencia_id: procedencia.id,
      });
      if (errorParada) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${errorParada.message}`);
    }
  }

  return dias;
}

test("un plan real se lee como línea de tiempo: días y franjas en orden, icono y etiqueta por franja (maq-ac1/maq-ac2b)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-timeline-${Date.now()}`;
  const dias = await sembrarPlanDeDosDias(supabase, planId);

  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  // Acceso real: se pide el código, se lee de Mailpit y se canjea -sin
  // doblar la red, mismo patrón que final-ac2.e2e.ts.
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  // (a) cada día es su propio panel, en el orden de las fechas sembradas.
  // (b) dentro de cada día, las etiquetas de franja en el orden de
  // config-franjas.ts -no el orden en que se sembraron las paradas.
  // (c) cada parada trae su propio <svg> dentro de su propio elemento.
  const franjasEsperadas = [["Mañana temprano", "Comida", "Cena"], ["Mañana", "Tarde"]];
  for (const [i, dia] of dias.entries()) {
    await pagina.goto(`/plan/${planId}?dia=${i + 1}`);
    await expect(pagina.locator("section.seccion-dia h2")).toHaveText(new RegExp(`^Día ${i + 1} · `));
    await expect(pagina.locator("section.seccion-dia")).toHaveCount(1);
    await expect(pagina.locator("section.seccion-dia .cabecera-franja h3")).toHaveText(franjasEsperadas[i]);
    for (const parada of dia.paradas) {
      const tarjeta = pagina.locator(".tarjeta-parada", { hasText: parada.nombre });
      await expect(tarjeta).toBeVisible();
      await expect(tarjeta.locator("svg")).toHaveCount(1);
    }
  }
  await pagina.goto(`/plan/${planId}?dia=1`);
  // El panel se pinta tras cargar /api/plan: sin esta espera el recuento de
  // <svg> se hace sobre la página vacía.
  await expect(pagina.locator("section.seccion-dia h2")).toHaveText(/^Día 1 · /);
  await expect(pagina.locator(".tarjeta-parada svg").first()).toBeVisible();

  // maq-ac2(b): todo <svg> de la página es decorativo, y la etiqueta de
  // cada franja pintada sigue presente como texto -quitar el CSS no
  // quitaría información.
  const svgs = pagina.locator("svg");
  const totalSvgs = await svgs.count();
  expect(totalSvgs).toBeGreaterThan(0);
  for (let i = 0; i < totalSvgs; i++) {
    await expect(svgs.nth(i)).toHaveAttribute("aria-hidden", "true");
  }

  // maq-ac3: capturas del gatekeeper, en claro y oscuro, con un plan real
  // de 2 días y >=2 franjas por día.
  await pagina.screenshot({ path: "artefactos/capturas/plan-timeline-claro.png", fullPage: true });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-timeline-oscuro.png", fullPage: true });

  await contexto.close();
});
