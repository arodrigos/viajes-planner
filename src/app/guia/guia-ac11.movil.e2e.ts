import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const EMAIL = "ci-test-guia-ac11@example.com";
const DESTINO = "Split";
const EPOCA = "verano";

// guia-ac11: los pasos de la guía son EJECUTABLES tal cual están escritos.
// Por eso la navegación entera va con `page.goto("/")` una sola vez y de ahí
// en adelante SOLO controles visibles -ningún `page.goto` a una dirección
// interna distinta de "/"-, siguiendo el propio recorrido que la guía
// describe: portada -> «Cuéntanos tu viaje» -> criterios -> código -> plan
// encolado.
test("alguien que sigue la guía al pie de la letra, sin escribir ninguna dirección, acaba con un viaje encolado", async ({
  page,
}) => {
  const supabase = clienteDePrueba("servicio");

  // (a) desde la portada se llega a la guía con un toque, sin scroll.
  await page.goto("/");
  await page.getByRole("link", { name: "¿Cómo funciona esta aplicación?" }).click();
  await expect(page).toHaveURL("/guia");

  // (b) desde la guía (o la portada) se llega a /criterios con los
  // controles que la propia guía nombra: «Empieza en la portada y pulsa
  // «Cuéntanos tu viaje»» -así que se vuelve a la portada con el control de
  // navegación del navegador, no con page.goto, y se pulsa ese botón.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Cuéntanos tu viaje" }).click();
  await expect(page).toHaveURL("/criterios");

  // (c) se rellenan los criterios, se pide y se teclea el código real.
  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO);
  await page.getByLabel("Época del año", { exact: true }).fill(EPOCA);
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(page.getByRole("form", { name: "Introducir código" })).toBeVisible();

  const codigo = await leerCodigo(EMAIL);
  await page.getByLabel("Código de acceso").fill(codigo);
  await page.getByRole("button", { name: "Confirmar código" }).click();

  // (d) el recorrido termina en /trabajos/<id> con una fila real encolada.
  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const { data: trabajo, error } = await supabase.from("trabajos").select("estado, criterios").eq("id", id).single();
  if (error || !trabajo) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);
  expect(trabajo.estado).toBe("encolado");
  expect(trabajo.criterios).toMatchObject({
    destino_o_tipo: DESTINO,
    fechas: { modo: "epoca", epoca: EPOCA },
  });
});
