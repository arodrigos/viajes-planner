import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { urlRecorridoDia } from "@/lib/plan/urlRecorridoDia";

// map-ac1..ac4: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-mapa@example.com";
const DESTINO = "Madrid";
const RESUELTO_EN = new Date("2026-10-03").toISOString();

interface ParadaSembrada {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  coordenadas: { lat: number; lon: number } | null;
}

// Tres paradas resueltas en franjas distintas (mañana, comida, tarde) y una
// sin resolver en la misma tarde -map-ac1 exige numerar en orden de franja
// y que la sin resolver no tenga marcador.
const PARADAS: ParadaSembrada[] = [
  { id: "p-manana", franja_id: "manana", nombre: "Museo del Prado", descripcion: "Pinacoteca.", coordenadas: { lat: 40.4138, lon: -3.6921 } },
  { id: "p-comida", franja_id: "comida", nombre: "Mercado de San Miguel", descripcion: "Mercado gastronómico.", coordenadas: { lat: 40.4153, lon: -3.709 } },
  { id: "p-tarde", franja_id: "tarde", nombre: "Templo de Debod", descripcion: "Templo egipcio.", coordenadas: { lat: 40.4243, lon: -3.7175 } },
  { id: "p-sin-resolver", franja_id: "tarde", nombre: "Sitio Inventado Que No Existe", descripcion: "No se pudo localizar.", coordenadas: null },
];

async function sembrarPlan(supabase: SupabaseClient, planId: string, dias: { fecha: string; paradas: ParadaSembrada[] }[]) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: planId,
      version: 1,
      personas: 2,
      dias: dias.map((dia) => ({ fecha: dia.fecha, franjas })),
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
        lat: parada.coordenadas?.lat ?? null,
        lon: parada.coordenadas?.lon ?? null,
        duracion_min: 90,
        prioridad: 60,
        procedencia_id: procedencia.id,
        lugar: parada.coordenadas
          ? { fuente: "osm", id: "osm:relation/1", url: "https://www.openstreetmap.org/relation/1", nombre_fuente: parada.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN }
          : null,
        resolucion: parada.coordenadas
          ? { estado: "resuelta", intentado_en: RESUELTO_EN }
          : { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ningún candidato aceptable" },
      });
      if (errorParada) throw new Error(`No se pudo sembrar la parada '${parada.id}': ${errorParada.message}`);
    }
  }
}

async function iniciarSesion(contexto: { request: { post: (url: string, opts: { data: unknown }) => Promise<{ ok: () => boolean }> } }, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

test("el mapa del día numera los marcadores en orden de franja, resalta la tarjeta tocada y enlaza al recorrido (map-ac1..ac4)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-mapa-${Date.now()}`;
  await sembrarPlan(supabase, planId, [{ fecha: "2026-11-07", paradas: PARADAS }]);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  await iniciarSesion(contexto, EMAIL);
  const pagina = await contexto.newPage();

  const peticionTeselas = pagina.waitForRequest(/tiles\.openfreemap\.org\/styles\/liberty/);
  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();
  await peticionTeselas;

  // map-ac1: canvas presente, 3 marcadores numerados 1,2,3 en orden de
  // franja (mañana, comida, tarde), recorrido con 3 puntos.
  await expect(pagina.locator("canvas.maplibregl-canvas")).toBeVisible();
  const marcadores = pagina.locator(".marcador-parada");
  await expect(marcadores).toHaveCount(3);
  await expect(pagina.locator(".contenedor-mapa-dia")).toHaveAttribute("data-recorrido-puntos", "3");
  for (const [indice, idEsperado] of ["p-manana", "p-comida", "p-tarde"].entries()) {
    const marcador = pagina.locator(`.marcador-parada[data-orden="${indice + 1}"]`);
    await expect(marcador).toHaveAttribute("data-parada-id", idEsperado);
  }

  // map-ac2: tocar el marcador 2 marca su tarjeta con aria-current (no la 1
  // ni la 3) y la deja dentro del viewport.
  await pagina.locator('.marcador-parada[data-orden="2"]').click();
  const tarjetaComida = pagina.locator(".tarjeta-parada", { hasText: "Mercado de San Miguel" });
  await expect(tarjetaComida).toHaveAttribute("aria-current", "true");
  await expect(pagina.locator('.tarjeta-parada[aria-current="true"]')).toHaveCount(1);
  const caja = await tarjetaComida.boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.y).toBeGreaterThanOrEqual(0);
  expect(caja!.y).toBeLessThanOrEqual(851);

  // map-ac3: el enlace de recorrido coincide con urlRecorridoDia para las
  // 3 paradas resueltas, en el mismo orden.
  const tramosEsperados = urlRecorridoDia([
    { lat: 40.4138, lon: -3.6921 },
    { lat: 40.4153, lon: -3.709 },
    { lat: 40.4243, lon: -3.7175 },
  ]);
  for (const tramo of tramosEsperados) {
    await expect(pagina.getByRole("link", { name: tramo.etiqueta })).toHaveAttribute("href", tramo.href);
  }

  // map-ac4: atribución visible, con las tres palabras exigidas por la
  // licencia, nunca colapsada en móvil.
  const atribucion = pagina.locator(".maplibregl-ctrl-attrib");
  await expect(atribucion).toBeVisible();
  const textoAtribucion = await atribucion.innerText();
  for (const palabra of ["OpenFreeMap", "OpenMapTiles", "OpenStreetMap"]) {
    expect(textoAtribucion).toContain(palabra);
  }

  // map-ac6: capturas claro/oscuro de un día con mapa para el juicio
  // visual del gatekeeper (issue #141).
  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-mapa-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-mapa-oscuro.png" });

  await contexto.close();
});

test("un día sin ninguna parada resuelta no muestra mapa, y explica por qué (map-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({
    email: "ci-test-mapa-vacio@example.com",
    email_confirm: true,
  });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-mapa-vacio-${Date.now()}`;
  const paradasSinResolver = PARADAS.map((p) => ({ ...p, coordenadas: null }));
  await sembrarPlan(supabase, planId, [{ fecha: "2026-11-07", paradas: paradasSinResolver }]);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  await iniciarSesion(contexto, "ci-test-mapa-vacio@example.com");
  const pagina = await contexto.newPage();
  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  await expect(pagina.locator("canvas.maplibregl-canvas")).toHaveCount(0);
  await expect(
    pagina.getByText("Sin mapa: ninguna parada de este día se ha podido ubicar todavía."),
  ).toBeVisible();
  await expect(pagina.locator(".tarjeta-parada")).toHaveCount(paradasSinResolver.length);

  await contexto.close();
});

test("si OpenFreeMap no responde, el hueco del mapa lo dice y la lista de paradas sigue completa (map-ac5)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({
    email: "ci-test-mapa-caido@example.com",
    email_confirm: true,
  });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-mapa-caido-${Date.now()}`;
  await sembrarPlan(supabase, planId, [{ fecha: "2026-11-07", paradas: PARADAS }]);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  await iniciarSesion(contexto, "ci-test-mapa-caido@example.com");
  const pagina = await contexto.newPage();
  await pagina.route("**/tiles.openfreemap.org/**", (route) => route.abort());
  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  await expect(pagina.getByText("El mapa no está disponible ahora.")).toBeVisible();
  await expect(pagina.locator(".tarjeta-parada")).toHaveCount(PARADAS.length);

  await contexto.close();
});
