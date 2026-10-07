import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { abrirOpciones } from "../app/plan/[id]/opciones-e2e";
import { ANCHO_MOVIL, DIAS_PLAN_PRUEBA, FIRMA_PNG, abrirDia, haversineKm, pngDimensiones } from "./ayudas";
import { DIRECTORIO, planDePrueba } from "./entorno";

// Las expectativas son estructurales (el plan lo genera el trabajador real y
// no es determinista); los goldens exactos siguen en el CI.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // El camino de descarga es el que se comprueba: sin navigator.share.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
});

async function descargarInfografia(page: Page): Promise<Buffer> {
  await abrirDia(page, 1);
  await abrirOpciones(page);
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar infografía" }).click()]);
  expect(descarga.suggestedFilename()).toMatch(/\.png$/);
  return readFileSync(await descarga.path());
}

test("pv-ie2e-01: «Descargar infografía» entrega un PNG de 1080×1350 con cabeceras privadas (cp-ie2e-01)", async ({ page, request }) => {
  const bytes = await descargarInfografia(page);
  const png = pngDimensiones(bytes);
  expect(png.firma).toEqual(FIRMA_PNG);
  expect([png.ancho, png.alto]).toEqual([1080, 1350]);
  expect(bytes.length).toBeGreaterThan(20 * 1024);

  const cabeceras = (await request.get(`/api/plan/${planDePrueba()}/infografia.png`)).headers();
  expect(cabeceras["content-type"]).toBe("image/png");
  expect(cabeceras["cache-control"]).toMatch(/private/);
  expect(cabeceras["cache-control"]).toMatch(/no-store/);
});

test("pv-ie2e-02: la lámina descargada queda guardada para el juicio visual (cp-ie2e-02)", async ({ page }, info) => {
  const bytes = await descargarInfografia(page);
  const png = pngDimensiones(bytes);
  expect([png.ancho, png.alto]).toEqual([1080, 1350]);
  expect(bytes.length).toBeGreaterThan(20 * 1024);
  // Dentro de artefactos/ (ignorado por git): el gatekeeper la lee y juzga que
  // se ven «Día 1» a «Día 7», «y 3 días más» y el pie con «10 días».
  mkdirSync(`${DIRECTORIO}/capturas`, { recursive: true });
  const ruta = `${DIRECTORIO}/capturas/pv-ie2e-02-infografia.png`;
  writeFileSync(ruta, bytes);
  info.annotations.push({ type: "captura", description: ruta });
});

test("pv-ip-01: «Ver infografía» la enseña en la página sin descargar y a ancho de móvil (cp-ip-01)", async ({ page }) => {
  const respuestas: { status: number; tipo: string }[] = [];
  let pedidas = 0;
  let descargas = 0;
  page.on("request", (r) => {
    if (r.url().includes("infografia.png")) pedidas += 1;
  });
  page.on("response", (r) => {
    if (r.url().includes("infografia.png")) respuestas.push({ status: r.status(), tipo: r.headers()["content-type"] ?? "" });
  });
  page.on("download", () => {
    descargas += 1;
  });

  await abrirDia(page, 1);
  await abrirOpciones(page);
  expect(pedidas).toBe(0);

  const boton = page.getByRole("button", { name: "Ver infografía" });
  // Un clic antes de hidratar no hace nada: se repite hasta que responde.
  await expect(async () => {
    await boton.click();
    await expect(boton).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass();
  const imagen = page.getByRole("img", { name: "Infografía del viaje" });
  await expect(imagen).toBeVisible({ timeout: 60_000 });
  await expect(boton).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 60_000 }).toBe(1080);
  expect(await imagen.evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(1350);
  expect(pedidas).toBe(1);
  expect(respuestas).toEqual([{ status: 200, tipo: "image/png" }]);
  const ancho = (await imagen.boundingBox())!.width;
  expect(ancho).toBeGreaterThan(300);
  expect(ancho).toBeLessThanOrEqual(ANCHO_MOVIL);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ANCHO_MOVIL);
  expect(descargas).toBe(0);
});

test("pv-enl-01: cada parada trae enlace de mapa con su coordenada y su fuente (cp-enl-01)", async ({ page }) => {
  await abrirDia(page, 1);
  const tarjetas = page.locator("li.tarjeta-parada");
  const n = await tarjetas.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const tarjeta = tarjetas.nth(i);
    const nombre = (await tarjeta.locator("h4").innerText()).trim();
    const mapa = tarjeta.getByRole("link", { name: "Ver en Google Maps" });
    await expect(mapa, nombre).toHaveCount(1);
    const href = (await mapa.getAttribute("href"))!;
    const sinComprobar = (await tarjeta.locator(".procedencia-sin-comprobar").count()) > 0;
    if (sinComprobar) {
      expect(href, nombre).toContain(encodeURIComponent(nombre));
      await expect(tarjeta.getByRole("link", { name: /^Fuente:/ }), nombre).toHaveCount(0);
    } else {
      expect(href, nombre).toMatch(/query=-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
      await expect(tarjeta.getByRole("link", { name: /^Fuente: (OpenStreetMap|Wikipedia)$/ }), nombre).toHaveCount(1);
    }
  }
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.filter((h) => h.trim().toLowerCase().startsWith("javascript:"))).toEqual([]);
});

// Recorre los días hasta que alguno cumple lo que busca el caso: el plan es
// real y no se sabe de antemano en qué día cae cada cosa.
async function primerDiaCon(page: Page, buscar: () => Locator): Promise<number | null> {
  for (let dia = 1; dia <= DIAS_PLAN_PRUEBA; dia++) {
    await abrirDia(page, dia);
    if ((await buscar().count()) > 0) return dia;
  }
  return null;
}

test("pv-cc-02: el consejo largo se pliega a 4 líneas y «Ver más» lo despliega entero (cp-cc-02)", async ({ page }) => {
  const dia = await primerDiaCon(page, () => page.locator(".boton-ver-mas"));
  expect(dia, "ningún consejo del plan es largo: el caso no se puede juzgar").not.toBeNull();
  const tarjeta = page.locator("li.tarjeta-parada", { has: page.locator(".boton-ver-mas") }).first();
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const consejo = tarjeta.getByTestId("consejo-guia");
  const boton = tarjeta.locator(".boton-ver-mas");
  const interlineado = await consejo.evaluate((p) => parseFloat(getComputedStyle(p).lineHeight));
  const completo = (await consejo.textContent()) ?? "";
  const ultimaFrase = completo.trim().split(/(?<=[.!?])\s+/).pop()!;

  await expect(boton).toHaveAttribute("aria-expanded", "false");
  expect((await consejo.boundingBox())!.height).toBeLessThanOrEqual(4 * interlineado + 1);
  expect(completo).toContain(ultimaFrase);

  await boton.click();
  await expect(boton).toHaveAttribute("aria-expanded", "true");
  await expect(boton).toHaveText("Ver menos");
  expect((await consejo.boundingBox())!.height).toBeGreaterThan(4 * interlineado);
  expect(await consejo.evaluate((p) => p.scrollHeight <= p.clientHeight + 1)).toBe(true);
  await expect(consejo).toContainText(ultimaFrase);

  // Un consejo corto no lleva botón.
  const cortos = await page.getByTestId("consejo-guia").evaluateAll((ps) => ps.filter((p) => (p.textContent ?? "").length <= 280).length);
  const botones = await page.locator(".boton-ver-mas").count();
  expect(botones).toBe((await page.getByTestId("consejo-guia").count()) - cortos);
});

test("pv-tra-02: cada tramo muestra minutos y km coherentes con la distancia real (cp-tra-02)", async ({ page }) => {
  const dia = await primerDiaCon(page, () => page.getByTestId("tramo-parada").nth(1));
  expect(dia, "ningún día del plan tiene 3 paradas ubicadas: el caso no se puede juzgar").not.toBeNull();
  const tramos = page.getByTestId("tramo-parada");
  for (let i = 0; i < (await tramos.count()); i++) {
    const tramo = tramos.nth(i);
    const texto = (await tramo.innerText()).replace(/\s+/g, " ");
    const m = texto.match(/(\d[\d.]*,\d) km/);
    expect(m, texto).not.toBeNull();
    expect(texto).toMatch(/\d+ (min|h)/);
    const km = Number(m![1].replace(/\./g, "").replace(",", "."));
    const href = (await tramo.getByRole("link", { name: "Cómo ir" }).getAttribute("href"))!;
    const q = new URL(href).searchParams;
    const [oLat, oLon] = q.get("origin")!.split(",").map(Number);
    const [dLat, dLon] = q.get("destination")!.split(",").map(Number);
    const recto = haversineKm({ lat: oLat, lon: oLon }, { lat: dLat, lon: dLon });
    // Estimación por línea recta con un factor de rodeo: el caso pide menos de un 5 % de diferencia.
    // El km del texto va redondeado a una decimal: en tramos cortos esa décima
    // pesa más del 5 %, así que se admite también el propio redondeo.
    expect(Math.abs(km - recto), `${texto} vs ${recto.toFixed(2)} km`).toBeLessThanOrEqual(Math.max(0.05 * recto, 0.06));
    if (km > 1.6) expect(href).toContain("travelmode=transit");
    if (km < 1.4) expect(href).toContain("travelmode=walking");
  }
});

let paradaCambiada: { dia: number; original: string; nueva: string } | null = null;

async function tarjetaConAlternativas(page: Page): Promise<number | null> {
  return primerDiaCon(page, () => page.locator("summary", { hasText: /^Alternativas \([1-9]\d*\)$/ }));
}

test("pv-alr-02: «Usar esta» cambia la parada con estado de espera y sobrevive a recargar (cp-alr-02)", async ({ page }) => {
  const dia = await tarjetaConAlternativas(page);
  expect(dia, "ninguna parada del plan tiene alternativas: el caso no se puede juzgar").not.toBeNull();
  const tarjeta = page.locator("li.tarjeta-parada", { has: page.locator("summary", { hasText: /^Alternativas \([1-9]\d*\)$/ }) }).first();
  const original = (await tarjeta.locator("h4").innerText()).trim();
  await tarjeta.locator("summary", { hasText: /^Alternativas/ }).click();
  const primera = tarjeta.locator(".tarjeta-alternativa").first();
  const nueva = (await primera.locator("strong").innerText()).trim();
  const usar = primera.getByRole("button");
  const inicio = await page.evaluate(() => performance.now());
  await usar.click();
  await expect(usar).toHaveText("Cambiando…");
  await expect(tarjeta.getByRole("region", { name: /^Alternativas a / })).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("li.tarjeta-parada h4", { hasText: nueva }).first()).toBeVisible({ timeout: 30_000 });
  const fin = await page.evaluate(() => performance.now());
  paradaCambiada = { dia: dia!, original, nueva };
  test.info().annotations.push({ type: "ms-cambio", description: String(Math.round(fin - inicio)) });

  await page.reload();
  await expect(page.locator("li.tarjeta-parada h4", { hasText: nueva }).first()).toBeVisible();
});

test("pv-alg-02: la parada nueva sigue siendo completa y se puede volver a la anterior (cp-alg-02)", async ({ page }) => {
  expect(paradaCambiada, "pv-alr-02 no dejó una parada cambiada").not.toBeNull();
  const { dia, original, nueva } = paradaCambiada!;
  await abrirDia(page, dia);
  const tarjeta = page.locator("li.tarjeta-parada", { has: page.locator("h4", { hasText: nueva }) }).first();

  // El cambio se ve en menos de 5 s, medido de forma explícita sobre un segundo
  // cambio (volver a la original) para no depender de la carga de la página.
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const hayConsejos = (await tarjeta.getByTestId("guia-parada").count()) > 0;
  expect(hayConsejos, "la parada nueva no tiene ni el panel de consejos ni su estado vacío").toBe(true);

  await tarjeta.locator("summary", { hasText: /^Alternativas/ }).click();
  const vuelta = tarjeta.locator(".tarjeta-alternativa", { hasText: original }).first();
  await expect(vuelta).toBeVisible();
  const inicio = await page.evaluate(() => performance.now());
  await vuelta.getByRole("button").click();
  await expect(page.locator("li.tarjeta-parada h4", { hasText: original }).first()).toBeVisible({ timeout: 30_000 });
  const ms = (await page.evaluate(() => performance.now())) - inicio;
  expect(ms).toBeLessThan(5_000);
});

test("pv-cur-03: las curiosidades traen enlace verificable, su fuente y el idioma marcado (cp-cur-03)", async ({ page }) => {
  const dia = await primerDiaCon(page, () => page.getByTestId("curiosidades-parada").locator("li"));
  expect(dia, "ninguna parada del plan tiene curiosidades: el caso no se puede juzgar").not.toBeNull();
  const tarjeta = page.locator("li.tarjeta-parada", { has: page.getByTestId("curiosidades-parada").locator("li") }).first();
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const items = tarjeta.getByTestId("curiosidades-parada").locator("ul > li");
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(4);
  for (let i = 0; i < n; i++) {
    const item = items.nth(i);
    const enlace = item.getByRole("link");
    const href = (await enlace.getAttribute("href"))!;
    expect(href).toMatch(/^https:\/\/([a-z-]+\.)?(wikipedia|wikidata)\.org\//);
    expect(href).toMatch(/#:~:text=|\/wiki\/Q\d+/);
    const rotulo = ((await enlace.innerText()) ?? "").trim();
    expect(rotulo).toMatch(/^(Wikipedia|Wikidata)/);
    const enIngles = (await item.locator("p[lang]").count()) > 0;
    if (href.includes("//en.wikipedia.org")) {
      expect(enIngles).toBe(true);
      expect(rotulo).toContain("en inglés");
      await expect(item.locator("p[lang='en']")).toHaveCount(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ANCHO_MOVIL);
});
