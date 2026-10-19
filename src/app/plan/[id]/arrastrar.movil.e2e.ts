import { expect, test } from "@playwright/test";
import { capturar } from "@/test-utils/capturas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { NOMBRES, abrirPlan, ordenPintado, parada, sembrarDia, ultimaVersionDelDia } from "./orden-e2e";

// arr-ac2 y arr-ac4: en el móvil el arrastre no roba el scroll y la tarjeta cabe con asa y botones.
test.use({ viewport: { width: 360, height: 640 }, hasTouch: true });

test("deslizar el dedo fuera del asa desplaza la página y no cambia el orden (arr-ac2, arr-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-arrastrar-movil@example.com";
  const planId = await sembrarDia(supabase, email, "arr2", [
    parada("a", NOMBRES.a, "manana", 0),
    parada("b", NOMBRES.b, "manana", 1),
    parada("c", NOMBRES.c, "manana", 2),
    parada("d", NOMBRES.d, "manana", 3),
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { viewport: { width: 360, height: 640 } });
  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/orden")) posts.push(r.url());
  });

  const antes = await ordenPintado(pagina);
  expect(antes).toEqual(["Alfa", "Beta", "Gamma", "Delta"]);
  await capturar(pagina, "arrastrar-paradas", "tarjeta-360");
  // Nada se solapa ni se corta: asa, Subir/Bajar y nombre caben dentro de la tarjeta y de la pantalla.
  const tarjeta = pagina.locator("li.tarjeta-parada").nth(1);
  const caja = await tarjeta.boundingBox();
  for (const nombre of [/Arrastrar para mover/, /Subir/, /Bajar/]) {
    const c = await tarjeta.getByRole("button", { name: nombre }).boundingBox();
    expect(c!.x).toBeGreaterThanOrEqual(caja!.x - 1);
    expect(c!.x + c!.width).toBeLessThanOrEqual(caja!.x + caja!.width + 1);
    expect(c!.x + c!.width).toBeLessThanOrEqual(360);
  }
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await capturar(pagina, "arrastrar-paradas", "scroll-antes");
  const y0 = await pagina.evaluate(() => window.scrollY);
  // Gesto táctil real del navegador (no window.scrollBy): es el que un sensor mal ajustado se llevaría.
  const cdp = await contexto.newCDPSession(pagina);
  const centro = await tarjeta.boundingBox();
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(centro!.x + centro!.width / 2),
    y: Math.round(centro!.y + centro!.height / 2),
    yDistance: -250,
    gestureSourceType: "touch",
    speed: 600,
  });
  await expect.poll(() => pagina.evaluate(() => window.scrollY)).toBeGreaterThan(y0);
  expect(await ordenPintado(pagina)).toEqual(antes);
  await capturar(pagina, "arrastrar-paradas", "scroll-despues");
  expect(posts).toHaveLength(0);
  expect((await ultimaVersionDelDia(supabase, planId)).version).toBe(1);
  await contexto.close();
});
