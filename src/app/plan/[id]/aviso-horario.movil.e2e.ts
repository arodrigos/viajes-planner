import { expect, test, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { capturar } from "@/test-utils/capturas";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// dif-ac1, dif-ac2, dif-ac3: procedencia del horario y atajo a la ficha de
// Google contra la ruta real. Lo único doblado es el script de Google.
test.use({ viewport: { width: 393, height: 851 } });

const DESTINO = "Granada";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
// Día 2 del viaje, 09:30 en Granada: «hoy» lo fija page.clock, no la máquina.
const DURANTE = "2027-06-09T07:30:00Z";
const CORREO = "ci-test-aviso-horario@example.com";
const SUFIJO = "aviso";
// Abierto siempre, para que el aviso de cierre no se mezcle con el de antigüedad.
const SIEMPRE_ABIERTO = "Mo-Su 00:00-24:00";
const PARADAS = [
  { id: "p-aviso-1", nombre: "Museo antiguo", franja: "manana", lat: 37.1761, lon: -3.5881, comprobado: "2021-03", estado: "casado", placeId: "ChIJ-aviso-1" },
  { id: "p-aviso-2", nombre: "Museo reciente", franja: "comida", lat: 37.1793, lon: -3.5903, comprobado: "2027-03", estado: "casado", placeId: "ChIJ-aviso-2" },
  { id: "p-aviso-3", nombre: "Museo sin fecha", franja: "tarde", lat: 37.1815, lon: -3.5925, comprobado: null, estado: "casado", placeId: "ChIJ-aviso-3" },
  { id: "p-aviso-4", nombre: "Museo sin ficha", franja: "noche", lat: 37.1830, lon: -3.5940, comprobado: "2021-03", estado: "sin-coincidencia", placeId: null },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-aviso-e2e-${SUFIJO}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = franjasComoArray(DESTINO);
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha) => ({ fecha, franjas }));
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const clave = `osm:node/${p.id}-${SUFIJO}`;
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: p.id,
      plan_version_id: version.id,
      dia_index: 1,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita de prueba",
      lat: p.lat,
      lon: p.lon,
      duracion_min: 60,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: {
        fuente: "osm",
        id: clave,
        url: `https://www.openstreetmap.org/node/${p.id}`,
        nombre_fuente: p.nombre,
        etiquetas: { opening_hours: SIEMPRE_ABIERTO, ...(p.comprobado ? { check_date_opening_hours: p.comprobado } : {}) },
        resuelto_en: RESUELTO_EN,
      },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
    const { error: errorLugar } = await supabase
      .from("lugares_google")
      .upsert({ clave, place_id: p.placeId, estado: p.estado, comprobado_en: new Date().toISOString() });
    if (errorLugar) throw new Error(`No se pudo sembrar lugares_google: ${errorLugar.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

// Imita lo mínimo del cargador de Google (ver ficha-google.movil.e2e.ts).
const SCRIPT_FALSO = `
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
          // Como el real: no carga ni avisa mientras él o un antepasado están ocultos.
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

async function abrir(browser: Browser, planId: string) {
  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await pagina.route(/(googleapis|gstatic)\.com/, (ruta) => ruta.fulfill({ contentType: "text/javascript", body: SCRIPT_FALSO }));
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: CORREO } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(CORREO);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: CORREO, codigo } });
  expect(verificacion.ok()).toBe(true);
  const posts: Array<Record<string, unknown>> = [];
  pagina.on("request", (r) => {
    if (r.url().endsWith("/api/google/ficha") && r.method() === "POST") posts.push(r.postDataJSON());
  });
  await pagina.clock.install({ time: new Date(DURANTE) });
  await pagina.goto(`/plan/${planId}`);
  return { contexto, pagina, posts };
}

const tarjeta = (pagina: Page, nombre: string) => pagina.locator("li.tarjeta-parada", { hasText: nombre });
const panelGoogle = (pagina: Page, nombre: string) => tarjeta(pagina, nombre).locator("details", { hasText: "Opiniones y horario · Google Maps" });
const sinScrollHorizontal = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("aviso de horario con procedencia", () => {
  test.describe.configure({ mode: "serial" });
  let planId: string;

  test.beforeAll(async () => {
    planId = await sembrar(clienteDePrueba("servicio"), CORREO);
  });

  test("cada línea dice su fuente y su antigüedad y el botón sale solo cuando toca (dif-ac1, dif-ac3)", async ({ browser }) => {
    const { contexto, pagina } = await abrir(browser, planId);
    const antiguo = tarjeta(pagina, "Museo antiguo");
    await expect(antiguo.getByTestId("procedencia-horario")).toContainText("Horario según OpenStreetMap · comprobado en 2021");
    await expect(antiguo.getByTestId("procedencia-horario")).toContainText("puede haber cambiado");
    await expect(antiguo.getByRole("button", { name: "Compruébalo en Google" })).toBeVisible();

    const reciente = tarjeta(pagina, "Museo reciente");
    await expect(reciente.getByTestId("procedencia-horario")).toContainText("comprobado en 2027");
    await expect(reciente.getByRole("button", { name: "Compruébalo en Google" })).toHaveCount(0);

    const sinFecha = tarjeta(pagina, "Museo sin fecha");
    await expect(sinFecha.getByTestId("procedencia-horario")).toContainText("sin fecha de comprobación");
    await expect(sinFecha.getByRole("button", { name: "Compruébalo en Google" })).toBeVisible();

    // Antiguo pero sin ficha de Google a la que llevar: el botón no promete nada.
    const sinFicha = tarjeta(pagina, "Museo sin ficha");
    await expect(sinFicha.getByTestId("procedencia-horario")).toContainText("comprobado en 2021");
    await expect(sinFicha.getByRole("button", { name: "Compruébalo en Google" })).toHaveCount(0);

    expect(await sinScrollHorizontal(pagina)).toBe(true);
    await comprobarAccesibilidad(pagina, ["gmp-place-details"]);
    await antiguo.scrollIntoViewIfNeeded();
    await capturar(pagina, "aviso-horario-procedencia", "linea-horario");
    await sinFecha.getByRole("button", { name: "Compruébalo en Google" }).scrollIntoViewIfNeeded();
    await capturar(pagina, "aviso-horario-procedencia", "boton");
    await contexto.close();
  });

  test("el botón abre el panel de su tarjeta con una reserva y no repite si ya está montado (dif-ac2)", async ({ browser }) => {
    const { contexto, pagina, posts } = await abrir(browser, planId);
    await expect(panelGoogle(pagina, "Museo antiguo")).not.toHaveAttribute("open", "");
    await tarjeta(pagina, "Museo antiguo").getByRole("button", { name: "Compruébalo en Google" }).click();
    await expect(panelGoogle(pagina, "Museo antiguo")).toHaveAttribute("open", "");
    await expect(tarjeta(pagina, "Museo antiguo").locator("gmp-place-details")).toBeVisible();
    expect(posts).toEqual([{ planId, paradaId: "p-aviso-1" }]);
    await expect(panelGoogle(pagina, "Museo sin ssitio")).toHaveCount(0);

    await tarjeta(pagina, "Museo antiguo").getByRole("button", { name: "Compruébalo en Google" }).click();
    await expect(tarjeta(pagina, "Museo antiguo").locator("gmp-place-details")).toHaveCount(1);
    expect(posts).toHaveLength(1);
    await contexto.close();
  });

  test("el enlace de Ahora lleva el foco a la siguiente parada y abre su panel; con la ficha montada no reserva otra (dif-ac2)", async ({ browser }) => {
    const { contexto, pagina, posts } = await abrir(browser, planId);
    const enlace = pagina.getByRole("button", { name: "Comprobar el horario de hoy en Google" });
    await expect(enlace).toBeVisible();
    await enlace.click();
    await expect(tarjeta(pagina, "Museo antiguo")).toBeFocused();
    await expect(panelGoogle(pagina, "Museo antiguo")).toHaveAttribute("open", "");
    await expect(tarjeta(pagina, "Museo antiguo").locator("gmp-place-details")).toBeVisible();
    expect(posts).toEqual([{ planId, paradaId: "p-aviso-1" }]);

    await enlace.click();
    expect(posts).toHaveLength(1);
    await contexto.close();
  });
});
