import { expect, test } from "@playwright/test";
import { DIAS_PLAN_PRUEBA, abrirDia } from "./ayudas";
import { planDePrueba } from "./entorno";

// ver-ac4: los cuatro casos internos del trabajador se juzgan por su efecto en
// el plan real que acaba de generar. El detalle tick a tick lo cubre el job
// persistencia del CI (barrido.integration.test.ts y guardarPlan.integration.test.ts).
test("pv-trabajador: cp-cc-03, cp-alg-03, cp-cur-04 y cp-alr-01 sobre el plan real", async ({ page }) => {
  // Diez días a 3–5 s de carga cada uno más abrir los paneles de cada parada
  // no caben en los 30 s por defecto.
  test.setTimeout(900_000);
  const errores: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  page.on("pageerror", (e) => errores.push(e.message));

  let paradas = 0;
  let comprobadas = 0;
  let conAlternativas = 0;
  let conCuriosidades = 0;
  const consejosCortados: string[] = [];
  const listasConRepetidos: string[] = [];

  for (let dia = 1; dia <= DIAS_PLAN_PRUEBA; dia++) {
    await abrirDia(page, dia);
    const tarjetas = page.locator("li.tarjeta-parada");
    const n = await tarjetas.count();
    paradas += n;
    for (let i = 0; i < n; i++) {
      const t = tarjetas.nth(i);
      const nombre = (await t.locator("h4").innerText()).trim();
      const esComprobada = (await t.locator(".procedencia-sin-comprobar").count()) === 0;
      // cp-alr-01: todas las paradas tienen su panel de consejos y, si no hay
      // alternativas, simplemente no lo tienen: nunca una tarjeta rota.
      const panelConsejos = t.locator("summary", { hasText: /^Consejos y curiosidades/ });
      await expect(panelConsejos, nombre).toHaveCount(1);
      // Los pasos del caso piden abrir el panel: cerrado, sus enlaces y
      // consejos no son visibles ni medibles.
      await panelConsejos.click();

      // cp-cc-03: ningún consejo acaba en «…» por un corte a 400 caracteres.
      for (const c of await t.getByTestId("consejo-guia").all()) {
        const texto = ((await c.textContent()) ?? "").trim();
        if (/(…|\.\.\.)$/.test(texto) && texto.length <= 405) consejosCortados.push(nombre);
      }

      if (!esComprobada) continue;
      comprobadas += 1;
      if ((await t.locator("summary", { hasText: /^Alternativas \([1-9]\d*\)$/ }).count()) > 0) {
        conAlternativas += 1;
        await t.locator("summary", { hasText: /^Alternativas/ }).click();
        const nombres = await t.locator(".tarjeta-alternativa strong").allInnerTexts();
        if (new Set(nombres.map((x) => x.trim())).size !== nombres.length) listasConRepetidos.push(nombre);
      }
      const enlaces = await t.getByTestId("curiosidades-parada").locator("li a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      if (enlaces.some((h) => /#:~:text=|\/wiki\/Q\d+/.test(h))) conCuriosidades += 1;
    }
  }

  expect(planDePrueba()).toBeTruthy();
  expect(comprobadas, "el plan no tiene paradas comprobadas").toBeGreaterThan(0);
  expect(consejosCortados, "cp-cc-03: consejos cortados con «…»").toEqual([]);
  expect(listasConRepetidos, "cp-alg-03: listas con nombres repetidos").toEqual([]);
  expect(conAlternativas / comprobadas, `cp-alg-03: ${conAlternativas} de ${comprobadas} con alternativas`).toBeGreaterThanOrEqual(0.5);
  expect(conCuriosidades / comprobadas, `cp-cur-04: ${conCuriosidades} de ${comprobadas} con curiosidades verificadas`).toBeGreaterThanOrEqual(0.5);
  expect(paradas).toBeGreaterThanOrEqual(DIAS_PLAN_PRUEBA);
  expect(errores, "cp-alr-01: errores en la consola del navegador").toEqual([]);
});
