import { expect, test } from "@playwright/test";

// usabilidad-ac8(c)/pantalla-ac8: nunca reducible al código HTTP ni a un
// "undefined"/"null"/"[object"/"Error:" crudo.
const REGEX_PROHIBIDA = /\b[45]\d\d\b|undefined|null|\[object|Error:/;
const MENCION_DEL_ENLACE_RETIRADO = /enlace de acceso|mismo navegador|enlace mágico/i;

const TRABAJO_FIXTURE = {
  id: "trabajo-guia-ac12",
  estado: "en-curso",
  etapa: "verificando sitios",
  porcentaje: 40,
  motivo: null,
  reintento_no_antes_de: null,
};

const PLAN_FIXTURE = {
  id: "plan-guia-ac12",
  destino: "Sevilla",
  dias: [],
  avisos: [],
};

// guia-ac12(a): el aviso previo va ANTES de cualquier interacción, no solo
// cuando el envío falla con 401 -si se quita, este test falla.
test("antes de escribir nada, /criterios anuncia que se pedirá un código por correo y que no se pierde lo escrito", async ({
  page,
}) => {
  await page.goto("/criterios");
  const aviso = page.getByText(/código/i).first();
  await expect(aviso).toBeVisible();
  const texto = await aviso.innerText();
  expect(texto).toMatch(/código/i);
  expect(texto).toMatch(/no perderás|no se pierde/i);
});

// guia-ac12(b): caducidad, un solo uso y frecuencia de reenvío, en texto
// visible del propio recorrido de acceso -se comprueba en el paso del
// código, que es donde esa información es accionable (antes de pedirlo, el
// usuario todavía no tiene nada que caduque ni que reenviar).
test("el paso del código dice que caduca, que es de un solo uso y cada cuánto se puede pedir otro", async ({ page }) => {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Tirana");
  await page.getByLabel("Época del año", { exact: true }).fill("otoño");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(`ci-test-guia-ac12b-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  const ayuda = page.getByText(/Caduca en una hora/i);
  await expect(ayuda).toBeVisible();
  const texto = await ayuda.innerText();
  expect(texto).toMatch(/caduca/i);
  expect(texto).toMatch(/un solo uso/i);
  expect(texto).toMatch(/cada 60 segundos/i);
});

// guia-ac12(c,d): ninguna pantalla del producto sigue prometiendo un
// enlace, y ningún mensaje se reduce a jerga técnica.
test("ninguna pantalla del producto menciona ya un enlace de acceso", async ({ page }) => {
  await page.route("**/api/trabajos/*", (route) => route.fulfill({ json: TRABAJO_FIXTURE }));
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));

  const paginas = ["/", "/criterios", `/trabajos/${TRABAJO_FIXTURE.id}`, `/plan/${PLAN_FIXTURE.id}`];
  for (const ruta of paginas) {
    await page.goto(ruta);
    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto, `mención de enlace en ${ruta}`).not.toMatch(MENCION_DEL_ENLACE_RETIRADO);
    expect(texto, `jerga técnica en ${ruta}`).not.toMatch(REGEX_PROHIBIDA);
  }
});
