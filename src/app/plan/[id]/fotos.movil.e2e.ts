import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// fot-ac2/fot-ac3: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-fotos@example.com";
const DESTINO = "Madrid";
const RESUELTO_EN = new Date("2026-10-03").toISOString();

const FOTO_SEMBRADA = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Foto-sembrada.jpg/640px-Foto-sembrada.jpg",
  fichero: "Foto-sembrada.jpg",
  autor: "Autora De Prueba",
  licencia: "CC BY-SA 4.0",
  licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
  pagina_url: "https://commons.wikimedia.org/wiki/File:Foto-sembrada.jpg",
  fuente: "commons" as const,
};

interface ParadaSembrada {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  foto: typeof FOTO_SEMBRADA | null;
}

const PARADAS: ParadaSembrada[] = [
  { id: "p-con-foto", nombre: "Museo del Prado", descripcion: "Pinacoteca.", categoria: "museo", foto: FOTO_SEMBRADA },
  { id: "p-sin-foto", nombre: "Mercado de San Miguel", descripcion: "Mercado gastronómico.", categoria: "comida", foto: null },
];

// Siembra directa con la clave de servicio, sin pasar por guardarPlan
// (server-only): mismo motivo ya documentado en plan-timeline.movil.e2e.ts.
async function sembrarPlanConFotos(supabase: SupabaseClient, planId: string) {
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
      franja_id: "manana",
      nombre: parada.nombre,
      descripcion: parada.descripcion,
      lat: 40.41,
      lon: -3.69,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia.id,
      categoria: parada.categoria,
      lugar: { fuente: "osm", id: "osm:relation/1", url: "https://www.openstreetmap.org/relation/1", nombre_fuente: parada.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      foto: parada.foto,
      foto_intentada_en: RESUELTO_EN,
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${errorParada.message}`);
  }
}

test("una tarjeta con foto muestra la imagen y su atribución; sin foto, un marcador de posición digno (fot-ac2, fot-ac3)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-fotos-${Date.now()}`;
  await sembrarPlanConFotos(supabase, planId);

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

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();

  // (a) la parada con foto: img con los atributos exactos y atribución visible.
  const tarjetaConFoto = pagina.locator(".tarjeta-parada", { hasText: "Museo del Prado" });
  const img = tarjetaConFoto.locator("img");
  await expect(img).toHaveAttribute("src", FOTO_SEMBRADA.url);
  await expect(img).toHaveAttribute("alt", "Museo del Prado");
  await expect(img).toHaveAttribute("loading", "lazy");

  const atribucion = tarjetaConFoto.locator(".atribucion-foto");
  await expect(atribucion).toBeVisible();
  await expect(atribucion).toContainText(FOTO_SEMBRADA.autor);
  await expect(atribucion).toContainText(FOTO_SEMBRADA.licencia);
  const box = await atribucion.boundingBox();
  expect(box?.height).toBeGreaterThan(0);

  const enlaces = atribucion.locator("a");
  await expect(enlaces.nth(0)).toHaveAttribute("href", FOTO_SEMBRADA.pagina_url);
  await expect(enlaces.nth(1)).toHaveAttribute("href", FOTO_SEMBRADA.licencia_url);

  // (b) la parada sin foto: marcador de posición digno, sin imagen rota.
  const tarjetaSinFoto = pagina.locator(".tarjeta-parada", { hasText: "Mercado de San Miguel" });
  await expect(tarjetaSinFoto.locator(".foto-ausente")).toBeVisible();
  await expect(tarjetaSinFoto.getByText("Sin foto")).toBeVisible();
  await expect(tarjetaSinFoto.locator("img")).toHaveCount(0);

  // fot-ac5: capturas claro/oscuro para el juicio visual del gatekeeper
  // -una tarjeta con foto, otra sin-.
  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-fotos-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-fotos-oscuro.png" });

  await contexto.close();
});
