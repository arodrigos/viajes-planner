import { expect, test } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Parada } from "@/lib/plan/tipos";
import { FACTOR_CALLE } from "@/lib/plan/tramos";
import { capturar } from "@/test-utils/capturas";
import { abrirPlan, ordenPintado, parada, sembrarDia, ultimaVersionDelDia } from "./orden-e2e";

// opt-ac1..ac7: «Optimizar orden» contra la API real. El alojamiento es el
// inicio del recorrido; las paradas están sobre un meridiano, a ~0,9 km una de otra.
test.use({ viewport: { width: 390, height: 844 } });

const ALOJAMIENTO = { lat: 37.17, lon: -3.59 };
const ANCLA = { tipo: "zona-propuesta" as const, centroide: ALOJAMIENTO, radio_m: 500 };
const sitio = (n: number, franja = "manana", id = `s${n}`): Parada => ({ ...parada(id, `Sitio ${n}`, franja, n), descripcion: "Visita de prueba" });
const sinUbicar = (id: string, nombre: string, franja = "manana"): Parada => ({ ...parada(id, nombre, franja, 0), coordenadas: undefined });
const OPTIMIZAR = { name: "Optimizar orden" };

function kmDe(orden: number[]): number {
  let total = 0;
  let previo = ALOJAMIENTO;
  for (const n of orden) {
    const punto = { lat: 37.17 + n * 0.008, lon: -3.59 };
    total += (distanciaMetros(previo, punto) * FACTOR_CALLE) / 1000;
    previo = punto;
  }
  return total;
}
const coma = (km: number) => km.toFixed(1).replace(".", ",");
const nombres = (...ns: number[]) => ns.map((n) => `Sitio ${n}`);

async function versiones(supabase: ReturnType<typeof clienteDePrueba>, planId: string): Promise<number> {
  const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  return count ?? 0;
}

test("optimizar un zigzag lo ordena al momento, guarda una versión y se puede deshacer (opt-ac1, opt-ac3, opt-ac6)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-optimizar@example.com";
  const planId = await sembrarDia(supabase, email, "zigzag", [1, 5, 2, 4, 3].map((n) => sitio(n)), "2027-06-09", ANCLA);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  expect(await ordenPintado(pagina)).toEqual(nombres(1, 5, 2, 4, 3));
  await expect(pagina.getByRole("button", OPTIMIZAR)).toBeEnabled();
  await capturar(pagina, "optimizar-orden", "antes");

  // Latencia: del clic al primer cambio del DOM, medida dentro de la página.
  await pagina.evaluate(() => {
    const w = window as unknown as { __latencia?: number };
    document.addEventListener(
      "click",
      () => {
        const t0 = performance.now();
        const observador = new MutationObserver(() => {
          w.__latencia = performance.now() - t0;
          observador.disconnect();
        });
        observador.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      },
      { capture: true, once: true },
    );
  });
  await pagina.getByRole("button", OPTIMIZAR).click();
  expect(await ordenPintado(pagina)).toEqual(nombres(1, 2, 3, 4, 5));
  expect(await pagina.evaluate(() => (window as unknown as { __latencia?: number }).__latencia)).toBeLessThan(200);

  const menos = coma(kmDe([1, 5, 2, 4, 3]) - kmDe([1, 2, 3, 4, 5]));
  await expect(pagina.getByText(`Recorrido más corto: ${menos} km menos (estimación en línea recta)`)).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Deshacer" })).toBeVisible();
  const caja = await pagina.getByText("Recorrido más corto", { exact: false }).boundingBox();
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(pagina.viewportSize()!.height);
  await capturar(pagina, "optimizar-orden", "despues");
  for (const [ancho, alto] of [[360, 640], [820, 1180], [1180, 820]]) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    await expect(pagina.getByText("Recorrido más corto", { exact: false })).toBeVisible();
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturar(pagina, "optimizar-orden", `despues-${ancho}x${alto}`);
  }
  await pagina.setViewportSize({ width: 390, height: 844 });

  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.version).toBe(2);
  expect(guardada.paradas.map((p) => p.id_externo)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  // Tramos y horas salen del plan que devolvió el guardado, en el orden nuevo.
  expect(await pagina.getByTestId("tramo-parada").count()).toBe(4);
  await comprobarAccesibilidad(pagina);

  // Deshacer: otra versión con el orden de antes.
  await pagina.getByRole("button", { name: "Deshacer" }).click();
  await expect(pagina.getByText("Orden restaurado")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(nombres(1, 5, 2, 4, 3));
  const tras = await ultimaVersionDelDia(supabase, planId);
  expect(tras.version).toBe(3);
  expect(tras.paradas.map((p) => p.id_externo)).toEqual(["s1", "s5", "s2", "s4", "s3"]);
  await capturar(pagina, "optimizar-orden", "deshecho");

  // Optimizar otra vez propone de nuevo el orden corto.
  await pagina.getByRole("button", OPTIMIZAR).click();
  expect(await ordenPintado(pagina)).toEqual(nombres(1, 2, 3, 4, 5));
  await contexto.close();
});

test("un día que ya va en el orden más corto no cambia ni crea versión (opt-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-optimizar-ya@example.com";
  const planId = await sembrarDia(supabase, email, "ya", [1, 2, 3, 4].map((n) => sitio(n)), "2027-06-09", ANCLA);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/orden")) posts.push(r.url());
  });
  await pagina.getByRole("button", OPTIMIZAR).click();
  await expect(pagina.getByText("Este día ya va en el orden más corto")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(nombres(1, 2, 3, 4));
  await expect(pagina.getByRole("button", { name: "Deshacer" })).toHaveCount(0);
  await capturar(pagina, "optimizar-orden", "ya-optimo");
  // Margen para que una petición mal lanzada llegara a verse.
  await pagina.waitForTimeout(1500);
  expect(posts).toHaveLength(0);
  expect(await versiones(supabase, planId)).toBe(1);
  await contexto.close();
});

test("con menos de 3 o más de 9 sitios ubicados el botón está desactivado y lo explica (opt-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-optimizar-limites@example.com";
  const pocas = await sembrarDia(supabase, email, "pocas", [sitio(1), sitio(2), sinUbicar("x", "Sin ubicar")], "2027-06-09", ANCLA);
  const muchas = await sembrarDia(supabase, email, "muchas", Array.from({ length: 10 }, (_, i) => sitio(i + 1)), "2027-06-09", ANCLA);

  const a = await abrirPlan(browser, email, pocas);
  await expect(a.pagina.getByRole("button", OPTIMIZAR)).toBeDisabled();
  await expect(a.pagina.getByText("Para optimizar hacen falta al menos 3 sitios ubicados en el día")).toBeVisible();
  await expect(a.pagina.getByRole("button", OPTIMIZAR)).toHaveAccessibleDescription("Para optimizar hacen falta al menos 3 sitios ubicados en el día");
  await capturar(a.pagina, "optimizar-orden", "pocas");
  await a.contexto.close();

  const b = await abrirPlan(browser, email, muchas);
  await expect(b.pagina.getByRole("button", OPTIMIZAR)).toBeDisabled();
  await expect(b.pagina.getByText("Optimizar admite hasta 9 sitios ubicados por día")).toBeVisible();
  await capturar(b.pagina, "optimizar-orden", "muchas");
  await b.contexto.close();
});

test("optimizar respeta las franjas: la comida sigue en la comida (opt-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-optimizar-franjas@example.com";
  // R1 es lo más cercano al alojamiento; M3 va desviada al este para que el óptimo no sea una simetría.
  const m3: Parada = { ...parada("m3", "M3", "manana", 5), coordenadas: { lat: 37.17 + 5 * 0.008, lon: -3.57 } };
  const planId = await sembrarDia(
    supabase,
    email,
    "franjas",
    [parada("m1", "M1", "manana", 4), parada("m2", "M2", "manana", 6), m3, { ...parada("r1", "R1", "comida", 0), coordenadas: { lat: 37.1716, lon: -3.59 } }, parada("t1", "T1", "tarde", 3), parada("t2", "T2", "tarde", 1), parada("t3", "T3", "tarde", 2)],
    "2027-06-09",
    ANCLA,
  );
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  const porFranja = async () => {
    const grupos: Record<string, string[]> = {};
    for (const seccion of await pagina.locator(".seccion-franja").all()) {
      const titulo = (await seccion.locator("h3").innerText()).trim();
      grupos[titulo] = await seccion.locator("li:has([data-testid='numero-parada']) h4").allInnerTexts();
    }
    return grupos;
  };
  const antes = await porFranja();
  const titulos = Object.keys(antes);
  expect(titulos).toHaveLength(3);
  await capturar(pagina, "optimizar-orden", "franjas-antes");

  await pagina.getByRole("button", OPTIMIZAR).click();
  await expect(pagina.getByText("Recorrido más corto", { exact: false })).toBeVisible();
  const despues = await porFranja();
  expect(Object.keys(despues)).toEqual(titulos);
  expect(despues[titulos[0]]).toEqual(["M3", "M2", "M1"]);
  expect(despues[titulos[1]]).toEqual(["R1"]);
  expect(despues[titulos[2]]).toEqual(["T2", "T3", "T1"]);
  await capturar(pagina, "optimizar-orden", "franjas-despues");

  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.paradas.map((p) => `${p.id_externo}:${p.franja_id}`)).toEqual(["m3:manana", "m2:manana", "m1:manana", "r1:comida", "t2:tarde", "t3:tarde", "t1:tarde"]);
  await contexto.close();
});
