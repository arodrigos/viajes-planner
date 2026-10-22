import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { RUTA_SESION_INVITADO, planDePrueba, variable } from "@/verificacion/entorno";
import { hayInvitado } from "@/verificacion/login";
import { capturar } from "@/test-utils/capturas";

// inv-ac1, inv-ac2: «Compartir» de punta a punta en el preview, con el dueño y
// un segundo usuario real. Las aserciones son estructurales (el plan lo genera
// el trabajador y no es determinista). Ningún correo ni código sale en la
// salida: solo se usan para canjear y teclear, y las capturas pasan por
// capturar(), que tapa todo lo que lleve data-sensible o una @.
test.use({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
test.describe.configure({ mode: "serial" });
test.skip(!hayInvitado(), "falta el segundo usuario de pruebas");

const BLOQUE = "compartir-preview";
const PROHIBIDAS = ["presupuesto", "tu_presupuesto_eur", "alojamiento_noche_eur", "coste_eur", "ancla_alojamiento", "trabajoId", "regenerando", "google"];
const BOTONES_EDICION = [/Regenerar/, /Subir/, /Bajar/, /Optimizar orden/, /Añadir un sitio/, /Quitar este sitio/, /Corregir nombre/, /Alternativas/, /Google/, /Marcar/];

function clavesDe(valor: unknown, salida: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => clavesDe(v, salida));
  else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      salida.add(k);
      clavesDe(v, salida);
    }
  }
  return salida;
}

async function claves(pagina: Page, cache: string): Promise<string[]> {
  return pagina.evaluate(async (nombre) => ((await caches.has(nombre)) ? (await (await caches.open(nombre)).keys()).map((r) => r.url) : []), cache);
}

async function esperarControlador(pagina: Page) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
}

async function quitarTodos(peticiones: APIRequestContext, id: string) {
  const r = await peticiones.get(`/api/plan/${id}/miembros`);
  if (!r.ok()) return;
  for (const m of ((await r.json()) as { miembros: { id: string }[] }).miembros) await peticiones.delete(`/api/plan/${id}/miembros/${m.id}`);
}

async function contextoInvitado(browser: Browser, ancho: number, alto: number): Promise<BrowserContext> {
  // La sesión la dejó el global setup (código de un solo uso: no se canjea otra vez).
  return browser.newContext({ storageState: RUTA_SESION_INVITADO, viewport: { width: ancho, height: alto }, serviceWorkers: "allow" });
}

async function invitar(dueno: Page, id: string) {
  await dueno.goto(`/plan/${id}?dia=1`);
  await dueno.getByText("Compartir", { exact: true }).click();
  await dueno.getByLabel("Correo de la persona").fill(variable("CORREO_INVITADO"));
  await dueno.getByRole("button", { name: "Invitar", exact: true }).click();
  const lista = dueno.getByRole("list", { name: "Con acceso" });
  await expect(lista.getByRole("listitem")).toHaveCount(1);
  await expect(lista.getByRole("button", { name: "Quitar acceso" })).toBeVisible();
  return lista;
}

async function quitar(dueno: Page) {
  const lista = dueno.getByRole("list", { name: "Con acceso" });
  await lista.getByRole("button", { name: "Quitar acceso", exact: true }).click();
  await lista.getByRole("button", { name: "Sí, quitar acceso" }).click();
  await expect(dueno.getByText("Todavía no lo has compartido con nadie")).toBeVisible();
}

// u15 a u17: lo que ve el invitado con acceso, a un tamaño dado.
async function recorridoInvitado(pagina: Page, contexto: BrowserContext, id: string, ancho: number) {
  await pagina.goto("/viajes");
  const tarjeta = pagina.locator("li.tarjeta-parada", { hasText: "Compartido contigo" });
  await expect(tarjeta.first()).toBeInViewport();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capturar(pagina, BLOQUE, `u15-mis-viajes-invitado-${ancho}`, { fullPage: false });

  await pagina.goto(`/plan/${id}?dia=1`);
  await expect(pagina.getByTestId("solo-lectura")).toHaveText("Compartido contigo · solo lectura");
  await expect(pagina.getByTestId("solo-lectura")).toBeInViewport();
  await expect(pagina.locator("li.tarjeta-parada").first()).toBeInViewport();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capturar(pagina, BLOQUE, `u16-plan-invitado-${ancho}`, { fullPage: true });

  await esperarControlador(pagina);
  await pagina.goto(`/plan/${id}?dia=1`);
  await expect.poll(async () => (await claves(pagina, "viajes-datos")).some((u) => u.endsWith(`/api/plan/${id}`)), { timeout: 30_000 }).toBe(true);
  await contexto.setOffline(true);
  try {
    await pagina.reload();
    const franja = pagina.getByRole("status").filter({ hasText: "Sin conexión" });
    await expect(franja).toContainText("Estás viendo la copia guardada");
    await expect(franja).toBeInViewport();
    await expect(pagina.locator("li.tarjeta-parada").first()).toBeVisible();
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturar(pagina, BLOQUE, `u17-invitado-sin-red-${ancho}`, { fullPage: false });
  } finally {
    await contexto.setOffline(false);
  }
}

test.describe("compartir en el preview", () => {
  const id = () => planDePrueba();

  test.afterEach(async ({ request }) => {
    // Al terminar no queda ninguna fila de miembros_plan del plan de prueba.
    await quitarTodos(request, id());
  });

  test("inv-ac1: invitar, ver en solo lectura y sin red, quitar el acceso y no conservar la copia (u13, u15 a u19)", async ({ page, browser }) => {
    test.setTimeout(300_000);
    await quitarTodos(page.request, id());
    const lista = await invitar(page, id());
    await expect(lista.locator("[data-sensible]")).toHaveCount(1);
    await capturar(page, BLOQUE, "u13-invitar-360", { fullPage: false });

    const contexto = await contextoInvitado(browser, 360, 640);
    try {
      const invitado = await contexto.newPage();
      await recorridoInvitado(invitado, contexto, id(), 360);

      // u16: el DOM de la página entera, sin controles de edición ni dinero.
      await invitado.goto(`/plan/${id()}?dia=1`);
      await expect(invitado.getByTestId("solo-lectura")).toBeVisible();
      for (const nombre of BOTONES_EDICION) await expect(invitado.getByRole("button", { name: nombre })).toHaveCount(0);
      await expect(invitado.getByTestId("presupuesto-plan")).toHaveCount(0);
      await expect(invitado.getByText("Compartir", { exact: true })).toHaveCount(0);
      const delDueno = (await (await page.request.get(`/api/plan/${id()}`)).json()) as { dias: { paradas: unknown[] }[] };
      const delInvitado = (await (await invitado.request.get(`/api/plan/${id()}`)).json()) as { dias: { paradas: unknown[] }[] };
      expect(delInvitado.dias.map((d) => d.paradas.length)).toEqual(delDueno.dias.map((d) => d.paradas.length));

      // u18: el dueño quita el acceso y el invitado, con red, lo ve al recargar.
      await page.goto(`/plan/${id()}?dia=1`);
      await page.getByText("Compartir", { exact: true }).click();
      await quitar(page);
      await invitado.goto(`/plan/${id()}?dia=1`);
      await expect(invitado.getByTestId("acceso-retirado")).toHaveText("Ya no tienes acceso a este plan. Quien lo creó ha dejado de compartirlo.");
      const enlace = invitado.getByRole("link", { name: "Ir a Mis viajes" });
      const caja = await enlace.boundingBox();
      expect(caja!.width).toBeGreaterThanOrEqual(44);
      expect(caja!.height).toBeGreaterThanOrEqual(44);
      await expect(enlace).toBeInViewport();
      await capturar(invitado, BLOQUE, "u18-acceso-retirado-360", { fullPage: false });
      await enlace.click();
      await expect(invitado.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(invitado.locator("li.tarjeta-parada", { hasText: "Compartido contigo" })).toHaveCount(0);

      // u19: sin red tras quitar el acceso no queda itinerario ni copia.
      await contexto.setOffline(true);
      try {
        await invitado.goto(`/plan/${id()}?dia=1`).catch(() => undefined);
        await expect(invitado.locator("li.tarjeta-parada")).toHaveCount(0);
        await expect(invitado.getByText("Estás viendo la copia guardada")).toHaveCount(0);
        await capturar(invitado, BLOQUE, "u19-sin-red-tras-quitar-360", { fullPage: false });
      } finally {
        await contexto.setOffline(false);
      }
      expect((await claves(invitado, "viajes-datos")).some((u) => u.includes(id()))).toBe(false);
    } finally {
      await contexto.close();
    }
  });

  test("inv-ac1: el invitado a 820x1180 ve lo mismo, sin desbordar (u15 a u17)", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await invitar(page, id());
    const contexto = await contextoInvitado(browser, 820, 1180);
    try {
      const invitado = await contexto.newPage();
      await recorridoInvitado(invitado, contexto, id(), 820);
    } finally {
      await contexto.close();
    }
    await page.goto(`/plan/${id()}?dia=1`);
    await page.getByText("Compartir", { exact: true }).click();
    await quitar(page);
  });

  test("inv-ac2: por la API, el invitado lee sin dinero y no puede escribir", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const alta = await page.request.post(`/api/plan/${id()}/miembros`, { data: { correo: variable("CORREO_INVITADO") } });
    expect(alta.status()).toBe(201);
    const contexto = await contextoInvitado(browser, 360, 640);
    try {
      const api = contexto.request;
      const lectura = await api.get(`/api/plan/${id()}`);
      expect(lectura.status()).toBe(200);
      expect(lectura.headers()["x-plan-leido-en"]).toBeTruthy();
      const plan = (await lectura.json()) as { compartido?: { rol?: string }; version: number; dias: { paradas: { id: string; franja_id?: string }[] }[] };
      expect(plan.compartido?.rol).toBe("miembro");
      const presentes = clavesDe(plan);
      expect(PROHIBIDAS.filter((k) => presentes.has(k))).toEqual([]);

      const ics = await api.get(`/api/plan/${id()}/calendario.ics`);
      expect(ics.status()).toBe(200);
      expect(ics.headers()["content-type"]).toContain("text/calendar");
      // UID y DTSTAMP son aleatorios y podrían contener «eur»: se quitan antes de mirar.
      const cuerpo = (await ics.text()).split(/\r?\n/).filter((l) => !/^(UID|DTSTAMP)/.test(l)).join("\n");
      expect(cuerpo).not.toMatch(/€|alojamiento/i);

      const antes = ((await (await page.request.get(`/api/plan/${id()}`)).json()) as { version: number }).version;
      // Cuerpo válido: lo que se prueba es la guarda de miembro, no la validación.
      const mismoOrden = plan.dias[0].paradas.map((p) => ({ id: p.id, franja_id: p.franja_id ?? "" }));
      const orden = await api.post(`/api/plan/${id()}/orden`, { data: { version_base: plan.version, dia_index: 0, orden: mismoOrden } });
      expect(orden.status()).toBe(403);
      const regenerar = await api.post(`/api/plan/${id()}/regenerar`, { data: {} });
      expect(regenerar.status()).toBe(403);
      expect(((await (await page.request.get(`/api/plan/${id()}`)).json()) as { version: number }).version).toBe(antes);

      const otro = await api.post(`/api/plan/${id()}/miembros`, { data: { correo: "nadie@example.com" } });
      expect(otro.status()).toBe(403);
      const miembros = (await (await page.request.get(`/api/plan/${id()}/miembros`)).json()) as { miembros: { id: string }[] };
      expect(miembros.miembros).toHaveLength(1);

      const viajes = (await (await api.get("/api/viajes")).json()) as unknown;
      expect(JSON.stringify(viajes)).toContain(id());
      expect(JSON.stringify(viajes)).toContain('"compartido":true');

      expect((await page.request.delete(`/api/plan/${id()}/miembros/${miembros.miembros[0].id}`)).status()).toBe(204);
      expect(JSON.stringify(await (await api.get("/api/viajes")).json())).not.toContain(id());
      expect((await api.get(`/api/plan/${id()}`)).status()).toBe(404);
    } finally {
      await contexto.close();
    }
  });
});
