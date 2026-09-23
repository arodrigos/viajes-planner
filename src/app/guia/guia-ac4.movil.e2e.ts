import { expect, test } from "@playwright/test";

// guia-ac4: capturas de página completa a 393x851, en claro y oscuro, para
// que el gatekeeper juzgue si la guía se lee bien -sin captura adjunta el
// criterio no está cumplido, aunque los tests mecánicos de guia-ac3 pasen
// (issue #41: ya se quedó abierto una vez por este mismo motivo).
for (const modo of ["claro", "oscuro"] as const) {
  test.describe(`captura de /guia en modo ${modo}`, () => {
    test.use({ colorScheme: modo === "claro" ? "light" : "dark" });

    test(`la guía se ve completa (${modo})`, async ({ page }) => {
      await page.goto("/guia");
      await expect(page.getByRole("heading", { name: "Guía: cómo funciona esta aplicación" })).toBeVisible();
      await page.screenshot({ path: `artefactos/capturas/guia-${modo}.png`, fullPage: true });
    });
  });
}
