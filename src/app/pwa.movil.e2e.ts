import { expect, test } from "@playwright/test";
import { capturar } from "@/test-utils/capturas";

// Esta spec es de las pocas que necesitan el service worker de verdad: el
// resto de la suite corre con serviceWorkers "block" (playwright.config.ts).
test.use({ serviceWorkers: "allow" });

test("pwa-ac1: /viajes deja un service worker que controla la página tras recargar, con manifiesto e iconos instalables", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));

  await page.goto("/viajes");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toMatch(/\/sw\.js$/);

  const hrefManifiesto = await page.locator("link[rel=manifest]").getAttribute("href");
  expect(hrefManifiesto).toBeTruthy();
  const respuestaManifiesto = await page.request.get(hrefManifiesto!);
  expect(respuestaManifiesto.status()).toBe(200);
  const manifiesto = await respuestaManifiesto.json();
  expect(manifiesto).toMatchObject({ name: "Viajes", start_url: "/viajes", display: "standalone" });

  const iconos: Array<{ src: string; sizes: string; purpose?: string }> = manifiesto.icons;
  expect(iconos.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(iconos.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icono of iconos) {
    const r = await page.request.get(icono.src);
    expect(r.status(), icono.src).toBe(200);
    expect(r.headers()["content-type"], icono.src).toBe("image/png");
  }

  await expect(page.locator("link[rel=apple-touch-icon]")).toHaveCount(1);
  await expect(page.locator("meta[name=apple-mobile-web-app-capable]")).toHaveAttribute("content", "yes");
  expect(errores).toEqual([]);
});

test("pwa-ac2: /sw.js se sirve como JavaScript sin caché y lo genera el build, no un route handler", async ({ request }) => {
  const r = await request.get("/sw.js");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/^(application|text)\/javascript/);
  expect(r.headers()["cache-control"]).toContain("no-cache");
  expect(await r.text()).toContain("serwist");
});

test("pwa-ac3 (local): el SW contesta a {tipo:'version'} con un commit", async ({ page }) => {
  await page.goto("/viajes");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const respuesta = await page.evaluate(
    () =>
      new Promise<{ commit: string }>((resolver) => {
        const canal = new MessageChannel();
        canal.port1.onmessage = (e) => resolver(e.data);
        navigator.serviceWorker.controller!.postMessage({ tipo: "version" }, [canal.port2]);
      }),
  );
  expect(respuesta.commit).toMatch(/^[0-9a-f]{40}$/);
});

test("invariante: tras recorrer la app, CacheStorage solo contiene la precache de Serwist", async ({ page }) => {
  await page.goto("/viajes");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto("/guia");
  await page.goto("/privacidad");
  const nombres = await page.evaluate(() => caches.keys());
  expect(nombres.length).toBeGreaterThan(0);
  for (const n of nombres) expect(n, n).toMatch(/^serwist-precache/);
  const urls = await page.evaluate(async () => {
    const salida: string[] = [];
    for (const n of await caches.keys()) for (const q of await (await caches.open(n)).keys()) salida.push(new URL(q.url).pathname);
    return salida;
  });
  expect(urls.filter((u) => u.startsWith("/api/"))).toEqual([]);
  expect(urls.some((u) => /^\/plan\//.test(u))).toBe(false);
});

test("pwa-ac5: /guia enseña «Instalar en el móvil» con los pasos de Android, de iPhone y la nota de abrir el plan", async ({ page }) => {
  await page.goto("/guia");
  const titulo = page.getByRole("heading", { name: "Instalar en el móvil" });
  await expect(titulo).toBeVisible();
  const main = page.locator("main");
  await expect(main).toContainText("Instalar aplicación");
  await expect(main).toContainText("Compartir");
  await expect(main).toContainText("Añadir a pantalla de inicio");
  await expect(main).toContainText("Antes de viajar, abre el plan una vez desde la app instalada");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await titulo.scrollIntoViewIfNeeded();
  await capturar(page, "pwa-instalable", "guia-instalar");
});
