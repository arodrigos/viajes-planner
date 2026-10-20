import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Plan } from "@/lib/plan/tipos";
import { capturar } from "@/test-utils/capturas";
import { FRANJAS, iniciarSesion, parada } from "./orden-e2e";
import { sembrarPlan } from "./semillas-e2e";

// cmu-ac1..ac6: compartir de punta a punta con dos sesiones reales (dueño e
// invitado) contra la API, el service worker y las cachés del navegador.
test.use({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
test.describe.configure({ mode: "serial" });

const BLOQUE = "compartir-ui";
const DUENYO = "ci-test-cmu-duenyo@example.com";
const INVITADO = "ci-test-cmu-invitado@example.com";
const TAMANOS = [
  [360, 640],
  [820, 1180],
  [1180, 820],
] as const;

async function capturarTres(pagina: Page, nombre: string) {
  const inicial = pagina.viewportSize()!;
  for (const [ancho, alto] of TAMANOS) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturar(pagina, BLOQUE, `${nombre}-${ancho}`);
  }
  await pagina.setViewportSize(inicial);
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

async function esperarControlador(pagina: Page) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
}

async function claves(pagina: Page, cache: string): Promise<string[]> {
  return pagina.evaluate(async (nombre) => (await caches.has(nombre)) ? (await (await caches.open(nombre)).keys()).map((r) => r.url) : [], cache);
}

const tarjetas = (pagina: Page) => pagina.locator("li.tarjeta-parada");

test.describe("compartir un plan", () => {
  let supabase: SupabaseClient;
  let planId: string;
  let contextoDuenyo: BrowserContext;
  let contextoInvitado: BrowserContext;
  let paginaDuenyo: Page;
  let paginaInvitado: Page;

  test.beforeAll(async ({ browser }) => {
    supabase = clienteDePrueba("servicio");
    const { data: usuario, error } = await supabase.auth.admin.createUser({ email: DUENYO, email_confirm: true });
    let duenyoId = usuario?.user?.id;
    if (!duenyoId) {
      const { data: lista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      duenyoId = lista?.users.find((u) => u.email === DUENYO)?.id;
      if (!duenyoId) throw new Error(`No se pudo crear el dueño de prueba: ${error?.message}`);
    }
    planId = `plan-cmu-${Date.now()}`;
    const plan: Plan = {
      id: planId,
      version: 1,
      destino: "Granada",
      personas: 2,
      etapas: [{ ciudad: { estado: "resuelta", nombre: "Granada", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 2, dia_inicio: 0, alojamiento_noche_eur: 140, zona: 0, ajustes: [] }],
      dias: [
        {
          fecha: "2027-06-09",
          etapa: 0,
          ancla_alojamiento: { tipo: "usuario", direccion: "Calle Reservada 7" },
          franjas: FRANJAS,
          paradas: [{ ...parada("a", "Alhambra", "manana", 0), coste: { importe_eur: 12, por: "persona", procedencia: "estimado", fecha: "2026-10-01" } }, parada("b", "Mirador", "tarde", 1)],
        },
        {
          fecha: "2027-06-10",
          etapa: 0,
          franjas: FRANJAS,
          paradas: [parada("c", "Paseo", "manana", 2), { ...parada("propia-0001", "Heladería Fassi", "tarde", 3), descripcion: "", coordenadas: undefined, propia: true, nota: "ir a merendar" }],
        },
      ],
    };
    await sembrarPlan(supabase, plan);
    const { error: errorTrabajo } = await supabase
      .from("trabajos")
      .insert({ usuario_id: duenyoId, tipo: "generacion", criterios: { destino_o_tipo: "Granada", presupuesto_eur: 4000 }, estado: "completado", plan_id: planId });
    if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);

    contextoDuenyo = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
    contextoInvitado = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
    // Cada correo pide su código una sola vez: un segundo código al mismo correo
    // en seguida lo deja sin entregar (límite de envíos de Auth).
    await iniciarSesion(contextoDuenyo, DUENYO);
    await iniciarSesion(contextoInvitado, INVITADO);
    paginaDuenyo = await contextoDuenyo.newPage();
    paginaInvitado = await contextoInvitado.newPage();
  });

  test.afterAll(async () => {
    await contextoDuenyo?.close();
    await contextoInvitado?.close();
  });

  test("el dueño invita: errores junto al campo y, al acertar, el correo queda en «Con acceso» (cmu-ac1, cmu-ac5, cmu-ac6)", async () => {
    test.setTimeout(120_000);
    await paginaDuenyo.goto(`/plan/${planId}?dia=1`);
    await expect(paginaDuenyo.getByRole("heading", { level: 1, name: "Granada" })).toBeVisible();
    await paginaDuenyo.getByText("Compartir", { exact: true }).click();
    await expect(paginaDuenyo.getByText("Todavía no lo has compartido con nadie")).toBeVisible();
    await expect(paginaDuenyo.getByText("Solo correos que ya pueden entrar en viajes.", { exact: false })).toBeVisible();
    await comprobarAccesibilidad(paginaDuenyo);

    const campo = paginaDuenyo.getByLabel("Correo de la persona");
    const invitar = paginaDuenyo.getByRole("button", { name: "Invitar", exact: true });
    const errores: [string, string][] = [
      ["esto-no-es-un-correo", "Escribe un correo válido."],
      [DUENYO, "Ese es tu propio correo."],
      ["nadie@example.com", "Ese correo no puede entrar en viajes. Solo se puede compartir con correos que ya tienen acceso."],
    ];
    for (const [correo, mensaje] of errores) {
      await campo.fill(correo);
      await invitar.click();
      await expect(paginaDuenyo.getByRole("alert").filter({ hasText: mensaje })).toBeVisible();
      await expect(paginaDuenyo.getByText("Todavía no lo has compartido con nadie")).toBeVisible();
      if (correo === "nadie@example.com") await capturarTres(paginaDuenyo, "error-fuera-de-lista");
    }

    await campo.fill(INVITADO);
    const latencia = await medirLatencia(paginaDuenyo, () => invitar.click());
    expect(latencia).toBeLessThan(200);
    const lista = paginaDuenyo.getByRole("list", { name: "Con acceso" });
    await expect(lista.getByRole("listitem")).toHaveCount(1);
    await expect(lista).toContainText(INVITADO);
    await expect(lista.getByRole("button", { name: "Quitar acceso" })).toBeVisible();
    await expect(paginaDuenyo.getByText("Todavía no lo has compartido con nadie")).toHaveCount(0);
    // cmu-ac6: el correo lleva data-sensible, así que sale tapado en las capturas.
    await expect(lista.locator("[data-sensible]")).toHaveCount(1);
    await capturarTres(paginaDuenyo, "lista-acceso");

    const miembros = (await (await paginaDuenyo.request.get(`/api/plan/${planId}/miembros`)).json()) as { miembros: { correo: string }[] };
    expect(miembros.miembros.map((m) => m.correo)).toEqual([INVITADO]);
  });

  test("el invitado ve el plan en solo lectura, sin dinero ni alojamiento, y lo consulta sin conexión (cmu-ac2, cmu-ac3, cmu-ac6)", async () => {
    test.setTimeout(180_000);
    await paginaInvitado.goto("/viajes");
    const tarjetaViaje = paginaInvitado.locator("li.tarjeta-parada", { hasText: "Granada" });
    await expect(tarjetaViaje.getByText("Compartido contigo")).toBeVisible();
    await expect(tarjetaViaje.getByRole("button", { name: "Eliminar" })).toHaveCount(0);
    await capturarTres(paginaInvitado, "mis-viajes-invitado");

    await tarjetaViaje.getByRole("link", { name: /itinerario/i }).click();
    await expect(paginaInvitado).toHaveURL(new RegExp(`/plan/${planId}`));
    await expect(paginaInvitado.getByTestId("solo-lectura")).toHaveText("Compartido contigo · solo lectura");
    await paginaInvitado.goto(`/plan/${planId}?dia=2`);
    await expect(paginaInvitado.getByTestId("solo-lectura")).toBeVisible();
    await expect(tarjetas(paginaInvitado)).toHaveCount(2);
    await expect(paginaInvitado.getByTestId("nota-sitio")).toHaveText("ir a merendar");
    for (const nombre of [/Regenerar/, /Subir/, /Bajar/, /Optimizar orden/, /Añadir un sitio/, /Quitar este sitio/, /Corregir nombre/, /Alternativas/, /Google/, /Marcar/]) {
      await expect(paginaInvitado.getByRole("button", { name: nombre })).toHaveCount(0);
    }
    await expect(paginaInvitado.getByTestId("presupuesto-plan")).toHaveCount(0);
    await expect(paginaInvitado.getByText("Compartir", { exact: true })).toHaveCount(0);
    await expect(paginaInvitado.getByText("Calle Reservada 7")).toHaveCount(0);
    await comprobarAccesibilidad(paginaInvitado);
    await capturarTres(paginaInvitado, "plan-invitado");

    // Mismo número de tarjetas por día que el dueño.
    for (const dia of [1, 2]) {
      await paginaDuenyo.goto(`/plan/${planId}?dia=${dia}`);
      await paginaInvitado.goto(`/plan/${planId}?dia=${dia}`);
      await expect(tarjetas(paginaDuenyo).first()).toBeVisible();
      await expect(tarjetas(paginaInvitado).first()).toBeVisible();
      expect(await tarjetas(paginaInvitado).count()).toBe(await tarjetas(paginaDuenyo).count());
    }

    // El servidor, no la interfaz, quita el dinero.
    const duenyo = (await (await paginaDuenyo.request.get(`/api/plan/${planId}`)).json()) as Record<string, unknown>;
    const invitado = (await (await paginaInvitado.request.get(`/api/plan/${planId}`)).json()) as Record<string, unknown>;
    expect(duenyo).toHaveProperty("presupuesto");
    expect(invitado).not.toHaveProperty("presupuesto");
    expect(JSON.stringify(invitado)).not.toContain("Calle Reservada 7");

    // Offline: la copia se guarda al abrir con red y no lleva presupuesto.
    await esperarControlador(paginaInvitado);
    await paginaInvitado.goto(`/plan/${planId}?dia=2`);
    await expect.poll(async () => (await claves(paginaInvitado, "viajes-datos")).some((u) => u.endsWith(`/api/plan/${planId}`)), { timeout: 30_000 }).toBe(true);
    const guardado = await paginaInvitado.evaluate(async (id) => {
      const respuesta = await (await caches.open("viajes-datos")).match(`/api/plan/${id}`);
      return respuesta ? await respuesta.text() : "";
    }, planId);
    expect(guardado).toContain("Heladería Fassi");
    expect(guardado).not.toContain("presupuesto");
    // Un índice de mapa guardado, para comprobar en cmu-ac4 que se borra.
    await paginaInvitado.evaluate(async (id) => {
      await (await caches.open("viajes-mapa")).put(`https://tiles.openfreemap.org/__viajes/indice/${id}.json`, new Response("{}"));
    }, planId);

    await contextoInvitado.setOffline(true);
    try {
      await paginaInvitado.reload();
      await expect(paginaInvitado.getByRole("status").filter({ hasText: "Sin conexión" })).toContainText("Estás viendo la copia guardada");
      await expect(paginaInvitado.getByText("Heladería Fassi").first()).toBeVisible();
      await expect(paginaInvitado.getByTestId("solo-lectura")).toBeVisible();
      await capturarTres(paginaInvitado, "invitado-sin-red");
    } finally {
      await contextoInvitado.setOffline(false);
    }
  });

  test("el dueño quita el acceso y la copia del invitado se borra al volver a abrir con red (cmu-ac4)", async () => {
    test.setTimeout(120_000);
    await paginaDuenyo.goto(`/plan/${planId}?dia=1`);
    await paginaDuenyo.getByText("Compartir", { exact: true }).click();
    const lista = paginaDuenyo.getByRole("list", { name: "Con acceso" });
    await lista.getByRole("button", { name: "Quitar acceso", exact: true }).click();
    await lista.getByRole("button", { name: "Sí, quitar acceso" }).click();
    await expect(paginaDuenyo.getByText("Todavía no lo has compartido con nadie")).toBeVisible();
    await expect(paginaDuenyo.getByRole("list", { name: "Con acceso" })).toHaveCount(0);

    await paginaInvitado.goto(`/plan/${planId}?dia=2`);
    await expect(paginaInvitado.getByTestId("acceso-retirado")).toHaveText("Ya no tienes acceso a este plan. Quien lo creó ha dejado de compartirlo.");
    await expect(paginaInvitado.getByRole("link", { name: "Ir a Mis viajes" })).toHaveAttribute("href", "/viajes");
    await expect.poll(async () => (await claves(paginaInvitado, "viajes-datos")).some((u) => u.endsWith(`/api/plan/${planId}`))).toBe(false);
    expect((await claves(paginaInvitado, "viajes-mapa")).some((u) => u.includes(`/indice/${planId}.json`))).toBe(false);
    await capturarTres(paginaInvitado, "acceso-retirado");

    await paginaInvitado.getByRole("link", { name: "Ir a Mis viajes" }).click();
    await expect(paginaInvitado.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(paginaInvitado.getByText("Granada")).toHaveCount(0);
  });
});
