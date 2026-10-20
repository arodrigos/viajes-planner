import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { teselasDelDia } from "@/lib/sinConexion/mapas";

// p4m-ac1..ac5: guardar los mapas del plan y verlos sin conexión contra el
// build real con su service worker. OpenFreeMap se dobla con context.route
// (estilo mínimo, TileJSON y teselas vacías, que son MVT válidos); el corte de
// red es el del navegador.
test.use({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });

const BLOQUE = "mapa-sin-conexion";
const CORREO = "ci-test-mapa-sin-conexion@example.com";
const DESTINO = "Valencia";
const FECHAS = ["2027-06-08", "2027-06-09", "2027-06-10"];
const HOST = "https://tiles.openfreemap.org";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const TAMANOS = [
  { sufijo: "360", ancho: 360, alto: 640 },
  { sufijo: "820", ancho: 820, alto: 1180 },
  { sufijo: "1180", ancho: 1180, alto: 820 },
] as const;

const PARADAS = [0, 1, 2].flatMap((dia) =>
  [0, 1].map((n) => ({ id: `msc-${dia}-${n}`, dia, franja: n === 0 ? "manana" : "tarde", nombre: `Sitio ${dia + 1}.${n + 1}`, lat: 39.47 + dia * 0.01 + n * 0.004, lon: -0.38 + n * 0.006 })),
);
const puntosDia = (dia: number) => PARADAS.filter((p) => p.dia === dia).map((p) => ({ lat: p.lat, lon: p.lon }));

async function sembrarPlan(supabase: SupabaseClient, planId: string, usuarioId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: FECHAS.map((fecha) => ({ fecha, franjas: franjasComoArray(DESTINO) })), avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const resuelto = new Date("2026-10-04").toISOString();
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: p.dia,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita de prueba",
      lat: p.lat,
      lon: p.lon,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: { fuente: "osm", id: `osm:node/${p.id}`, url: "https://www.openstreetmap.org/node/1", nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: resuelto },
      resolucion: { estado: "resuelta", intentado_en: resuelto },
      foto_intentada_en: resuelto,
    });
    if (error) throw new Error(`No se pudo sembrar la parada '${p.id}': ${error.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
}

interface Registro {
  teselas: number;
  enVuelo: number;
  maximoEnVuelo: number;
  tras429: number;
  hubo429: boolean;
}

// limite429: a partir de la tesela n.º N (contando solo teselas) responde 429.
async function doblarOpenFreeMap(contexto: BrowserContext, opciones: { limite429?: number } = {}): Promise<Registro> {
  const r: Registro = { teselas: 0, enVuelo: 0, maximoEnVuelo: 0, tras429: 0, hubo429: false };
  await contexto.route(`${HOST}/**`, async (ruta) => {
    const url = new URL(ruta.request().url());
    const cors = { "access-control-allow-origin": "*" };
    const json = (cuerpo: unknown) => ruta.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(cuerpo) });
    if (url.pathname === "/styles/liberty") {
      // Se retiene un poco para que «Calculando…» tenga un instante estable.
      await new Promise((resolver) => setTimeout(resolver, 400));
      return json({
        version: 8,
        sprite: `${HOST}/sprites/ofm_f384/ofm`,
        glyphs: `${HOST}/fonts/{fontstack}/{range}.pbf`,
        sources: { openmaptiles: { type: "vector", url: `${HOST}/planet` } },
        layers: [
          { id: "fondo", type: "background", paint: { "background-color": "#e8efe3" } },
          { id: "etiquetas", type: "symbol", source: "openmaptiles", "source-layer": "place", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"] } },
        ],
      });
    }
    if (url.pathname === "/planet") return json({ tilejson: "3.0.0", attribution: "OpenFreeMap © OpenMapTiles Datos de OpenStreetMap", minzoom: 0, maxzoom: 14, tiles: [`${HOST}/planet/20261001_000000_pt/{z}/{x}/{y}.pbf`] });
    if (url.pathname.startsWith("/sprites/")) {
      return url.pathname.endsWith(".png") ? ruta.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG_1X1 }) : json({});
    }
    if (url.pathname.startsWith("/fonts/")) return ruta.fulfill({ status: 200, contentType: "application/x-protobuf", headers: cors, body: Buffer.alloc(0) });
    if (/^\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname)) {
      r.teselas++;
      if (r.hubo429) r.tras429++;
      r.enVuelo++;
      r.maximoEnVuelo = Math.max(r.maximoEnVuelo, r.enVuelo);
      await new Promise((resolver) => setTimeout(resolver, 40));
      r.enVuelo--;
      if (opciones.limite429 !== undefined && r.teselas > opciones.limite429) {
        r.hubo429 = true;
        return ruta.fulfill({ status: 429, headers: cors, body: "" });
      }
      return ruta.fulfill({ status: 200, contentType: "application/x-protobuf", headers: cors, body: Buffer.alloc(0) });
    }
    return ruta.fulfill({ status: 404, headers: cors, body: "" });
  });
  return r;
}

async function iniciarSesion(contexto: BrowserContext) {
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(CORREO);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } });
  expect(verificacion.ok()).toBe(true);
}

async function esperarControlador(pagina: Page) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
}

const clavesMapa = (pagina: Page): Promise<string[]> =>
  pagina.evaluate(async () => ((await caches.has("viajes-mapa")) ? (await (await caches.open("viajes-mapa")).keys()).map((r) => r.url) : []));

// Una captura por tamaño; vuelve al móvil para el resto del recorrido.
async function capturarEnTres(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await capturar(pagina, BLOQUE, `${nombre}-${t.sufijo}`, { fullPage: false });
  }
  await pagina.setViewportSize({ width: 360, height: 640 });
}

test.describe("mapa sin conexión", () => {
  test.describe.configure({ mode: "serial" });
  let supabase: SupabaseClient;
  let usuarioId: string;
  let planId: string;
  let planLimite: string;
  let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

  test.beforeAll(async () => {
    supabase = clienteDePrueba("servicio");
    const { data: usuario, error } = await supabase.auth.admin.createUser({ email: CORREO, email_confirm: true });
    if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = usuario.user.id;
    planId = `plan-msc-${Date.now()}`;
    planLimite = `plan-msc-429-${Date.now()}`;
    await sembrarPlan(supabase, planId, usuarioId);
    await sembrarPlan(supabase, planLimite, usuarioId);
  });

  test("guardar, ver el mapa sin red, día no guardado y expulsión (p4m-ac1, ac2, ac3, ac4, ac5)", async ({ browser }) => {
    test.setTimeout(240_000);
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
    const registro = await doblarOpenFreeMap(contexto);
    await iniciarSesion(contexto);
    cookies = await contexto.cookies();
    const pagina = await contexto.newPage();

    // p4m-ac4: abrir el plan y cambiar de día no escribe nada en viajes-mapa.
    await pagina.goto(`/plan/${planId}?dia=1`);
    await esperarControlador(pagina);
    await expect(pagina.getByRole("heading", { name: DESTINO, exact: true })).toBeVisible();
    await expect(pagina.locator(".marcador-parada")).toHaveCount(2);
    for (const dia of [2, 3, 1, 2]) {
      await pagina.goto(`/plan/${planId}?dia=${dia}`);
      await expect(pagina.locator(".marcador-parada")).toHaveCount(2);
    }
    expect(await clavesMapa(pagina)).toEqual([]);
    await capturarEnTres(pagina, "dia2-con-red");

    // p4m-ac1: «Calculando…» y luego «Guardando día X de N…».
    await pagina.goto(`/plan/${planId}?dia=2`);
    await pagina.getByRole("button", { name: "Guardar mapas para usar sin red" }).click();
    await expect(pagina.getByText("Calculando…")).toBeVisible({ timeout: 200 });
    await expect(pagina.getByText(/Guardando día \d de 3…/)).toBeVisible();
    const aviso = pagina.getByText(/Guardado para usar sin red: días 1 a 3 \(≈\d+ MB\)/);
    await expect(aviso).toBeVisible({ timeout: 60_000 });
    await capturarEnTres(pagina, "guardado");

    const claves = await clavesMapa(pagina);
    expect(claves).toContain(`${HOST}/styles/liberty`);
    expect(claves).toContain(`${HOST}/planet`);
    expect(claves).toContain(`${HOST}/sprites/ofm_f384/ofm.json`);
    expect(claves).toContain(`${HOST}/sprites/ofm_f384/ofm@2x.png`);
    expect(claves.filter((c) => c.includes("/fonts/")).length).toBeGreaterThanOrEqual(1);
    for (const dia of [0, 1, 2]) {
      for (const t of teselasDelDia(puntosDia(dia))) expect(claves).toContain(`${HOST}/planet/_/${t.z}/${t.x}/${t.y}.pbf`);
    }
    // p4m-ac4: nunca más de 3 a la vez y sin zoom por encima de 14.
    expect(registro.maximoEnVuelo).toBeLessThanOrEqual(3);
    expect(claves.filter((c) => /\/planet\/_\/(1[5-9]|[2-9]\d)\//.test(c))).toHaveLength(0);
    // Medida real para el registro: teselas guardadas por día.
    console.info("mapa-medida-e2e", JSON.stringify({ teselasPedidas: registro.teselas, claves: claves.length }));

    // Pulsar otra vez no vuelve a descargar lo ya guardado.
    const antes = registro.teselas;
    await pagina.getByRole("button", { name: "Guardar mapas para usar sin red" }).click();
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    expect(registro.teselas).toBe(antes);

    // p4m-ac2: sin red, el día 2 conserva el mapa y sus marcadores.
    await pagina.goto(`/plan/${planId}?dia=2`);
    await expect(pagina.locator(".marcador-parada")).toHaveCount(2);
    await contexto.unrouteAll({ behavior: "ignoreErrors" });
    await contexto.setOffline(true);
    await pagina.reload();
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${planId}&dia=2$`));
    await expect(pagina.locator(".contenedor-mapa-dia")).toHaveAttribute("data-recorrido-puntos", "2");
    await expect(pagina.locator(".marcador-parada")).toHaveCount(2);
    await expect(pagina.locator("canvas.maplibregl-canvas")).toBeVisible();
    await expect(pagina.locator(".mapa-no-disponible")).toHaveCount(0);
    await expect(pagina.locator(".maplibregl-ctrl-attrib")).toBeAttached();
    await expect(pagina.locator(".maplibregl-ctrl-attrib")).toContainText("OpenFreeMap");
    await expect(pagina.getByText(/Guardado para usar sin red: días 1 a 3/)).toBeVisible();
    await capturarEnTres(pagina, "dia2-sin-red");

    // p4m-ac5 y ac3: tras vaciar viajes-mapa (como una expulsión de iOS) el día
    // deja de figurar como guardado y se explica cómo guardarlo.
    await pagina.evaluate(() => caches.delete("viajes-mapa"));
    await pagina.reload();
    await expect(pagina.getByText(/Este día no está guardado para usar sin red/)).toBeVisible();
    await expect(pagina.getByText(/Guardado para usar sin red: días/)).toHaveCount(0);
    await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(2);
    await capturarEnTres(pagina, "tras-expulsion");
    await capturarEnTres(pagina, "dia-no-guardado");
    await contexto.close();
  });

  test("ante un 429 se para, avisa y deja guardado solo lo completo (p4m-ac4-429)", async ({ browser }) => {
    test.setTimeout(180_000);
    const contexto = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
    await contexto.addCookies(cookies);
    const dia1 = teselasDelDia(puntosDia(0)).length;
    const registro = await doblarOpenFreeMap(contexto, { limite429: dia1 + 5 });
    const pagina = await contexto.newPage();
    await pagina.goto(`/plan/${planLimite}?dia=1`);
    await esperarControlador(pagina);
    await pagina.getByRole("button", { name: "Guardar mapas para usar sin red" }).click();
    await expect(pagina.getByText(/El servidor de mapas ha pedido parar; inténtalo más tarde/)).toBeVisible({ timeout: 60_000 });
    await expect(pagina.getByText(/Guardado para usar sin red: días 1 \(/)).toBeVisible();
    expect(registro.maximoEnVuelo).toBeLessThanOrEqual(3);
    // Las peticiones que ya iban de camino pueden terminar; ninguna nueva.
    expect(registro.tras429).toBeLessThanOrEqual(3);
    await capturarEnTres(pagina, "parada-429");
    await contexto.close();
  });
});
