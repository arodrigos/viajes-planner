import { expect, test, type Page } from "@playwright/test";
import { franjasParaDestino } from "@/lib/plan/config-franjas";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// visual-ac1/ac2: sustituyen a acceso-ac2 y vista-ac2 -que pasaban en verde
// sin una sola línea de CSS- porque miden geometría REALMENTE RENDERIZADA en
// vez de solo `scrollWidth`. Solo corre en el proyecto 'movil'
// (playwright.config.ts), nunca duplicado en 'chromium'.

const PLAN_FIXTURE = {
  id: "plan-movil-e2e",
  version: 1,
  destino: "Sevilla",
  personas: 2,
  dias: [0, 1].map((indice) => {
    const franjasConfig = franjasParaDestino("Sevilla");
    const franjas = Object.entries(franjasConfig).map(([id, def]) => ({ id, etiqueta: def.etiqueta }));
    return {
      fecha: `2026-10-0${indice + 5}`,
      franjas,
      paradas: [
        { id: `parada-${indice}-a`, franja_id: "manana", nombre: `Sitio del día ${indice + 1}`, descripcion: "Una visita tranquila por el centro histórico." },
        { id: `parada-${indice}-b`, franja_id: "cena", nombre: `Cena del día ${indice + 1}`, descripcion: "Sitio recomendado por la zona, sin verificar contra ninguna ficha todavía." },
      ],
    };
  }),
  avisos: ["El presupuesto indicado puede no cubrir la estancia completa."],
};

const TRABAJO_FIXTURE = {
  id: "trabajo-movil-e2e",
  estado: "en-curso",
  etapa: "verificando sitios",
  porcentaje: 62,
  motivo: null,
  reintento_no_antes_de: null,
};

interface Pagina {
  nombre: string;
  ruta: string;
  preparar?: (page: Page) => Promise<unknown>;
  esperar: (page: Page) => Promise<void>;
}

const PAGINAS: Pagina[] = [
  { nombre: "home", ruta: "/", esperar: (page) => page.getByRole("heading", { name: "Viajes" }).waitFor() },
  { nombre: "criterios", ruta: "/criterios", esperar: (page) => page.getByRole("heading", { name: "Cuéntanos tu viaje" }).waitFor() },
  {
    nombre: "plan",
    ruta: "/plan/plan-movil-e2e",
    preparar: (page) => page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE })),
    esperar: (page) => page.getByText(/Ninguna parada está comprobada/).waitFor(),
  },
  {
    nombre: "trabajos",
    ruta: "/trabajos/trabajo-movil-e2e",
    preparar: (page) => page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_FIXTURE })),
    esperar: (page) => page.getByText("verificando sitios").waitFor(),
  },
  // pantalla-ac9: los dos pasos de PanelAcceso, contra el backend real (sin
  // doblar la red) -el correo no hace falta que esté en la lista blanca,
  // porque la respuesta es uniforme (pantalla-ac8d) y aquí solo importa la
  // pantalla a la que se llega.
  {
    nombre: "acceso-paso-correo",
    ruta: "/criterios",
    esperar: async (page) => {
      await page.getByLabel("Destino o tipo de viaje").fill("Braga");
      await page.getByLabel("Época del año", { exact: true }).fill("verano");
      await page.getByRole("button", { name: "Continuar" }).click();
      await page.getByRole("form", { name: "Pedir acceso" }).waitFor();
    },
  },
  {
    nombre: "acceso-paso-codigo",
    ruta: "/criterios",
    esperar: async (page) => {
      await page.getByLabel("Destino o tipo de viaje").fill("Braga");
      await page.getByLabel("Época del año", { exact: true }).fill("verano");
      await page.getByRole("button", { name: "Continuar" }).click();
      await page.getByLabel("Tu correo").fill(`ci-test-visual-ac9-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
      await page.getByRole("button", { name: "Pedir código de acceso" }).click();
      await page.getByRole("form", { name: "Introducir código" }).waitFor();
    },
  },
];

// visual-ac2(b): 16px es el umbral por debajo del cual Safari en iOS amplía
// la página entera al enfocar un campo.
async function medirTamanosDeFuente(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea')).map(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    ),
  );
}

for (const modo of ["claro", "oscuro"] as const) {
  test.describe(`captura visual en modo ${modo}`, () => {
    test.use({ colorScheme: modo === "claro" ? "light" : "dark" });

    for (const pagina of PAGINAS) {
      test(`${pagina.nombre} se ve y se usa cómodamente (${modo})`, async ({ page }) => {
        if (pagina.preparar) await pagina.preparar(page);
        await page.goto(pagina.ruta);
        await pagina.esperar(page);

        // visual-ac1: captura real de página completa, es lo que juzga el
        // gatekeeper -nunca una comparación contra una imagen de referencia.
        await page.screenshot({ path: `artefactos/capturas/${pagina.nombre}-${modo}.png`, fullPage: true });

        // visual-ac2(a): objetivo táctil >=44x44, salvo las dos excepciones.
        const elementos = await medirObjetivosTactiles(page);
        for (const el of elementos) {
          expect.soft(el.alto, `${el.descripcion} en ${pagina.nombre}: alto`).toBeGreaterThanOrEqual(44);
          if (el.exigirAncho) {
            expect.soft(el.ancho, `${el.descripcion} en ${pagina.nombre}: ancho`).toBeGreaterThanOrEqual(44);
          }
        }

        // visual-ac2(b): fuente >=16px en campos de texto.
        for (const tamano of await medirTamanosDeFuente(page)) {
          expect.soft(tamano, `tamaño de fuente en ${pagina.nombre}`).toBeGreaterThanOrEqual(16);
        }

        // visual-ac2(c): sin desbordamiento horizontal, como comprobación
        // acompañante -nunca la única, que es el error que se corrige aquí.
        const anchoViewport = page.viewportSize()?.width ?? 393;
        const anchoDocumento = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(anchoDocumento, `desbordamiento horizontal en ${pagina.nombre}`).toBeLessThanOrEqual(anchoViewport);
      });
    }
  });
}

// visual-ac2(d): la misma pasada a 320px, el móvil pequeño realista.
test.describe("320px de ancho", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  for (const pagina of PAGINAS) {
    test(`${pagina.nombre} no desborda ni baja de 44px de alto a 320px`, async ({ page }) => {
      if (pagina.preparar) await pagina.preparar(page);
      await page.goto(pagina.ruta);
      await pagina.esperar(page);

      const anchoDocumento = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(anchoDocumento, `desbordamiento horizontal en ${pagina.nombre} a 320px`).toBeLessThanOrEqual(320);

      const elementos = await medirObjetivosTactiles(page);
      for (const el of elementos) {
        expect.soft(el.alto, `${el.descripcion} en ${pagina.nombre} a 320px: alto`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});
