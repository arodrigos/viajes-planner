import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// lug-ac7: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-procedencia@example.com";
const DESTINO = "Madrid";
// Marca de tiempo calculada, no literal: config-franjas.test.ts prohíbe
// literales horarios (HH:MM) fuera de config-franjas.ts y los tests.
const RESUELTO_EN = new Date("2026-10-03").toISOString();

interface ParadaSembrada {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  lugar: { fuente: "osm" | "wikipedia"; url: string } | null;
}

const PARADAS: ParadaSembrada[] = [
  {
    id: "p-osm",
    franja_id: "manana",
    nombre: "Museo del Prado",
    descripcion: "Pinacoteca.",
    lugar: { fuente: "osm", url: "https://www.openstreetmap.org/relation/7726080" },
  },
  {
    id: "p-wikipedia",
    franja_id: "manana",
    nombre: "Templo de Debod",
    descripcion: "Templo egipcio.",
    lugar: { fuente: "wikipedia", url: "https://es.wikipedia.org/wiki/Templo_de_Debod" },
  },
  {
    id: "p-sin-resolver",
    franja_id: "manana",
    nombre: "Sitio Inventado Que No Existe",
    descripcion: "No se pudo localizar.",
    lugar: null,
  },
];

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en plan-timeline.movil.e2e.ts.
async function sembrarPlanConProcedencias(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2026-11-07", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  for (const parada of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: parada.id,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: parada.franja_id,
      nombre: parada.nombre,
      descripcion: parada.descripcion,
      lat: parada.lugar ? 40.41 : null,
      lon: parada.lugar ? -3.69 : null,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: parada.lugar
        ? { fuente: parada.lugar.fuente, id: "osm:relation/1", url: parada.lugar.url, nombre_fuente: parada.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN }
        : null,
      resolucion: parada.lugar
        ? { estado: "resuelta", intentado_en: RESUELTO_EN }
        : { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ningún candidato aceptable" },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${errorParada.message}`);
  }
}

test("cada tarjeta dice si está comprobada o no, con enlace a la fuente real; el aviso global es honesto (lug-ac7)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-procedencia-${Date.now()}`;
  await sembrarPlanConProcedencias(supabase, planId);

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

  // (a) dos enlaces "Ubicación comprobada", cada uno a su lugar.url sembrada.
  const tarjetaOsm = pagina.locator(".tarjeta-parada", { hasText: "Museo del Prado" });
  await expect(tarjetaOsm.getByText(/Ubicación comprobada en OpenStreetMap/)).toBeVisible();
  const enlaceOsm = tarjetaOsm.getByRole("link");
  await expect(enlaceOsm).toHaveAttribute("href", "https://www.openstreetmap.org/relation/7726080");
  await expect(enlaceOsm).toHaveAttribute("target", "_blank");
  const relOsm = await enlaceOsm.getAttribute("rel");
  expect(relOsm).toContain("noopener");
  expect(relOsm).toContain("noreferrer");

  const tarjetaWikipedia = pagina.locator(".tarjeta-parada", { hasText: "Templo de Debod" });
  await expect(tarjetaWikipedia.getByText(/Ubicación comprobada en Wikipedia/)).toBeVisible();
  await expect(tarjetaWikipedia.getByRole("link")).toHaveAttribute("href", "https://es.wikipedia.org/wiki/Templo_de_Debod");

  // cam-ac3: el nombre accesible dice fuente y sitio, no «flecha».
  await expect(pagina.getByRole("link", { name: "Ver en OpenStreetMap: Museo del Prado" })).toBeVisible();
  await expect(pagina.getByRole("link", { name: "Ver en Wikipedia: Templo de Debod" })).toBeVisible();
  const nombresMalos = await pagina.evaluate(() =>
    // Solo dentro de las tarjetas: el resto de la página (mapa, cabecera) trae
    // controles de terceros cuyo nombre no depende de este bloque.
    Array.from(document.querySelectorAll(".tarjeta-parada a, .tarjeta-parada button"))
      .map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || "")
      .filter((nombre) => nombre === "" || /flecha|→|↗/.test(nombre)),
  );
  expect(nombresMalos).toEqual([]);

  // (b) la que no resolvió dice "Sin comprobar" con su ayuda, sin enlace.
  const tarjetaSinResolver = pagina.locator(".tarjeta-parada", { hasText: "Sitio Inventado Que No Existe" });
  await expect(tarjetaSinResolver.getByText(/Sin comprobar/)).toBeVisible();
  await expect(tarjetaSinResolver.getByText(/comprueba el nombre y la dirección antes de ir/)).toBeVisible();
  await expect(tarjetaSinResolver.getByRole("link")).toHaveCount(0);

  // (c) el aviso global, honesto y sin control de cierre.
  const aviso = pagina.getByText(/Las paradas marcadas como comprobadas se han localizado/);
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveAttribute("role", "note");

  await contexto.close();
});
