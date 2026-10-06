import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { planLondresEnlaces, sembrarPlan } from "./semillas-e2e";

// enl-ac1/enl-ac2: viewport móvil declarado por el diseño.
test.use({ viewport: { width: 390, height: 844 } });

const EMAIL = "ci-test-enlaces-e2e@example.com";

test("cada tarjeta, también Comida y Cena, lleva su enlace de mapa y su fuente si está resuelta (enl-ac1, enl-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: lista } = await supabase.auth.admin.listUsers();
  let usuarioId = lista?.users.find((u) => u.email === EMAIL)?.id;
  if (!usuarioId) {
    const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    usuarioId = data.user.id;
  }
  const plan = planLondresEnlaces(`plan-enlaces-e2e-${Date.now()}`);
  await sembrarPlan(supabase, plan);
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: plan.id });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);

  const pagina = await contexto.newPage();
  await pagina.goto(`/plan/${plan.id}`);
  await expect(pagina.getByRole("heading", { name: "Londres" })).toBeVisible();

  const tarjetas = pagina.locator("li.tarjeta-parada");
  await expect(tarjetas).toHaveCount(3);
  const tarjeta = (nombre: string) => tarjetas.filter({ hasText: nombre });
  for (const nombre of ["Borough Market", "Cena en Dishoom Covent Garden", "British Museum"]) {
    await expect(tarjeta(nombre).getByRole("link", { name: "Ver en Google Maps" })).toHaveCount(1);
  }

  const mapaBorough = tarjeta("Borough Market").getByRole("link", { name: "Ver en Google Maps" });
  await expect(mapaBorough).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=51\.5055,-0\.0?91(0)?$/);
  const mapaCena = tarjeta("Cena en Dishoom Covent Garden").getByRole("link", { name: "Ver en Google Maps" });
  const hrefCena = (await mapaCena.getAttribute("href")) ?? "";
  expect(hrefCena.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
  expect(hrefCena).toContain(encodeURIComponent("Cena en Dishoom Covent Garden"));

  await expect(tarjeta("Borough Market").getByRole("link", { name: "Fuente: OpenStreetMap" })).toBeVisible();
  await expect(tarjeta("British Museum").getByRole("link", { name: "Fuente: Wikipedia" })).toBeVisible();
  await expect(tarjeta("Cena en Dishoom Covent Garden").getByRole("link", { name: /^Fuente:/ })).toHaveCount(0);

  for (const enlace of await tarjetas.locator("ul.enlaces-parada a").all()) {
    await expect(enlace).toHaveAttribute("target", "_blank");
    expect(await enlace.getAttribute("rel")).toContain("noopener");
  }
  await expect(pagina.getByRole("heading", { name: "Más sitios recomendados" })).toBeAttached();

  // enl-ac2: ni la fila de enlaces ni la tarjeta desbordan en móvil.
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await pagina.screenshot({ path: "artefactos/capturas/enlaces-paradas-movil.png", fullPage: true });
  await contexto.close();
});
