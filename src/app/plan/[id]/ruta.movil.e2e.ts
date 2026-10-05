import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// etv-ac1..ac4 (cp-etv-01, cp-etv-02, cp-etv-03): «Ruta del viaje» de un plan
// multiciudad sembrado con el formato que produce etapas-pais. El envío del
// formulario con «Portugal» ya lo cubre transporte.movil.e2e.ts.
test.use({ viewport: { width: 390, height: 844 } });

// Un correo por sesión: fullyParallel ejecuta los tests a la vez y leerCodigo
// toma el último mensaje del correo, así que compartirlo cruzaría los códigos.
const correo = (sufijo: string) => `ci-test-ruta-${sufijo}@example.com`;
const CAJA_LISBOA = { minLat: 38.6, maxLat: 38.9, minLon: -9.35, maxLon: -9.0 };
const CAJA_OPORTO = { minLat: 41.0, maxLat: 41.3, minLon: -8.8, maxLon: -8.45 };

const etapa = (nombre: string, caja: typeof CAJA_LISBOA, dia_inicio: number, noche: number, ajustes: string[]) => ({
  ciudad: { estado: "resuelta", nombre, metodo: "destino", caja, intentado_en: "2026-10-05T00:00:00Z" },
  pais: "Portugal",
  dias: 4,
  dia_inicio,
  motivo: `Por qué ${nombre}`,
  alojamiento_noche_eur: noche,
  zona: 0,
  ajustes,
});

async function sembrarPlan(supabase: SupabaseClient, planId: string, modo: "tren" | "avion" | "coche") {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Portugal" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray("Portugal");
  const dias = Array.from({ length: 8 }, (_, i) => ({ fecha: `2027-06-${String(8 + i).padStart(2, "0")}`, franjas, etapa: i < 4 ? 0 : 1 }));
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: planId,
      version: 1,
      personas: 2,
      dias,
      avisos: [],
      etapas: [etapa("Lisboa", CAJA_LISBOA, 0, 90, ["Quitamos Coímbra: 1 día no deja tiempo para descansar"]), etapa("Oporto", CAJA_OPORTO, 4, 80, [])],
      traslados: [{ desde: "Lisboa", hasta: "Oporto", modo, distancia_km: 313, duracion_min: 229, coste_eur: 79, procedencia: "estimado" }],
    })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);

  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  for (let i = 0; i < 8; i++) {
    const [lat, lon] = i < 4 ? [38.72, -9.14] : [41.15, -8.61];
    const { error } = await supabase.from("paradas").insert({
      id_externo: `p-ruta-${i}`,
      plan_version_id: version.id,
      dia_index: i,
      franja_id: "manana",
      nombre: `Sitio ${i + 1}`,
      descripcion: "Visita",
      lat,
      lon,
      duracion_min: 60,
      prioridad: 80,
      coste: { importe_eur: 30, por: "grupo", procedencia: "estimado" },
      procedencia_id: procedencia?.id,
      lugar: { fuente: "osm", id: `osm:way/${i}`, url: "https://www.openstreetmap.org/way/1", nombre_fuente: `Sitio ${i + 1}`, etiquetas: {}, resuelto_en: new Date().toISOString() },
      resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() },
    });
    if (error) throw new Error(`No se pudo sembrar la parada ${i}: ${error.message}`);
  }
}

async function abrirPlan(browser: import("@playwright/test").Browser, supabase: SupabaseClient, modo: "tren" | "avion" | "coche", sufijo: string) {
  const EMAIL = correo(sufijo);
  const { data: usuario } = await supabase.auth.admin.listUsers();
  let usuarioId = usuario?.users.find((u) => u.email === EMAIL)?.id;
  if (!usuarioId) {
    const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  }
  const planId = `plan-ruta-e2e-${modo}-${Date.now()}`;
  await sembrarPlan(supabase, planId, modo);
  const { error } = await supabase.from("trabajos").insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { presupuesto_eur: 3000 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: "Portugal" })).toBeVisible();
  return { contexto, pagina };
}

test("Ruta del viaje: etapas, traslado, presupuesto y ajustes, sin aviso de ciudad (etv-ac1, etv-ac3)", async ({ browser }) => {
  const { contexto, pagina } = await abrirPlan(browser, clienteDePrueba("servicio"), "tren", "etapas");
  const ruta = pagina.getByTestId("ruta-viaje");
  await expect(ruta).toBeVisible();

  const etapas = await ruta.getByTestId("etapa-ruta").locator("h3").allTextContents();
  expect(etapas).toEqual(["Lisboa · 4 noches", "Oporto · 3 noches"]);
  await expect(ruta.getByText("Lisboa → Oporto · autobús", { exact: false })).toHaveCount(0);
  await expect(ruta.getByText("Lisboa → Oporto · tren · ~3 h 49 min · ~79 € (estimado)")).toBeVisible();
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText("Total estimado: ~919 €");
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText(/Tu presupuesto: 3\.?000 €/);
  await expect(ruta.getByText("Quitamos Coímbra: 1 día no deja tiempo para descansar")).toBeVisible();
  await expect(pagina.getByText(/No hemos identificado la ciudad/)).toHaveCount(0);

  // Pulsar una etapa lleva a su primer día.
  await ruta.getByRole("button", { name: /Oporto · 3 noches/ }).click();
  await expect(pagina.locator("#dia-4")).toBeInViewport();

  // etv-ac3: sin desbordamiento horizontal en el móvil.
  const ancho = await pagina.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(ancho.scroll).toBeLessThanOrEqual(ancho.client);
  await contexto.close();
});

test("cada día nombra su ciudad y su mapa se centra en ella (etv-ac2)", async ({ browser }) => {
  const { contexto, pagina } = await abrirPlan(browser, clienteDePrueba("servicio"), "coche", "dias");
  await expect(pagina.getByRole("heading", { name: "Día 1 · Lisboa" })).toBeVisible();
  await expect(pagina.getByRole("heading", { name: "Día 5 · Oporto" })).toBeVisible();

  const centro = async (indice: number) => {
    const texto = await pagina.locator(`#dia-${indice} .contenedor-mapa-dia`).getAttribute("data-centro");
    const [lat, lon] = (texto ?? "").split(",").map(Number);
    return { lat, lon };
  };
  const dentro = (c: { lat: number; lon: number }, caja: typeof CAJA_LISBOA) => c.lat >= caja.minLat && c.lat <= caja.maxLat && c.lon >= caja.minLon && c.lon <= caja.maxLon;
  expect(dentro(await centro(0), CAJA_LISBOA)).toBe(true);
  expect(dentro(await centro(4), CAJA_OPORTO)).toBe(true);
  await contexto.close();
});

test("enlaces de transporte: tren con 2, coche con ninguno (etv-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const tren = await abrirPlan(browser, supabase, "tren", "tren");
  const busqueda = tren.pagina.getByRole("link", { name: "Buscar tren Lisboa → Oporto" });
  await expect(busqueda).toHaveCount(1);
  const url = new URL((await busqueda.getAttribute("href")) ?? "");
  expect(url.origin + url.pathname).toBe("https://www.google.com/search");
  expect([...url.searchParams.keys()]).toEqual(["q"]);
  expect(url.searchParams.get("q")).toBe("tren Lisboa Oporto 2027-06-12");
  const mapa = tren.pagina.getByRole("link", { name: /Ver en Google Maps en transporte público/ });
  const m = new URL((await mapa.getAttribute("href")) ?? "");
  expect(Object.fromEntries(m.searchParams)).toEqual({ api: "1", origin: "Lisboa, Portugal", destination: "Oporto, Portugal", travelmode: "transit" });
  for (const enlace of [busqueda, mapa]) {
    await expect(enlace).toHaveAttribute("target", "_blank");
    expect(await enlace.getAttribute("rel")).toMatch(/noopener.*noreferrer|noreferrer.*noopener/);
    const caja = await enlace.boundingBox();
    expect(caja?.height).toBeGreaterThanOrEqual(44);
    expect(caja?.width).toBeLessThanOrEqual(390);
  }
  await tren.contexto.close();

  const coche = await abrirPlan(browser, supabase, "coche", "coche");
  await expect(coche.pagina.getByTestId("traslado-ruta").getByRole("link")).toHaveCount(0);
  await coche.contexto.close();
});
