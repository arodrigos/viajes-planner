import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ANCHO_MOVIL, abrirDia, leerPlan, type ParadaApi } from "./ayudas";
import { DIRECTORIO } from "./entorno";

async function cargasHoy(peticiones: APIRequestContext): Promise<number> {
  const r = await peticiones.get("/api/salud");
  const cuerpo = (await r.json()) as { google?: { ui_kit_hoy?: number; clave_navegador?: number } };
  return cuerpo.google?.ui_kit_hoy ?? -1;
}

async function claveConfigurada(peticiones: APIRequestContext): Promise<boolean> {
  const cuerpo = (await (await peticiones.get("/api/salud")).json()) as { google?: { clave_navegador?: number } };
  return cuerpo.google?.clave_navegador === 1;
}

// fic-ac2 (ficha-real): necesita la clave de navegador real, que es un paso
// manual. Sin ella el caso queda pendiente de esa acción y no falla.
// La ficha la pinta gmp-place-details con shadow DOM cerrado: no se afirma
// nada sobre su contenido (valoración, reseña, atribución van en la captura),
// solo sobre data-estado-ficha, que FichaGoogle fija con los eventos públicos.
test("pv-ficha-real: la ficha de una parada casada carga con una sola reserva de UI Kit (fpv-ac1)", async ({ page, request }) => {
  test.skip(!(await claveConfigurada(request)), "Paso manual de la clave de navegador pendiente (clave_navegador = 0)");
  test.setTimeout(120_000);

  // Una parada casada conocida, para abrir un solo panel en vez de buscar abriendo.
  const plan = (await leerPlan(request)) as { dias: { paradas: (ParadaApi & { google?: { estado?: string } })[] }[] };
  let dia = 0;
  let nombre = "";
  plan.dias.forEach((d, i) => {
    const casada = d.paradas.find((p) => p.google?.estado === "casado");
    if (!nombre && casada) {
      dia = i + 1;
      nombre = casada.nombre;
    }
  });
  expect(nombre, "el plan de prueba no tiene ninguna parada casada").not.toBe("");

  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/google/ficha") posts.push(r.postData() ?? "");
  });

  await abrirDia(page, dia);
  const tarjeta = page.locator("li.tarjeta-parada").filter({ hasText: nombre }).first();
  const antes = await cargasHoy(request);
  await tarjeta.locator("summary", { hasText: /^Opiniones y horario/ }).click();

  const ficha = tarjeta.locator(".ficha-google");
  await expect(ficha).toHaveAttribute("data-estado-ficha", "ficha", { timeout: 20_000 });

  expect(posts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ANCHO_MOVIL);
  expect((await cargasHoy(request)) - antes).toBe(1);

  mkdirSync(`${DIRECTORIO}/capturas`, { recursive: true });
  await page.screenshot({ path: `${DIRECTORIO}/capturas/pv-ficha-real.png`, fullPage: true });
});
