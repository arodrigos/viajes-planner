import { expect, test, type Page } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";

// tar-ac1..ac5 sobre un plan simulado por red: no hace falta sesión ni base
// de datos, y el reloj fijado antes del viaje deja el día sin tarjeta «Hoy».
const CONSEJO = "Llega temprano para evitar colas y reserva la entrada con antelación: en temporada alta las franjas de la mañana se agotan varios días antes. ".repeat(2);
const MOTIVO = "Es uno de los lugares imprescindibles de la ciudad y encaja con un recorrido tranquilo a pie, sin prisas, con sombra y sitios donde sentarse a descansar un rato. ".repeat(2);

function curiosidad(texto: string, fuente: "wikipedia" | "wikidata" = "wikipedia", idioma: "es" | "en" = "es") {
  return { texto, idioma, fuente, url: fuente === "wikidata" ? "https://www.wikidata.org/wiki/Q1" : `https://${idioma}.wikipedia.org/wiki/X#:~:text=a`, seleccion: "modelo" as const };
}

function parada(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `p${i}`,
    franja_id: "manana",
    nombre: `Sitio ${i} (ejemplo)`,
    descripcion: "Un lugar para pasear y conocer la historia de la ciudad.",
    procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
    coordenadas: { lat: 38.7 + i / 100, lon: -9.1 },
    coste: { importe_eur: 10, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
    motivo: MOTIVO,
    guia: { consejo: CONSEJO, url: "https://en.wikivoyage.org/wiki/Lisbon", licencia: "CC BY-SA" },
    guia_intentada_en: "2026-10-05T00:00:00Z",
    curiosidades: {
      frases: [],
      url: "",
      seleccion: "modelo",
      items: [curiosidad("La primera curiosidad del lugar."), curiosidad("The second fact about the place.", "wikipedia", "en"), curiosidad("Se inauguró en 1857.", "wikidata")],
    },
    ...extra,
  };
}

const ALTERNATIVAS = [
  { id: "a1", nombre: "Alternativa B (ejemplo)", descripcion: "d", motivo: "Mismo tipo de plan.", origen: "modelo", procedencia: { fuente: "osm" }, etiquetasEncaje: [] },
  { id: "a2", nombre: "Alternativa C (ejemplo)", descripcion: "d", motivo: "Más cerca.", origen: "cercano", distancia_m: 300, procedencia: { fuente: "osm" }, etiquetasEncaje: [] },
];

const FOTO = { url: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", autor: "Autora de ejemplo", licencia: "CC BY-SA 4.0", licencia_url: "https://creativecommons.org/licenses/by-sa/4.0/", pagina_url: "https://commons.wikimedia.org/wiki/File:X.jpg" };

function plan(paradas: unknown[], tramos: unknown[] = []) {
  return {
    id: "plan-tarjeta", version: 1, destino: "Lisboa", personas: 2, avisos: [], recomendaciones: [], regenerando: false, trabajoId: "t", zona: "Europe/Lisbon",
    dias: [{ fecha: "2027-06-08", franjas: [{ id: "manana", etiqueta: "Mañana" }], paradas, tramos }],
  };
}

const tramo = (desdeId: string, hastaId: string) => ({ desdeId, hastaId, km: 0.9, minutos: 12, modo: "a-pie", href: "https://www.google.com/maps/dir/?api=1" });

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page, datos: unknown) {
  await page.clock.install({ time: new Date("2027-06-01T12:00:00Z") });
  await page.route("**/api/plan/*", (r) => r.fulfill({ json: datos }));
  await page.goto("/plan/plan-tarjeta?dia=1");
  await expect(page.getByRole("heading", { level: 2, name: /^Día 1 · / })).toBeVisible();
}

const abiertos = (tarjeta: ReturnType<Page["locator"]>) => tarjeta.locator("details[open]");

test("a la vista lo esencial y tres paneles que se abren de uno en uno (tar-ac1)", async ({ page }) => {
  await abrir(page, plan([parada(1, { foto: FOTO, alternativas: ALTERNATIVAS, horario: { inicio: "10:00", fin: "11:30", recortada: false, apertura: "Abierto" } }), parada(2)], [tramo("p1", "p2")]));
  const tarjeta = page.locator("li.tarjeta-parada", { hasText: "Sitio 1 (ejemplo)" });

  await expect(tarjeta.getByRole("heading", { level: 4, name: "Sitio 1 (ejemplo)" })).toBeVisible();
  await expect(tarjeta.getByTestId("horario-parada")).toBeVisible();
  await expect(tarjeta.getByText("Un lugar para pasear")).toBeVisible();
  await expect(tarjeta.getByTestId("precio-parada")).toBeVisible();
  await expect(tarjeta.getByText(/Ubicación comprobada/)).toBeVisible();
  // La miniatura va antes que la descripción en el DOM.
  const orden = await tarjeta.evaluate((el) => {
    const img = el.querySelector("img");
    const desc = Array.from(el.querySelectorAll("p")).find((p) => p.textContent?.includes("Un lugar para pasear"));
    return Boolean(img && desc && img.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(orden).toBe(true);
  await expect(tarjeta.locator("img").first()).toHaveAttribute("alt", "Sitio 1 (ejemplo)");
  expect(await tarjeta.locator("img").first().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(88);
  // El conector hacia la parada siguiente (va entre las dos tarjetas).
  await expect(page.getByTestId("tramo-parada")).toHaveCount(1);
  await expect(abiertos(tarjeta)).toHaveCount(0);
  await expect(tarjeta.getByTestId("motivo-parada")).toBeHidden();

  await tarjeta.locator("summary", { hasText: "Por qué te lo proponemos" }).click();
  await expect(tarjeta.getByTestId("motivo-parada")).toBeVisible();
  await expect(tarjeta.getByText("Lo dice el planificador")).toBeVisible();

  await tarjeta.locator("summary", { hasText: "Consejos y curiosidades (4)" }).click();
  await expect(abiertos(tarjeta)).toHaveCount(1);
  await expect(tarjeta.getByTestId("motivo-parada")).toBeHidden();
  await expect(tarjeta.getByTestId("curiosidades-parada").locator("li")).toHaveCount(3);

  await tarjeta.locator("summary", { hasText: "Alternativas (2)" }).click();
  await expect(abiertos(tarjeta)).toHaveCount(1);
  await expect(tarjeta.getByTestId("curiosidades-parada")).toBeHidden();
  await expect(tarjeta.getByRole("button", { name: "Usar esta" })).toHaveCount(2);
  await comprobarAccesibilidad(page);
});

test("límites: sin alternativas no hay panel, sin foto hay marcador y la última parada no lleva conector (tar-ac1)", async ({ page }) => {
  await abrir(page, plan([parada(1), parada(2)], [tramo("p1", "p2")]));
  const ultima = page.locator("li.tarjeta-parada", { hasText: "Sitio 2 (ejemplo)" });
  await expect(ultima.locator("summary", { hasText: /^Alternativas/ })).toHaveCount(0);
  await expect(ultima.getByText("Sin foto")).toBeVisible();
  await expect(ultima.locator("img")).toHaveCount(0);
  // Solo hay un tramo y precede a la segunda: tras la última no hay ninguno.
  await expect(ultima.locator("xpath=following-sibling::*[@data-testid='tramo-parada']")).toHaveCount(0);
});

test("«Sin comprobar» y el crédito de la foto se ven sin abrir nada (tar-ac4)", async ({ page }) => {
  await abrir(page, plan([parada(1, { foto: FOTO, procedencia: { fuente: "propuesto-sin-verificar" } })]));
  const tarjeta = page.locator("li.tarjeta-parada");
  await expect(abiertos(tarjeta)).toHaveCount(0);
  await expect(tarjeta.getByText(/Sin comprobar/)).toBeVisible();
  await expect(tarjeta.getByRole("link", { name: "Autora de ejemplo" })).toBeVisible();
  await expect(tarjeta.getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
});

test("la atribución y el ↗ de cada curiosidad van en su línea, de 44 px (tar-ac3)", async ({ page }) => {
  await abrir(page, plan([parada(1)]));
  const tarjeta = page.locator("li.tarjeta-parada");
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const items = tarjeta.getByTestId("curiosidades-parada").locator("li");
  await expect(items).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const medidas = await items.nth(i).evaluate((li) => {
      const texto = li.querySelector<HTMLElement>(".texto-curiosidad")!;
      const atribucion = li.querySelector<HTMLElement>(".atribucion-curiosidad")!;
      const enlace = atribucion.querySelector("a")!;
      const linea = parseFloat(getComputedStyle(texto).lineHeight);
      const alto = texto.getBoundingClientRect().height;
      return { distintos: texto !== atribucion && !texto.contains(enlace), enlace: enlace.getBoundingClientRect().height, lineas: alto / linea, alto, linea };
    });
    expect(medidas.distintos).toBe(true);
    expect(medidas.enlace).toBeGreaterThanOrEqual(44);
    // Alto del párrafo = nº entero de líneas × line-height (tolerancia 2 px).
    expect(Math.abs(medidas.alto - Math.round(medidas.lineas) * medidas.linea)).toBeLessThanOrEqual(2);
  }
});

test("cambiar por una alternativa crea versión nueva y lo dice (tar-ac2)", async ({ page }) => {
  let enviados = 0;
  const antes = plan([parada(1, { nombre: "Parada A (ejemplo)", alternativas: [ALTERNATIVAS[0]] })]);
  const despues = plan([parada(1, { nombre: "Alternativa B (ejemplo)" })]);
  let cambiado = false;
  await page.clock.install({ time: new Date("2027-06-01T12:00:00Z") });
  await page.route("**/api/plan/*/paradas/*/sustituir", async (r) => {
    enviados++;
    cambiado = true;
    await r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/plan/plan-tarjeta", (r) => r.fulfill({ json: cambiado ? { ...despues, version: 2 } : antes }));
  await page.goto("/plan/plan-tarjeta?dia=1");
  const tarjeta = page.locator("li.tarjeta-parada");
  await tarjeta.locator("summary", { hasText: "Alternativas (1)" }).click();
  const boton = tarjeta.getByRole("button", { name: "Usar esta" });
  await boton.click();
  await boton.click({ force: true }).catch(() => undefined);
  await expect(page.getByRole("status").filter({ hasText: "Hecho: ahora vas a Alternativa B (ejemplo)" })).toBeVisible();
  await expect(tarjeta.getByRole("heading", { level: 4, name: "Alternativa B (ejemplo)" })).toBeVisible();
  expect(enviados).toBe(1);
  await expect(abiertos(tarjeta)).toHaveCount(0);
});

test("un error del servidor se muestra en el panel y la parada no cambia (tar-ac2, límite)", async ({ page }) => {
  await page.clock.install({ time: new Date("2027-06-01T12:00:00Z") });
  await page.route("**/api/plan/*/paradas/*/sustituir", (r) => r.fulfill({ status: 400, json: { error: "La alternativa ya no es de este plan; recarga." } }));
  await page.route("**/api/plan/plan-tarjeta", (r) => r.fulfill({ json: plan([parada(1, { nombre: "Parada A (ejemplo)", alternativas: [ALTERNATIVAS[0]] })]) }));
  await page.goto("/plan/plan-tarjeta?dia=1");
  const tarjeta = page.locator("li.tarjeta-parada");
  await tarjeta.locator("summary", { hasText: "Alternativas (1)" }).click();
  await tarjeta.getByRole("button", { name: "Usar esta" }).click();
  await expect(tarjeta.getByRole("alert")).toContainText("La alternativa ya no es de este plan");
  await expect(tarjeta.getByRole("heading", { level: 4, name: "Parada A (ejemplo)" })).toBeVisible();
});

test("un día de 5 paradas con los paneles cerrados es al menos un 40 % más corto (tar-ac5)", async ({ page }) => {
  await abrir(page, plan([1, 2, 3, 4, 5].map((i) => parada(i, { foto: FOTO, alternativas: [ALTERNATIVAS[0]] })), [1, 2, 3, 4].map((i) => tramo(`p${i}`, `p${i + 1}`))));
  const panel = page.locator("section.seccion-dia");
  const cerrado = await panel.evaluate((el) => el.scrollHeight);
  // Referencia medida en el mismo test: la misma tarjeta con todos sus paneles
  // abiertos equivale a la anterior, que lo enseñaba todo de una vez. Quitar
  // `name` deja abrirlos a la vez; las alternativas no cuentan (antes
  // tampoco estaban a la vista).
  const abierto = await panel.evaluate((el) => {
    el.querySelectorAll("details").forEach((d) => {
      d.removeAttribute("name");
      d.open = true;
    });
    return el.scrollHeight;
  });
  expect(cerrado).toBeLessThanOrEqual(abierto * 0.6);
});
