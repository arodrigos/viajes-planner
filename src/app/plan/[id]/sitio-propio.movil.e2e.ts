import { expect, test, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { capturar } from "@/test-utils/capturas";
import { FRANJAS, iniciarSesion, parada, sembrarPlanDeUsuario } from "./orden-e2e";

// spu-ac1..ac6: añadir, resolver, corregir y quitar un sitio propio contra la
// API real. El plan tiene dos días y el sitio se añade en el segundo.
test.use({ viewport: { width: 360, height: 640 } });
test.describe.configure({ mode: "serial" });

const TAMANOS = [
  [360, 640],
  [820, 1180],
  [1180, 820],
] as const;
const AHORA = "2026-10-20T00:00:00.000Z";

// Una captura por tamaño de pantalla; deja la ventana como estaba.
async function capturarTres(pagina: Page, nombre: string) {
  const inicial = pagina.viewportSize()!;
  for (const [ancho, alto] of TAMANOS) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturar(pagina, "sitio-propio-ui", `${nombre}-${ancho}`);
  }
  await pagina.setViewportSize(inicial);
}

const propia = (id: string, nombre: string, extra: Partial<Parada> = {}): Parada => ({
  ...parada(id, nombre, "tarde", 3),
  descripcion: "",
  coordenadas: undefined,
  propia: true,
  ...extra,
});

async function sembrar(supabase: SupabaseClient, email: string, sufijo: string, extras: Parada[] = []) {
  const planId = `plan-sitio-${sufijo}-${Date.now()}`;
  const plan: Plan = {
    id: planId,
    version: 3,
    destino: "Granada",
    personas: 2,
    dias: [
      { fecha: "2027-06-09", franjas: FRANJAS, paradas: [parada("d1a", "Alhambra", "manana", 0)] },
      { fecha: "2027-06-10", franjas: FRANJAS, paradas: [parada("d2a", "Mirador", "manana", 1), parada("d2b", "Tapas", "comida", 2), parada("d2c", "Paseo", "tarde", 4), ...extras] },
    ],
  };
  await sembrarPlanDeUsuario(supabase, email, plan);
  return planId;
}

async function abrirDia2(browser: Browser, email: string, planId: string) {
  const contexto = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const pagina = await contexto.newPage();
  const dialogos: string[] = [];
  pagina.on("dialog", (d) => {
    dialogos.push(d.message());
    void d.dismiss();
  });
  await iniciarSesion(contexto, email);
  await pagina.clock.install({ time: new Date(AHORA) });
  await pagina.goto(`/plan/${planId}?dia=2`);
  await expect(pagina.getByRole("heading", { level: 2, name: /Día 2/ })).toBeVisible();
  return { contexto, pagina, dialogos };
}

async function versionActual(supabase: SupabaseClient, planId: string): Promise<number> {
  const { data } = await supabase.from("plan_versiones").select("version").eq("plan_id", planId).order("version", { ascending: false }).limit(1).single();
  return data!.version as number;
}

// Del clic al primer cambio del DOM, medido dentro de la página.
async function medirLatencia(pagina: Page, accion: () => Promise<void>): Promise<number> {
  await pagina.evaluate(() => {
    const w = window as unknown as { __latencia?: number };
    w.__latencia = undefined;
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
  await accion();
  return pagina.evaluate(() => (window as unknown as { __latencia?: number }).__latencia ?? Infinity);
}

const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { has: pagina.getByRole("heading", { level: 4, name: nombre }) });

test("añadir un sitio: aparece al momento con su nota, sobrevive a recargar y valida el nombre (spu-ac1, spu-ac6)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-sitio-anadir@example.com";
  const planId = await sembrar(supabase, email, "anadir");
  const { contexto, pagina } = await abrirDia2(browser, email, planId);

  await pagina.getByRole("button", { name: "Añadir un sitio" }).click();
  await expect(pagina.getByText("Escribe el nombre como sale en el mapa, por ejemplo «Heladería Fassi»")).toBeVisible();
  await expect(pagina.getByText("La verán también quienes tengan acceso a este plan")).toBeVisible();
  await capturarTres(pagina, "formulario");

  // spu-ac6: nombre vacío.
  await pagina.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(pagina.getByRole("alert").filter({ hasText: "Escribe el nombre del sitio, por ejemplo «Heladería Fassi»" })).toBeVisible();

  await pagina.getByLabel("Nombre del sitio").fill("Heladería Fassi");
  await pagina.getByLabel("Nota (opcional)").fill("ir a merendar");
  await expect(pagina.getByTestId("contador-nota")).toHaveText("13/200");
  const latencia = await medirLatencia(pagina, () => pagina.getByRole("button", { name: "Añadir", exact: true }).click());
  expect(latencia).toBeLessThan(200);

  const nueva = tarjeta(pagina, "Heladería Fassi");
  await expect(nueva).toContainText("ir a merendar");
  await expect(nueva).toContainText("Buscando… suele tardar unos minutos");
  await expect(pagina.getByTestId("aviso-sitio")).toContainText("Sitio añadido");
  await expect(pagina.getByRole("button", { name: "Deshacer" })).toBeVisible();
  // Es la cuarta tarjeta del día.
  await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(4);
  await capturarTres(pagina, "buscando");

  await expect.poll(() => versionActual(supabase, planId)).toBe(4);
  await pagina.reload();
  const tras = tarjeta(pagina, "Heladería Fassi");
  await expect(tras).toContainText("ir a merendar");
  await expect(tras).toContainText("Buscando…");
  await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(4);
  expect(((await (await pagina.request.get(`/api/plan/${planId}`)).json()) as { version: number }).version).toBe(4);
  await comprobarAccesibilidad(pagina);
  await capturarTres(pagina, "tras-recarga");
  await contexto.close();
});

test("un sitio resuelto enseña su marcador numerado y ya no dice «Buscando…» (spu-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-sitio-resuelto@example.com";
  const resuelto = propia("s1", "Heladería Fassi", {
    nota: "ir a merendar",
    coordenadas: { lat: 37.1735, lon: -3.5995 },
    resolucion: { estado: "resuelta", intentado_en: "2026-10-19T10:00:00.000Z" },
  });
  const planId = await sembrar(supabase, email, "resuelto", [resuelto]);
  const { contexto, pagina } = await abrirDia2(browser, email, planId);

  const fassi = tarjeta(pagina, "Heladería Fassi");
  await expect(fassi).toContainText("ir a merendar");
  await expect(fassi).not.toContainText("Buscando…");
  // Sin foto sembrada, el hueco de fotos-sin-datos.
  await expect(fassi.getByText("Sin foto")).toBeVisible();
  const marcador = pagina.locator('.marcador-parada[data-orden="4"]');
  await expect(marcador).toHaveCount(1);
  await capturarTres(pagina, "resuelto");
  await contexto.close();
});

test("un sitio no encontrado se corrige al momento y crea versión (spu-ac3)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-sitio-corregir@example.com";
  const inventado = propia("s1", "Zzqx Sitio Inventado", { resolucion: { estado: "no-resuelta", intentado_en: "2026-10-19T10:00:00.000Z", categoria_motivo: "sin-candidatos" } });
  const planId = await sembrar(supabase, email, "corregir", [inventado]);
  const { contexto, pagina } = await abrirDia2(browser, email, planId);

  const fila = tarjeta(pagina, "Zzqx Sitio Inventado");
  await expect(fila).toContainText("No hemos encontrado «Zzqx Sitio Inventado» en el mapa de Granada. Revisa cómo se escribe.");
  await capturarTres(pagina, "no-encontrado");

  await fila.getByRole("button", { name: "Corregir nombre" }).click();
  await fila.getByLabel("Nombre del sitio").fill("Heladería Fassi");
  const latencia = await medirLatencia(pagina, () => fila.getByRole("button", { name: "Guardar" }).click());
  expect(latencia).toBeLessThan(200);
  const corregida = tarjeta(pagina, "Heladería Fassi");
  await expect(corregida).toContainText("Buscando…");
  await expect(corregida).not.toContainText("No hemos encontrado");
  await capturarTres(pagina, "corregido");

  await expect.poll(() => versionActual(supabase, planId)).toBe(4);
  await contexto.close();
});

test("Deshacer y «Quitar este sitio» (con confirmación) dejan el día como estaba (spu-ac4)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-sitio-quitar@example.com";
  const planId = await sembrar(supabase, email, "quitar", [propia("s1", "Bar Pendiente")]);
  const { contexto, pagina } = await abrirDia2(browser, email, planId);
  await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(4);

  // Deshacer el alta recién hecha.
  await pagina.getByRole("button", { name: "Añadir un sitio" }).click();
  await pagina.getByLabel("Nombre del sitio").fill("Heladería Fassi");
  await pagina.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(tarjeta(pagina, "Heladería Fassi")).toBeVisible();
  await capturarTres(pagina, "deshacer");
  await pagina.getByRole("button", { name: "Deshacer" }).click();
  await expect(tarjeta(pagina, "Heladería Fassi")).toHaveCount(0);
  await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(4);
  await expect.poll(() => versionActual(supabase, planId)).toBe(5);

  // Quitar un sitio ya guardado: pide confirmación y no usa diálogos del navegador.
  const pendiente = tarjeta(pagina, "Bar Pendiente");
  await pendiente.getByRole("button", { name: "Quitar este sitio" }).click();
  await expect(pendiente.getByText("¿Quitar este sitio del plan?")).toBeVisible();
  await pendiente.getByRole("button", { name: "No" }).click();
  await expect(pendiente).toBeVisible();
  await pendiente.getByRole("button", { name: "Quitar este sitio" }).click();
  await pendiente.getByRole("button", { name: "Sí, quitar" }).click();
  await expect(tarjeta(pagina, "Bar Pendiente")).toHaveCount(0);
  await expect.poll(() => versionActual(supabase, planId)).toBe(6);
  await pagina.reload();
  await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(3);
  await contexto.close();
});

test("una nota con HTML se ve como texto literal y no ejecuta nada (spu-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-sitio-xss@example.com";
  const nota = "<img src=x onerror=alert(1)>";
  const planId = await sembrar(supabase, email, "xss", [propia("s1", "Bar Peligro", { nota })]);
  const { contexto, pagina, dialogos } = await abrirDia2(browser, email, planId);

  const fila = tarjeta(pagina, "Bar Peligro");
  await expect(fila.getByTestId("nota-sitio")).toHaveText(nota);
  expect(await fila.locator("img[src='x']").count()).toBe(0);

  await pagina.getByRole("button", { name: "Añadir un sitio" }).click();
  await pagina.getByLabel("Nombre del sitio").fill("Otro Bar");
  await pagina.getByLabel("Nota (opcional)").fill(nota);
  await pagina.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(tarjeta(pagina, "Otro Bar").getByTestId("nota-sitio")).toHaveText(nota);
  await expect.poll(() => versionActual(supabase, planId)).toBe(4);
  await pagina.reload();
  await expect(tarjeta(pagina, "Otro Bar").getByTestId("nota-sitio")).toHaveText(nota);
  expect(dialogos).toEqual([]);
  await contexto.close();
});
