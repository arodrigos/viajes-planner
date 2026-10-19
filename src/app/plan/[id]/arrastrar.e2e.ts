import { expect, test } from "@playwright/test";
import { capturar } from "@/test-utils/capturas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { NOMBRES, abrirPlan, ordenPintado, parada, sembrarDia, ultimaVersionDelDia } from "./orden-e2e";

// arr-ac1: arrastrar con el ratón en escritorio, contra la API real.
test.use({ viewport: { width: 1180, height: 820 } });

const asa = (n: string) => `Arrastrar para mover «${n}»`;

const cuatro = () => [
  parada("a", NOMBRES.a, "manana", 0),
  parada("b", NOMBRES.b, "manana", 1),
  parada("c", NOMBRES.c, "manana", 2),
  parada("d", NOMBRES.d, "manana", 3),
];

async function arrastrarAsa(pagina: import("@playwright/test").Page, desde: string, haciaTarjeta: string, soltar = true) {
  const origen = await pagina.getByRole("button", { name: asa(desde) }).boundingBox();
  const destino = await pagina.locator("li.tarjeta-parada", { has: pagina.getByRole("heading", { name: haciaTarjeta }) }).boundingBox();
  expect(origen).not.toBeNull();
  expect(destino).not.toBeNull();
  const cx = origen!.x + origen!.width / 2;
  const cy = origen!.y + origen!.height / 2;
  await pagina.mouse.move(cx, cy);
  await pagina.mouse.down();
  // El sensor se activa tras 5 px: primero un desplazamiento corto sobre el asa
  // y una pausa para que React pinte el arrastre; después, el recorrido al destino.
  await pagina.mouse.move(cx, cy + (destino!.y < cy ? -8 : 8), { steps: 3 });
  await pagina.locator("[data-dnd-dragging]").first().waitFor({ timeout: 5000 });
  await pagina.mouse.move(destino!.x + destino!.width / 2, destino!.y + 20, { steps: 20 });
  if (soltar) await pagina.mouse.up();
}

test("arrastrar el asa de la tercera parada al primer puesto la deja la primera y se guarda (arr-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-arrastrar@example.com";
  const planId = await sembrarDia(supabase, email, "arr1", cuatro());
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { viewport: { width: 1180, height: 820 } });

  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma", "Delta"]);
  const cajaAsa = await pagina.getByRole("button", { name: asa("Gamma") }).boundingBox();
  expect(cajaAsa!.width).toBeGreaterThanOrEqual(44);
  expect(cajaAsa!.height).toBeGreaterThanOrEqual(44);
  await capturar(pagina, "arrastrar-paradas", "antes");

  await arrastrarAsa(pagina, "Gamma", "Alfa", false);
  // Con el ratón aún pulsado: la tarjeta va elevada.
  await expect(pagina.locator("li.tarjeta-parada[data-arrastrando='true']")).toHaveCount(1);
  await capturar(pagina, "arrastrar-paradas", "durante");
  await pagina.mouse.up();

  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Deshacer" })).toBeVisible();
  await expect.poll(() => ordenPintado(pagina)).toEqual(["Gamma", "Alfa", "Beta", "Delta"]);
  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.version).toBe(2);
  expect(guardada.paradas.map((p) => p.id_externo)).toEqual(["c", "a", "b", "d"]);
  await capturar(pagina, "arrastrar-paradas", "despues");

  // Las tarjetas con asa y botones a 1180x820 y a 820x1180 (arr-ac4).
  await capturar(pagina, "arrastrar-paradas", "tarjeta-1180");
  await pagina.setViewportSize({ width: 820, height: 1180 });
  await capturar(pagina, "arrastrar-paradas", "tarjeta-820");
  await contexto.close();
});

test("soltar fuera de la lista no cambia el orden ni hace peticiones (arr-ac1, límite)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-arrastrar-fuera@example.com";
  const planId = await sembrarDia(supabase, email, "arr1f", cuatro());
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { viewport: { width: 1180, height: 820 } });
  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/orden")) posts.push(r.url());
  });

  const origen = await pagina.getByRole("button", { name: asa("Gamma") }).boundingBox();
  await pagina.mouse.move(origen!.x + origen!.width / 2, origen!.y + origen!.height / 2);
  await pagina.mouse.down();
  // Escape cancela el arrastre en curso: es el «fuera» determinista de la lista.
  await pagina.mouse.move(origen!.x + origen!.width / 2, origen!.y + 80, { steps: 5 });
  await expect(pagina.locator("li.tarjeta-parada[data-arrastrando='true']")).toHaveCount(1);
  await pagina.keyboard.press("Escape");
  await pagina.mouse.up();

  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma", "Delta"]);
  await expect(pagina.getByText("Orden guardado")).toHaveCount(0);
  expect(posts).toHaveLength(0);
  expect((await ultimaVersionDelDia(supabase, planId)).version).toBe(1);
  await contexto.close();
});

test("soltar en otra franja le da esa franja a la parada (opción A)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-arrastrar-franja@example.com";
  const planId = await sembrarDia(supabase, email, "arr1x", [
    parada("a", NOMBRES.a, "manana", 0),
    parada("b", NOMBRES.b, "manana", 1),
    parada("c", NOMBRES.c, "comida", 2),
    parada("d", NOMBRES.d, "comida", 3),
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { viewport: { width: 1180, height: 820 } });

  await arrastrarAsa(pagina, "Gamma", "Alfa");
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.paradas.map((p) => `${p.id_externo}:${p.franja_id}`)).toEqual(["c:manana", "a:manana", "b:manana", "d:comida"]);
  await contexto.close();
});

test("con el teclado: Espacio, flecha abajo y Espacio sobre el asa mueve la parada (arr-ac1, accesibilidad)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-arrastrar-teclado@example.com";
  const planId = await sembrarDia(supabase, email, "arr1k", cuatro());
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { viewport: { width: 1180, height: 820 } });

  await pagina.getByRole("button", { name: asa("Alfa") }).focus();
  await pagina.keyboard.press("Space");
  await pagina.keyboard.press("ArrowDown");
  await pagina.keyboard.press("Space");
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  expect((await ultimaVersionDelDia(supabase, planId)).paradas.map((p) => p.id_externo)).toEqual(["b", "a", "c", "d"]);
  await contexto.close();
});
