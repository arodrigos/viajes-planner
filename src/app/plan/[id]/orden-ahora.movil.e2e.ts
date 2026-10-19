import { expect, test } from "@playwright/test";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { NOMBRES, abrirPlan, ordenPintado, parada, sembrarDia } from "./orden-e2e";

// reo-ac5: «Ahora», «Sal a las» y los números del mapa salen del orden nuevo.
// «Ahora» lo fija page.clock: 09:30 del día del plan en Granada (UTC+2).
test.use({ viewport: { width: 390, height: 844 } });

const DURANTE = "2027-06-09T07:30:00Z";

test("Ahora, Sal a las y el mapa siguen el orden nuevo (reo-ac5)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-ahora@example.com";
  const planId = await sembrarDia(supabase, email, "ahora", [
    parada("a", NOMBRES.a, "manana", 0),
    parada("b", NOMBRES.b, "manana", 1),
    parada("c", NOMBRES.c, "tarde", 2),
  ]);
  const { contexto, pagina } = await abrirPlan(browser, email, planId, { ahora: DURANTE });

  const ahora = pagina.getByRole("region", { name: "Ahora" });
  await expect(ahora).toContainText("Alfa");
  await expect(pagina.locator('.marcador-parada[data-orden="1"]')).toHaveAttribute("data-parada-id", "a");

  await pagina.getByRole("button", { name: "Bajar «Alfa»" }).click();
  await expect(pagina.getByText("Orden guardado")).toBeVisible();
  expect(await ordenPintado(pagina)).toEqual(["Beta", "Alfa", "Gamma"]);

  await expect(ahora).toContainText("Beta");
  await expect(ahora).not.toContainText("Alfa");
  await expect(pagina.locator('.marcador-parada[data-orden="1"]')).toHaveAttribute("data-parada-id", "b");
  await expect(pagina.locator('.marcador-parada[data-orden="2"]')).toHaveAttribute("data-parada-id", "a");

  // Marcar la primera (ahora Beta) hace que «Sal a las» hable de Alfa.
  await ahora.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(ahora).toContainText("Alfa");
  await expect(ahora.locator("p", { hasText: /Sal antes de las|Si sales ya/ })).toBeVisible();
  await contexto.close();
});
