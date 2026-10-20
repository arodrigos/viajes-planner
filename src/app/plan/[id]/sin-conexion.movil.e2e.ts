import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// sc-ac1..sc-ac12: el plan sin conexión contra el build real con su service
// worker. Lo único doblado son las fotos de Commons (con ACAO, como el real) y
// el script de Google; el corte de red es el del navegador, no un mock.
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });

const BLOQUE = "plan-sin-conexion";
const CORREO = "ci-test-sin-conexion@example.com";
const DESTINO = "Lisboa";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
// Día 1 del viaje, media mañana en Lisboa: la tarjeta «Ahora» tiene parada.
const HOY = "2027-06-08T09:30:00Z";
const FECHAS = ["2027-06-08", "2027-06-09", "2027-06-10"];
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const foto = (fichero: string) => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/${fichero}/640px-${fichero}`,
  fichero,
  autor: "Autora De Prueba",
  licencia: "CC BY-SA 4.0",
  licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
  pagina_url: `https://commons.wikimedia.org/wiki/File:${fichero}`,
  fuente: "commons" as const,
});

interface Sembrada {
  id: string;
  nombre: string;
  dia: number;
  franja: string;
  foto?: ReturnType<typeof foto>;
  guia?: boolean;
  lugar?: boolean;
}
const PARADAS: Sembrada[] = [
  { id: "sc-p1", nombre: "Monasterio de los Jerónimos", dia: 0, franja: "manana", foto: foto("Jeronimos.jpg"), guia: true, lugar: true },
  { id: "sc-p2", nombre: "Pastelería de Belém", dia: 0, franja: "comida", foto: foto("Pasteis.jpg") },
  { id: "sc-p3", nombre: "Castillo de San Jorge", dia: 1, franja: "manana" },
  { id: "sc-p4", nombre: "Oceanario de Lisboa", dia: 2, franja: "manana", foto: foto("Oceanario.jpg") },
];
const CONSEJO = "Entra temprano para evitar la cola.";
const CURIOSIDAD = "El palacio original se edificó en la Alta Edad Media.";

async function sembrarPlan(supabase: SupabaseClient, planId: string, usuarioId: string, sufijo: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: FECHAS.map((fecha) => ({ fecha, franjas })), avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const clave = `osm:node/${p.id}-${sufijo}`;
    const { error } = await supabase.from("paradas").insert({
      id_externo: `${p.id}-${sufijo}`,
      plan_version_id: version.id,
      dia_index: p.dia,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita de prueba",
      lat: 38.69 + p.dia / 100,
      lon: -9.2,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: { fuente: "osm", id: clave, url: "https://www.openstreetmap.org/node/1", nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
      foto: p.foto ?? null,
      foto_intentada_en: RESUELTO_EN,
      ...(p.guia
        ? {
            guia: { consejo: CONSEJO, url: "https://en.wikivoyage.org/wiki/Lisbon", licencia: "CC BY-SA" },
            curiosidades: { frases: [CURIOSIDAD], url: "https://es.wikipedia.org/wiki/Monasterio_de_los_Jer%C3%B3nimos" },
            guia_intentada_en: RESUELTO_EN,
            guia_formato: 2,
          }
        : {}),
    });
    if (error) throw new Error(`No se pudo sembrar la parada '${p.id}': ${error.message}`);
    if (p.lugar) {
      const { error: errorLugar } = await supabase
        .from("lugares_google")
        .upsert({ clave, place_id: `ChIJ-${sufijo}`, estado: "casado", comprobado_en: new Date().toISOString() });
      if (errorLugar) throw new Error(`No se pudo sembrar lugares_google: ${errorLugar.message}`);
    }
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
}

// Imita lo mínimo del cargador de Google, como en el e2e de la ficha.
const SCRIPT_GOOGLE = `
  window.google = window.google || {};
  google.maps = google.maps || {};
  google.maps.importLibrary = async () => ({});
  class Falso extends HTMLElement {
    connectedCallback() {
      if (this.tagName !== "GMP-PLACE-DETAILS") return;
      this.style.display = "block";
      const texto = document.createElement("span");
      texto.textContent = "Ficha de prueba";
      this.append(texto);
      const emitir = () => {
        if (!this.isConnected) return;
        if (!this.checkVisibility()) { setTimeout(emitir, 50); return; }
        this.dispatchEvent(new Event("gmp-load"));
      };
      setTimeout(emitir, 0);
    }
  }
  if (!customElements.get("gmp-place-details")) customElements.define("gmp-place-details", Falso);
  const callback = new URL(document.currentScript.src).searchParams.get("callback");
  if (callback) callback.split(".").reduce((o, k, i, a) => (i === a.length - 1 ? o[k]() : o[k]), window);
`;

async function iniciarSesion(contexto: BrowserContext) {
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(CORREO);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } });
  expect(verificacion.ok()).toBe(true);
}

const FOTO_DOBLADA = "https://upload.wikimedia.org/**";
async function doblarFotos(contexto: BrowserContext) {
  await contexto.route(FOTO_DOBLADA, (ruta) =>
    ruta.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1X1 }),
  );
}

async function esperarControlador(pagina: Page) {
  await pagina.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
  });
}

// Lee la hora de «Disponible sin conexión · guardado a las HH:MM».
async function leerLinea(pagina: Page): Promise<string> {
  const linea = pagina.getByText(/Disponible sin conexión · guardado a las \d{2}:\d{2}/).first();
  await expect(linea).toBeVisible({ timeout: 30_000 });
  const texto = (await linea.textContent()) ?? "";
  return /(\d{2}:\d{2})/.exec(texto)?.[1] ?? "";
}

async function claves(pagina: Page): Promise<Record<string, string[]>> {
  return pagina.evaluate(async () => {
    const salida: Record<string, string[]> = {};
    for (const nombre of await caches.keys()) {
      salida[nombre] = (await (await caches.open(nombre)).keys()).map((r) => r.url);
    }
    return salida;
  });
}

const franja = (pagina: Page) => pagina.getByRole("status").filter({ hasText: "Sin conexión" });
const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { hasText: nombre });

test.describe("plan sin conexión", () => {
  test.describe.configure({ mode: "serial" });
  let supabase: SupabaseClient;
  let usuarioId: string;
  let planId: string;
  let otroPlanId: string;
  // Los tests siguientes reutilizan la sesión del primero: pedir otro código al mismo
  // correo en seguida lo deja sin entregar (límite de envíos de Auth).
  let cookiesSesion: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

  test.beforeAll(async () => {
    supabase = clienteDePrueba("servicio");
    const { data: usuario, error } = await supabase.auth.admin.createUser({ email: CORREO, email_confirm: true });
    if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = usuario.user.id;
    planId = `plan-sc-${Date.now()}`;
    otroPlanId = `plan-sc-otro-${Date.now()}`;
    await sembrarPlan(supabase, planId, usuarioId, "a");
    // El otro plan es del mismo usuario pero nunca se abre en el contexto: sc-ac4.
    await sembrarPlan(supabase, otroPlanId, usuarioId, "b");
  });

  test("de la primera visita al corte de red: copia, días, guía, fotos, ficha, mapa, lista y reconexión (sc-ac1..sc-ac11)", async ({ browser }) => {
    test.setTimeout(240_000);
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pagina = await contexto.newPage();
    await doblarFotos(contexto);
    await contexto.route(/(googleapis|gstatic)\.com/, (ruta) => ruta.fulfill({ contentType: "text/javascript", body: SCRIPT_GOOGLE }));
    await iniciarSesion(contexto);
    await pagina.clock.install({ time: new Date(HOY) });

    // sc-ac1 / sc-ac11: una sola visita con red, sin recargar, y la línea aparece.
    await pagina.goto(`/plan/${planId}`);
    await esperarControlador(pagina);
    await leerLinea(pagina);
    await capturar(pagina, BLOQUE, "disponible-sin-conexion");
    // sc-ac3: el día 1 se ve con red y sus fotos quedan en la caché de fotos.
    await expect(pagina.locator("img.foto-parada").first()).toBeVisible();
    await expect.poll(() => pagina.locator("img.foto-parada").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect
      .poll(async () => ((await claves(pagina))["viajes-fotos"] ?? []).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);

    // sc-ac6: abrir la ficha de Google, visitar /viajes y volver; en el dispositivo no queda nada de Google.
    await tarjeta(pagina, "Monasterio de los Jerónimos").locator("summary", { hasText: "Opiniones y horario · Google Maps" }).click();
    await expect(tarjeta(pagina, "Monasterio de los Jerónimos").locator("gmp-place-details")).toBeVisible();
    await pagina.goto("/viajes");
    await pagina.goto(`/plan/${planId}`);
    // La copia que sobrevive al corte es la de esta última lectura: su hora puede ser de un minuto posterior a la primera.
    const horaGuardada = await leerLinea(pagina);
    const conTodo = await claves(pagina);
    const todasLasUrls = Object.entries(conTodo).flatMap(([cache, urls]) => urls.map((url) => ({ cache, url: new URL(url) })));
    for (const { cache, url } of todasLasUrls) {
      if (cache === "viajes-datos") expect(url.pathname).toMatch(/^\/api\/plan\/[A-Za-z0-9_-]+$/);
      else if (cache === "viajes-fotos") expect(url.hostname).toBe("upload.wikimedia.org");
      else expect(url.pathname).not.toMatch(/^\/(api\/(google|viajes|salud|trabajos|auth)|plan\/|viajes)/);
      expect(url.hostname).not.toMatch(/google|gstatic|supabase/);
    }
    // Ningún documento HTML: sc-ac7.
    expect(todasLasUrls.filter(({ url }) => /^\/(plan|viajes)(\/|$)/.test(url.pathname))).toHaveLength(0);

    // Corte de red. Las fotos dobladas se retiran: con la red cortada, el doble de Playwright las serviría igual.
    await contexto.unroute(FOTO_DOBLADA);
    await contexto.setOffline(true);
    await pagina.reload();

    // sc-ac1: la copia, con su franja, en /sin-conexion.
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${planId}&dia=1$`));
    await expect(pagina.getByText("Monasterio de los Jerónimos").first()).toBeVisible();
    await expect(pagina.getByText("Pastelería de Belém").first()).toBeVisible();
    await expect(pagina.getByRole("link", { name: /^Día 2/ })).toBeVisible();
    await expect(pagina.getByRole("region", { name: "Ahora" })).toBeVisible();
    await expect(franja(pagina)).toContainText(horaGuardada);
    await expect(franja(pagina)).toContainText("copia guardada");
    const datos = await claves(pagina);
    expect((datos["viajes-datos"] ?? []).some((u) => u.endsWith(`/api/plan/${planId}`))).toBe(true);
    await capturar(pagina, BLOQUE, "copia-guardada");

    // sc-ac3: el día 1 conserva las fotos ya vistas.
    await expect(pagina.locator("img.foto-parada").first()).toBeVisible();
    expect(await pagina.locator("img.foto-parada").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth))).not.toContain(0);

    // sc-ac2: cambiar de día y abrir la guía sin ninguna petición de red, en menos de 200 ms.
    const peticionesRsc: string[] = [];
    pagina.on("request", (r) => {
      if (r.url().includes("_rsc") || r.headers()["rsc"]) peticionesRsc.push(r.url());
    });
    await pagina.getByRole("link", { name: /^Día 1/ }).click();
    const ms = await pagina.evaluate(
      (nombre) =>
        new Promise<number>((resolver) => {
          const t0 = performance.now();
          const observador = new MutationObserver(() => {
            if (document.body.innerText.includes(nombre)) {
              observador.disconnect();
              resolver(performance.now() - t0);
            }
          });
          observador.observe(document.body, { childList: true, subtree: true, characterData: true });
          [...document.querySelectorAll<HTMLAnchorElement>("a.chip-dia")].find((a) => a.textContent?.startsWith("Día 2"))?.click();
        }),
      "Castillo de San Jorge",
    );
    expect(ms).toBeLessThan(200);
    await expect(pagina).toHaveURL(new RegExp(`plan=${planId}.*dia=2|dia=2.*plan=${planId}`));
    expect(peticionesRsc).toHaveLength(0);
    await pagina.getByRole("link", { name: /^Día 1/ }).click();
    const jeronimos = tarjeta(pagina, "Monasterio de los Jerónimos");
    await jeronimos.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
    await expect(jeronimos.getByTestId("consejo-guia")).toContainText(CONSEJO);
    await expect(jeronimos.getByText(CURIOSIDAD).first()).toBeVisible();
    await capturar(pagina, BLOQUE, "guia-sin-red");

    // sc-ac9: la ficha dice que necesita conexión y no lanza ningún POST.
    const posts: string[] = [];
    pagina.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/google/")) posts.push(r.url());
    });
    await jeronimos.locator("summary", { hasText: "Opiniones y horario · Google Maps" }).click();
    await expect(jeronimos.getByText("La ficha de Google necesita conexión").first()).toBeVisible();
    expect(posts).toHaveLength(0);
    await jeronimos.scrollIntoViewIfNeeded();
    await capturar(pagina, BLOQUE, "ficha-sin-red");

    // sc-ac10: sin mapas guardados, el mapa explica cómo guardarlo y las paradas siguen debajo.
    await expect(pagina.getByText(/Este día no está guardado para usar sin red/).first()).toBeVisible({ timeout: 20_000 });
    await expect(pagina.getByText("Pastelería de Belém").first()).toBeVisible();
    await capturar(pagina, BLOQUE, "mapa-sin-red");

    // sc-ac3: el día 3 nunca se abrió con red; su foto es el marcador, no un icono roto.
    await pagina.getByRole("link", { name: /^Día 3/ }).click();
    const oceanario = tarjeta(pagina, "Oceanario de Lisboa");
    await expect(oceanario.locator(".foto-ausente")).toContainText("Foto no disponible sin conexión");
    await expect(oceanario.locator("img.foto-parada")).toHaveCount(0);
    // El texto y el icono caben dentro de la caja del marcador, sin salir por ningún borde.
    const cabe = await oceanario.locator(".foto-ausente").evaluate((caja) => {
      const c = caja.getBoundingClientRect();
      return [...caja.children].every((h) => {
        const r = h.getBoundingClientRect();
        return r.top >= c.top && r.bottom <= c.bottom && r.left >= c.left && r.right <= c.right;
      });
    });
    expect(cabe).toBe(true);
    await capturar(pagina, BLOQUE, "fotos-sin-red");

    // sc-ac4: un plan nunca abierto en el dispositivo no aparece.
    await pagina.goto(`/plan/${otroPlanId}`);
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${otroPlanId}`));
    await expect(pagina.getByText("Este plan no está guardado en este dispositivo. Ábrelo una vez con conexión para tenerlo disponible.")).toBeVisible();
    await expect(pagina.getByRole("link", { name: "Planes guardados en este dispositivo" })).toBeVisible();
    await expect(pagina.getByText("Monasterio de los Jerónimos")).toHaveCount(0);

    // sc-ac5: abrir la app sin red lleva a la lista, y cada entrada enseña su copia.
    await pagina.goto("/viajes");
    await expect(pagina).toHaveURL(/\/sin-conexion$/);
    await expect(pagina.getByRole("heading", { name: "Planes guardados en este dispositivo" })).toBeVisible();
    const entrada = pagina.getByRole("link", { name: new RegExp(DESTINO) });
    await expect(entrada).toHaveCount(1);
    await capturar(pagina, BLOQUE, "planes-guardados");
    await entrada.click();
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${planId}`));
    await expect(pagina.getByText("Monasterio de los Jerónimos").first()).toBeVisible();

    // sc-ac8: al volver la red, la franja se va sola y la línea enseña la hora nueva.
    await contexto.setOffline(false);
    await pagina.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(franja(pagina)).toHaveCount(0, { timeout: 5_000 });
    await leerLinea(pagina);
    await capturar(pagina, BLOQUE, "reconectado");

    // sc-ac7: con la sesión caducada, la API contesta 401 y la copia buena no se pisa.
    const cookies = await contexto.cookies();
    cookiesSesion = cookies;
    await contexto.clearCookies();
    await pagina.goto(`/plan/${planId}`).catch(() => undefined);
    await contexto.setOffline(true);
    await pagina.goto(`/plan/${planId}`);
    await expect(pagina).toHaveURL(new RegExp(`/sin-conexion\\?plan=${planId}`));
    await expect(franja(pagina)).toContainText("copia guardada");
    const cuerpo = await pagina.evaluate(async (id) => {
      const respuesta = await (await caches.open("viajes-datos")).match(`/api/plan/${id}`);
      return respuesta ? ((await respuesta.json()) as Record<string, unknown>) : null;
    }, planId);
    expect(cuerpo).not.toBeNull();
    expect(cuerpo).toHaveProperty("dias");
    expect(cuerpo).not.toHaveProperty("error");
    await contexto.setOffline(false);
    await contexto.addCookies(cookies);
    await contexto.close();
  });

  test("sin ninguna copia, /viajes sin red enseña el estado vacío (sc-ac5)", async ({ browser }) => {
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pagina = await contexto.newPage();
    await contexto.addCookies(cookiesSesion);
    await pagina.goto("/guia");
    await esperarControlador(pagina);
    await contexto.setOffline(true);
    await pagina.goto("/viajes");
    await expect(pagina).toHaveURL(/\/sin-conexion$/);
    await expect(pagina.getByText("Aún no hay planes guardados en este dispositivo. Abre un plan con conexión y quedará disponible aquí.")).toBeVisible();
    await capturar(pagina, BLOQUE, "planes-guardados-vacio");
    await contexto.close();
  });

  test("con el service worker bloqueado no se promete nada (sc-ac11)", async ({ browser }) => {
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const pagina = await contexto.newPage();
    await contexto.addCookies(cookiesSesion);
    await pagina.goto(`/plan/${planId}?dia=1`);
    await expect(pagina.getByText("Monasterio de los Jerónimos").first()).toBeVisible();
    // Sin controlador y sin copia en caché la línea no puede aparecer: se afirma
    // el estado real que la condiciona, no una espera por tiempo.
    expect(await pagina.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
    await expect
      .poll(() => pagina.evaluate(async () => (await caches.keys()).length))
      .toBe(0);
    await expect(pagina.getByText(/Disponible sin conexión/)).toHaveCount(0);
    await contexto.close();
  });

  test("la guía explica cómo usarlo sin conexión sin decir «offline» (sc-ac12)", async ({ page }) => {
    await page.goto("/guia");
    const seccion = page.getByRole("heading", { name: "Usarlo sin conexión" });
    await expect(seccion).toBeVisible();
    await seccion.scrollIntoViewIfNeeded();
    expect(((await page.locator("main").textContent()) ?? "").toLowerCase()).not.toContain("offline");
    await capturar(page, BLOQUE, "guia-usar-sin-conexion");
  });
});
