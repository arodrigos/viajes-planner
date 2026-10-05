import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// gui-ac1 (cp-gui-01) y gui-ac2: guía con atribución y enlace, precio de la
// fuente en lugar del estimado, curiosidades y los estados vacíos, en 360×740.
test.use({ viewport: { width: 360, height: 740 } });

const EMAIL = "ci-test-guia@example.com";
const FECHA = "2026-11-07";

async function sembrar(supabase: SupabaseClient, usuarioId: string, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Lisboa") }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (!procedencia) throw new Error("No se pudo sembrar la procedencia");

  const base = { plan_version_id: version.id, dia_index: 0, franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 80, procedencia_id: procedencia.id };
  const filas = [
    {
      ...base,
      id_externo: "g-jeronimos",
      nombre: "Monasterio de los Jerónimos",
      coste: { importe_eur: 10, por: "persona", procedencia: "wikivoyage", fecha: "2026-10-05" },
      guia: {
        consejo: "Gótico manuelino; entra temprano para evitar la cola.",
        precio_texto: "€10, under 12 free",
        precio_eur: 10,
        url: "https://en.wikivoyage.org/wiki/Lisbon/Bel%C3%A9m",
        licencia: "CC BY-SA",
      },
      curiosidades: { frases: ["El palacio original se edificó en la Alta Edad Media."], url: "https://es.wikipedia.org/wiki/Monasterio_de_los_Jer%C3%B3nimos" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
    {
      ...base,
      id_externo: "g-domingo",
      nombre: "Museo gratis en domingo",
      coste: { importe_eur: 8, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
      guia: { consejo: "Gratis los domingos por la mañana.", precio_texto: "free on Sundays", url: "https://en.wikivoyage.org/wiki/Lisbon", licencia: "CC BY-SA" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
    {
      ...base,
      id_externo: "g-sin-ficha",
      nombre: "Pastelería del barrio",
      coste: { importe_eur: 5, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
  ];
  for (const fila of filas) {
    const { error } = await supabase.from("paradas").insert(fila);
    if (error) throw new Error(`No se pudo sembrar '${fila.id_externo}': ${error.message}`);
  }
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: 900 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

test("guía con atribución, precio de la fuente y estados vacíos (gui-ac1, gui-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-guia-${Date.now()}`;
  await sembrar(supabase, usuario.user.id, planId);

  const contexto = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${planId}`);
  const jeronimos = pagina.locator("li.tarjeta-parada", { hasText: "Monasterio de los Jerónimos" });
  await expect(jeronimos.getByTestId("guia-parada")).toContainText("Consejos de la guía");
  await expect(jeronimos.getByTestId("guia-parada")).toContainText("Wikivoyage · CC BY-SA");
  const enlace = jeronimos.getByRole("link", { name: "Ver en Wikivoyage: Monasterio de los Jerónimos" });
  await expect(enlace).toHaveAttribute("href", "https://en.wikivoyage.org/wiki/Lisbon/Bel%C3%A9m");
  await expect(jeronimos.getByTestId("precio-parada")).toHaveText("Precio orientativo: 10 €/persona · según Wikivoyage");
  await expect(jeronimos.getByTestId("curiosidades-parada")).toContainText("El palacio original se edificó en la Alta Edad Media.");
  await expect(jeronimos.getByTestId("curiosidades-parada")).toContainText("Wikipedia · CC BY-SA");
  await expect(jeronimos.getByTestId("opiniones-parada")).toHaveText("Opiniones de visitantes: Sin opiniones de visitantes");

  // Precio no numérico: se enseña literal y el estimado se conserva.
  const domingo = pagina.locator("li.tarjeta-parada", { hasText: "Museo gratis en domingo" });
  await expect(domingo.getByTestId("guia-parada")).toContainText("Precio según la guía: free on Sundays");
  await expect(domingo.getByTestId("precio-parada")).toHaveText("Precio orientativo: 8 €/persona · estimado");

  const sinFicha = pagina.locator("li.tarjeta-parada", { hasText: "Pastelería del barrio" });
  await expect(sinFicha.getByTestId("guia-parada")).toContainText("La guía no tiene ficha de este sitio");
  await expect(sinFicha.getByTestId("curiosidades-parada")).toContainText("No hay curiosidades en Wikipedia para este sitio");
  await expect(sinFicha.getByTestId("precio-parada")).toHaveText("Precio orientativo: 5 €/persona · estimado");
  await expect(pagina.getByTestId("opiniones-parada")).toHaveCount(3);

  expect(await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await contexto.close();
});
