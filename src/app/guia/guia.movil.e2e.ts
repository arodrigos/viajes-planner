import { expect, test } from "@playwright/test";

// guia-ac7: solo corre en el proyecto 'movil' (viewport Pixel 5, 393x851),
// que es el que mide "primer viewport sin hacer scroll" con geometría real.

const TRABAJO_FIXTURE = {
  id: "trabajo-guia-e2e",
  estado: "en-curso",
  etapa: "verificando sitios",
  porcentaje: 40,
  motivo: null,
  reintento_no_antes_de: null,
};

const PLAN_FIXTURE = {
  id: "plan-guia-e2e",
  destino: "Sevilla",
  dias: [],
  avisos: [],
};

// guia-ac7(a): alcanzable sin escribir ninguna dirección, visible sin scroll
// en el primer viewport, a un toque de distancia.
test("el enlace a la guía está en el primer viewport de la portada, sin hacer scroll", async ({ page }) => {
  await page.goto("/");
  const enlace = page.getByRole("link", { name: "¿Cómo funciona esta aplicación?" });
  await expect(enlace).toBeVisible();

  const viewport = page.viewportSize();
  const caja = await enlace.boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(viewport!.height);

  await enlace.click();
  await expect(page).toHaveURL("/guia");
});

// guia-ac7(a): el enlace del pie existe en las cuatro páginas del producto,
// no solo en la portada -por eso también alcanza a quien ya está atascado.
test("el enlace del pie a la guía está en las cuatro páginas", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_FIXTURE }));
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));

  const paginas = ["/", "/criterios", "/trabajos/trabajo-guia-e2e", "/plan/plan-guia-e2e"];
  for (const ruta of paginas) {
    await page.goto(ruta);
    await expect(page.getByRole("link", { name: "Guía: cómo funciona esta aplicación" }), `pie en ${ruta}`).toBeVisible();
  }
});

// guia-ac7(a): pública de verdad -sin cookie de sesión- y con la misma
// cabecera de no indexación que el resto del producto.
test("GET /guia responde 200 sin sesión y lleva la cabecera de no indexación", async ({ request }) => {
  const respuesta = await request.get("/guia", { headers: {} });
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

// guia-ac7(c): longitud y estructura del contenido -nunca solo "existe una
// página en /guia"-, y captura para que el gatekeeper juzgue guia-ac7(b/d).
test("el contenido de /guia tiene la extensión y estructura exigidas", async ({ page }) => {
  await page.goto("/guia");
  await expect(page.getByRole("heading", { name: "Guía: cómo funciona esta aplicación" })).toBeVisible();

  const numeroDePalabras = await page.evaluate(() => document.body.innerText.trim().split(/\s+/).length);
  expect(numeroDePalabras).toBeGreaterThan(120);
  expect(numeroDePalabras).toBeLessThan(450);

  const pasos = await page.locator("ol > li").count();
  expect(pasos).toBeGreaterThanOrEqual(5);

  const alto = await page.evaluate(() => document.body.scrollHeight);
  const viewport = page.viewportSize()!;
  expect(alto).toBeLessThanOrEqual(4 * viewport.height);

  await page.screenshot({ path: "artefactos/capturas/guia.png", fullPage: true });
});
