import { expect, test } from "@playwright/test";
import { capturar } from "@/test-utils/capturas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { NOMBRES, abrirPlan, ordenPintado, parada, sembrarDia } from "./orden-e2e";

// orc-ac3: el 409 del guardado devuelve el orden del servidor y el aviso
// queda a la vista, con estilo informativo. Viewport de móvil pequeño: el día
// no cabe entero, así que si el aviso dependiera del scroll se perdería.
test.use({ viewport: { width: 360, height: 640 } });

const AVISO = "El plan se acaba de actualizar mientras guardabas. Hemos cargado la versión más reciente; vuelve a ordenar si lo necesitas.";

// Las tres en la misma franja: moverlas entre sí siempre es un orden válido.
const tres = () => [parada("a", NOMBRES.a, "manana", 0), parada("b", NOMBRES.b, "manana", 1), parada("c", NOMBRES.c, "manana", 2)];

test("un 409 de version-desfasada recoloca las paradas y enseña el aviso dentro del viewport (orc-ac3)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-desfasada@example.com";
  const planId = await sembrarDia(supabase, email, "desfasada", tres());
  const { contexto, pagina } = await abrirPlan(browser, email, planId);
  await pagina.route("**/api/plan/*/orden", (ruta) =>
    ruta.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "version-desfasada", mensaje: AVISO }) }),
  );

  expect(await ordenPintado(pagina)).toEqual(["Alfa", "Beta", "Gamma"]);
  await pagina.getByRole("button", { name: "Subir «Gamma»" }).scrollIntoViewIfNeeded();
  await pagina.getByRole("button", { name: "Subir «Gamma»" }).click();
  await pagina.getByRole("button", { name: "Subir «Gamma»" }).click();
  expect(await ordenPintado(pagina)).toEqual(["Gamma", "Alfa", "Beta"]);

  const aviso = pagina.getByText(AVISO);
  await expect(aviso).toBeVisible();
  await expect(aviso).toBeInViewport();
  // Vuelve el orden del servidor, y el aviso es el informativo, no el de error.
  await expect.poll(() => ordenPintado(pagina), { timeout: 2000 }).toEqual(["Alfa", "Beta", "Gamma"]);
  await expect(pagina.locator(".aviso-orden-info")).toContainText("El plan se acaba de actualizar");
  await expect(pagina.locator(".aviso-orden-error")).toHaveCount(0);
  await expect(pagina.getByText("No se ha podido guardar el nuevo orden.")).toHaveCount(0);
  await expect(aviso).toBeInViewport();
  await capturar(pagina, "orden-desfasada", "orden-desfasada", { fullPage: false });
  await contexto.close();
});

// Correo propio: con el mismo que el test anterior, el límite de códigos por correo rechaza la segunda solicitud.
test("un 500 real sigue enseñando «No se ha podido guardar el nuevo orden.» (orc-ac3, límite)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-orden-desfasada500@example.com";
  const planId = await sembrarDia(supabase, email, "desfasada-500", tres());
  const { contexto, pagina } = await abrirPlan(browser, email, planId);
  await pagina.route("**/api/plan/*/orden", (ruta) =>
    ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "interno", mensaje: "No se ha podido guardar el nuevo orden." }) }),
  );

  await pagina.getByRole("button", { name: "Subir «Gamma»" }).click();
  await expect(pagina.locator(".aviso-orden-error")).toContainText("No se ha podido guardar el nuevo orden");
  await expect(pagina.locator(".aviso-orden-info")).toHaveCount(0);
  await contexto.close();
});
