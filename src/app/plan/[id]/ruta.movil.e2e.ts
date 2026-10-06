import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import type { Plan } from "@/lib/plan/tipos";
import { CAJA_LISBOA, CAJA_OPORTO, etapaSembrada, sembrarPlan } from "./semillas-e2e";

// etv-ac1..ac4 (cp-etv-01, cp-etv-02, cp-etv-03): «Ruta del viaje» de un plan
// multiciudad sembrado con el formato que produce etapas-pais. El envío del
// formulario con «Portugal» ya lo cubre transporte.movil.e2e.ts.
test.use({ viewport: { width: 390, height: 844 } });

// Un correo por sesión: fullyParallel ejecuta los tests a la vez y leerCodigo
// toma el último mensaje del correo, así que compartirlo cruzaría los códigos.
const correo = (sufijo: string) => `ci-test-ruta-${sufijo}@example.com`;

function planRuta(planId: string, modo: "tren" | "avion" | "coche"): Plan {
  const franjas = franjasComoArray("Portugal");
  return {
    id: planId,
    version: 1,
    destino: "Portugal",
    personas: 2,
    dias: Array.from({ length: 8 }, (_, i) => ({
      fecha: `2027-06-${String(8 + i).padStart(2, "0")}`,
      franjas,
      etapa: i < 4 ? 0 : 1,
      paradas: [
        {
          id: `p-ruta-${i}`,
          franja_id: "manana",
          nombre: `Sitio ${i + 1}`,
          descripcion: "Visita",
          coordenadas: i < 4 ? { lat: 38.72, lon: -9.14 } : { lat: 41.15, lon: -8.61 },
          duracion_min: 60,
          prioridad: 80,
          coste: { importe_eur: 30, por: "grupo", procedencia: "estimado", fecha: "2027-06-08" },
          procedencia: { fuente: "propuesto-sin-verificar" },
          lugar: { fuente: "osm", id: `osm:way/${i}`, url: "https://www.openstreetmap.org/way/1", nombre_fuente: `Sitio ${i + 1}`, etiquetas: {}, resuelto_en: new Date().toISOString() },
          resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() },
        },
      ],
    })),
    etapas: [etapaSembrada("Lisboa", 4, 0, 90, ["Quitamos Coímbra: 1 día no deja tiempo para descansar"], "Por qué Lisboa"), etapaSembrada("Oporto", 4, 4, 80, [], "Por qué Oporto")],
    traslados: [{ desde: "Lisboa", hasta: "Oporto", modo, distancia_km: 313, duracion_min: 229, coste_eur: 79, procedencia: "estimado" }],
  };
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
  await sembrarPlan(supabase, planRuta(planId, modo));
  const { error } = await supabase.from("trabajos").insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { presupuesto_eur: 3000 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}?dia=resumen`);
  await expect(pagina.getByRole("heading", { name: "Portugal" })).toBeVisible();
  return { contexto, pagina };
}

test("Ruta del viaje: etapas, traslado, presupuesto y ajustes, sin aviso de ciudad (etv-ac1, etv-ac3)", async ({ browser }) => {
  const { contexto, pagina } = await abrirPlan(browser, clienteDePrueba("servicio"), "tren", "etapas");
  const ruta = pagina.getByTestId("ruta-viaje");
  await expect(ruta).toBeVisible();

  const etapas = await ruta.getByTestId("etapa-ruta").locator("h4").allTextContents();
  expect(etapas).toEqual(["Lisboa · 4 noches", "Oporto · 3 noches"]);
  await expect(ruta.getByText("Lisboa → Oporto · autobús", { exact: false })).toHaveCount(0);
  await expect(ruta.getByText("Lisboa → Oporto · tren · ~3 h 49 min · ~79 € (estimado)")).toBeVisible();
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText("Total estimado: ~919 €");
  await expect(pagina.getByTestId("presupuesto-plan")).toContainText(/Tu presupuesto: 3\.000\u00a0€/);
  await expect(ruta.getByText("Quitamos Coímbra: 1 día no deja tiempo para descansar")).toBeVisible();
  await expect(pagina.getByText(/No hemos identificado la ciudad/)).toHaveCount(0);

  // Pulsar una etapa lleva a su primer día.
  await ruta.getByRole("button", { name: /Oporto · 3 noches/ }).click();
  await expect(pagina.getByRole("heading", { name: /^Día 4 · / })).toBeVisible();

  // etv-ac3: sin desbordamiento horizontal en el móvil.
  const ancho = await pagina.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(ancho.scroll).toBeLessThanOrEqual(ancho.client);
  await contexto.close();
});

test("cada día nombra su ciudad y su mapa se centra en ella (etv-ac2)", async ({ browser }) => {
  const { contexto, pagina } = await abrirPlan(browser, clienteDePrueba("servicio"), "coche", "dias");
  const chips = pagina.getByRole("navigation", { name: "Días del viaje" }).getByRole("link");
  const centroDelDia = async () => {
    const texto = await pagina.locator(".contenedor-mapa-dia").getAttribute("data-centro");
    const [lat, lon] = (texto ?? "").split(",").map(Number);
    return { lat, lon };
  };
  const dentro = (c: { lat: number; lon: number }, caja: typeof CAJA_LISBOA) => c.lat >= caja.minLat && c.lat <= caja.maxLat && c.lon >= caja.minLon && c.lon <= caja.maxLon;

  await chips.nth(1).click();
  await expect(pagina.getByRole("heading", { name: /^Día 1 · .* · Lisboa$/ })).toBeVisible();
  expect(dentro(await centroDelDia(), CAJA_LISBOA)).toBe(true);
  await chips.nth(5).click();
  await expect(pagina.getByRole("heading", { name: /^Día 5 · .* · Oporto$/ })).toBeVisible();
  expect(dentro(await centroDelDia(), CAJA_OPORTO)).toBe(true);
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
