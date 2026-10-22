import { expect, test } from "@playwright/test";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { capturar } from "@/test-utils/capturas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { NOMBRES, abrirPlan, iniciarSesion, ordenPintado, parada, sembrarDia, ultimaVersionDelDia } from "./orden-e2e";

// reo-ac1..ac4 y ac7: reordenar un día con los botones, contra la API real.
test.use({ viewport: { width: 390, height: 844 } });

const bajar = (n: string) => `Bajar «${n}»`;
const subir = (n: string) => `Subir «${n}»`;

const tres = () => [
  parada("a", NOMBRES.a, "manana", 0),
  parada("b", NOMBRES.b, "manana", 1),
  parada("c", NOMBRES.c, "comida", 2),
];

test("bajar una parada la mueve al instante, se guarda con Deshacer y sobrevive a recargar (reo-ac1, reo-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia1@example.com";
  const planId = await sembrarDia(supabase, email, "ac1", tres());
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  await expect(pagina.getByText("Cambia el orden con ↑ ↓. Se guarda solo y puedes deshacerlo.")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma"]);
  await expect(pagina.getByRole("button", { name: subir("Alfa") })).toBeDisabled();
  await capturar(pagina, "reordenar-dia", "antes");

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
  await pagina.getByRole("button", { name: bajar("Alfa") }).click();
  expect(await ordenPintado(pagina)).toEqual(["Beta", "Alfa", "Gamma"]);
  const latencia = await pagina.evaluate(() => (window as unknown as { __latencia?: number }).__latencia);
  expect(latencia).toBeLessThan(200);
  await expect(pagina.getByTestId("numero-parada").first()).toHaveText("1");
  await capturar(pagina, "reordenar-dia", "tras-bajar");

  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Deshacer" })).toBeVisible();
  // toBeVisible no mira el viewport: el aviso tiene que quedar dentro de lo que se ve, sin hacer scroll.
  const caja = await pagina.getByText("Orden guardado").boundingBox();
  const alto = pagina.viewportSize()?.height ?? 0;
  expect(caja).not.toBeNull();
  expect(caja!.y).toBeGreaterThanOrEqual(0);
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(alto);
  await capturar(pagina, "reordenar-dia", "guardado");
  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.version).toBe(2);
  expect(guardada.paradas.map((p) => p.id_externo)).toEqual(["b", "a", "c"]);
  // El primer conector sale de la nueva primera parada: su texto menciona el destino de ese tramo.
  expect(await pagina.getByTestId("tramo-parada").count()).toBeGreaterThan(0);

  await pagina.reload();
  expect(await ordenPintado(pagina)).toEqual(["Beta", "Alfa", "Gamma"]);
  await capturar(pagina, "reordenar-dia", "recargado");

  // Deshacer: otra versión con el orden de antes.
  await pagina.getByRole("button", { name: bajar("Beta") }).click();
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  await pagina.getByRole("button", { name: "Deshacer" }).click();
  await expect(pagina.getByText("Orden restaurado")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(["Beta", "Alfa", "Gamma"]);
  const tras = await ultimaVersionDelDia(supabase, planId);
  expect(tras.version).toBe(4);
  expect(tras.paradas.map((p) => p.id_externo)).toEqual(["b", "a", "c"]);
  await capturar(pagina, "reordenar-dia", "deshecho");
  await comprobarAccesibilidad(pagina);
  await contexto.close();
});

test("una ráfaga de pulsaciones es un solo POST y una sola versión (reo-ac3)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia3@example.com";
  const planId = await sembrarDia(supabase, email, "ac3", [
    parada("a", NOMBRES.a, "manana", 0),
    parada("b", NOMBRES.b, "manana", 1),
    parada("c", NOMBRES.c, "manana", 2),
    parada("d", NOMBRES.d, "manana", 3),
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);
  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/orden")) posts.push(r.postData() ?? "");
  });

  await pagina.getByRole("button", { name: bajar("Alfa") }).click();
  await pagina.getByRole("button", { name: bajar("Alfa") }).click();
  await pagina.getByRole("button", { name: bajar("Alfa") }).click();
  expect(await ordenPintado(pagina)).toEqual(["Beta", "Gamma", "Delta", "Alfa"]);
  await expect(pagina.getByText("Orden guardado")).toBeVisible();

  expect(posts).toHaveLength(1);
  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.version).toBe(2);
  expect(guardada.paradas.map((p) => p.id_externo)).toEqual(["b", "c", "d", "a"]);
  await contexto.close();
});

test("subir la primera de la comida la pasa a la mañana (reo-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia4@example.com";
  const planId = await sembrarDia(supabase, email, "ac4", tres());
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  await capturar(pagina, "reordenar-dia", "cruzar-antes");
  await pagina.getByRole("button", { name: subir("Gamma") }).click();
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma"]);
  const guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.paradas.map((p) => `${p.id_externo}:${p.franja_id}`)).toEqual(["a:manana", "b:manana", "c:manana"]);
  await capturar(pagina, "reordenar-dia", "cruzar-despues");
  await contexto.close();
});

test("cruzar con una franja vacía en medio va a la última visible y Bajar la devuelve (reo-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia4b@example.com";
  // Sin nadie en la comida: la tarde no es contigua a la mañana.
  const planId = await sembrarDia(supabase, email, "ac4b", [
    parada("a", NOMBRES.a, "manana", 0),
    parada("b", NOMBRES.b, "tarde", 1),
    parada("c", NOMBRES.c, "tarde", 2),
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  await pagina.getByRole("button", { name: subir("Beta") }).click();
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  let guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.paradas.map((p) => `${p.id_externo}:${p.franja_id}`)).toEqual(["a:manana", "b:manana", "c:tarde"]);
  await capturar(pagina, "reordenar-dia", "cruzar-franja-vacia");
  // Extremos del día: no hay vecina y la parada no salta a una franja vacía.
  await expect(pagina.getByRole("button", { name: subir("Alfa") })).toBeDisabled();
  await expect(pagina.getByRole("button", { name: bajar("Gamma") })).toBeDisabled();

  // Beta sigue teniendo vecina debajo, así que Bajar la devuelve a la tarde.
  await expect(pagina.getByRole("button", { name: bajar("Beta") })).toBeEnabled();
  await pagina.getByRole("button", { name: bajar("Beta") }).click();
  await expect.poll(async () => (await ultimaVersionDelDia(supabase, planId)).version).toBe(3);
  guardada = await ultimaVersionDelDia(supabase, planId);
  expect(guardada.paradas.map((p) => `${p.id_externo}:${p.franja_id}`)).toEqual(["a:manana", "b:tarde", "c:tarde"]);
  await contexto.close();
});

test("sin conexión avisa y Reintentar guarda; una versión nueva en otra pantalla da el aviso de 409 (reo-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia7@example.com";
  const planId = await sembrarDia(supabase, email, "ac7", tres());
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  // Botones táctiles de 44×44 como mínimo.
  for (const nombre of [bajar("Alfa"), subir("Beta")]) {
    const caja = await pagina.getByRole("button", { name: nombre }).boundingBox();
    expect(caja!.width).toBeGreaterThanOrEqual(44);
    expect(caja!.height).toBeGreaterThanOrEqual(44);
  }

  await contexto.setOffline(true);
  await pagina.getByRole("button", { name: bajar("Alfa") }).click();
  await expect(pagina.getByText("No se ha podido guardar el nuevo orden. Comprueba la conexión y vuelve a intentarlo.")).toBeVisible();
  // El orden vuelve al guardado: no se promete lo que no está en el servidor.
  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma"]);
  const cajaError = await pagina.getByText("No se ha podido guardar el nuevo orden", { exact: false }).boundingBox();
  const altoError = pagina.viewportSize()?.height ?? 0;
  expect(cajaError!.y).toBeGreaterThanOrEqual(0);
  expect(cajaError!.y + cajaError!.height).toBeLessThanOrEqual(altoError);
  await capturar(pagina, "reordenar-dia", "error-red");
  await comprobarAccesibilidad(pagina);

  await contexto.setOffline(false);
  await pagina.getByRole("button", { name: "Reintentar" }).click();
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  expect((await ultimaVersionDelDia(supabase, planId)).version).toBe(2);

  // Otra pantalla guarda antes: la versión base de esta ya no es la última.
  const { error } = await supabase.rpc("reordenar_dia_plan", {
    p_plan_id: planId,
    p_version_base: 2,
    p_dia_index: 0,
    p_orden: [
      { id: "a", franja_id: "manana" },
      { id: "b", franja_id: "manana" },
      { id: "c", franja_id: "comida" },
    ],
  });
  expect(error).toBeNull();
  await pagina.getByRole("button", { name: bajar("Gamma") }).waitFor();
  await pagina.getByRole("button", { name: bajar("Beta") }).click();
  await expect(pagina.getByText("El plan se acaba de actualizar mientras guardabas.", { exact: false })).toBeVisible();
  // Primero llega el 409 y luego la lectura del plan más reciente.
  await expect.poll(() => ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma"]);
  await contexto.close();
});

test("un día con una sola parada no tiene controles de orden (reo-ac7)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-dia7b@example.com";
  const planId = await sembrarDia(supabase, email, "una", [parada("a", NOMBRES.a, "manana", 0)]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId);

  await expect(pagina.getByRole("heading", { name: "Alfa" })).toBeVisible();
  await expect(pagina.getByRole("button", { name: /^(Subir|Bajar) «/ })).toHaveCount(0);
  await expect(pagina.getByText("Cambia el orden con")).toHaveCount(0);
  await capturar(pagina, "reordenar-dia", "una-parada");
  await contexto.close();
});

test.describe("copia sin conexión (reo-ac9)", () => {
  test.use({ serviceWorkers: "allow" });

  test("la copia guardada tiene el orden nuevo y no ofrece controles", async ({ browser }) => {
    test.setTimeout(120_000);
    const supabase = clienteDePrueba("servicio");
    const email = "ci-test-orden-dia9@example.com";
    const planId = await sembrarDia(supabase, email, "ac9", tres());
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pagina = await contexto.newPage();
    await iniciarSesion(contexto, email);
    await pagina.goto(`/plan/${planId}?dia=1`);
    await pagina.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((r) => navigator.serviceWorker.addEventListener("controllerchange", () => r(), { once: true }));
    });

    await pagina.getByRole("button", { name: bajar("Alfa") }).click();
    await expect(pagina.getByText("Orden guardado")).toBeVisible();

    // La copia se refresca con un GET tras guardar: se espera a que la caché ya tenga la versión 2.
    await expect
      .poll(() =>
        pagina.evaluate(async (id) => {
          const respuesta = await (await caches.open("viajes-datos")).match(`/api/plan/${id}`);
          return respuesta ? ((await respuesta.json()) as { version: number }).version : 0;
        }, planId),
      )
      .toBe(2);

    await contexto.setOffline(true);
    await pagina.reload();
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${planId}`));
    await expect(pagina.getByRole("heading", { name: "Alfa" }).first()).toBeVisible();
    expect(await pagina.locator("h4").allInnerTexts()).toEqual(expect.arrayContaining(["Beta", "Alfa", "Gamma"]));
    const nombres = await pagina.locator("li.tarjeta-parada h4").allInnerTexts();
    expect(nombres).toEqual(["Beta", "Alfa", "Gamma"]);
    await expect(pagina.getByRole("button", { name: /^(Subir|Bajar) «/ })).toHaveCount(0);
    await expect(pagina.getByText("Cambia el orden con")).toHaveCount(0);
    await capturar(pagina, "reordenar-dia", "sin-conexion");
    await contexto.setOffline(false);
    await contexto.close();
  });
});
