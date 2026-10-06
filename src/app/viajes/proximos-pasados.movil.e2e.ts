import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { comprobarAccesibilidad } from "@/app/axe-e2e";

test.use({ viewport: { width: 390, height: 844 } });

const EMAIL = "ci-test-proximos-pasados@example.com";

function iso(desplazamientoDias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function sembrarViaje(
  supabase: SupabaseClient,
  usuarioId: string,
  marca: number,
  destino: string,
  inicio: number,
  fin: number,
): Promise<string> {
  const planId = `plan-pp-${destino.slice(0, 4).toLowerCase()}-${marca}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const { error } = await supabase.from("trabajos").insert({
    usuario_id: usuarioId,
    tipo: "generacion",
    criterios: { destino_o_tipo: destino, fechas: { modo: "fechas", inicio: iso(inicio), fin: iso(fin) } },
    estado: "completado",
    plan_id: planId,
  });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
  return planId;
}

// txt-ac1-a: el reparto va por el último día del viaje, y los viajes se
// siembran con fechas relativas al día de hoy (un margen de decenas de días,
// salvo el «en curso», que solo cruza hoy) para no depender de un reloj fijo.
test("mis-viajes: separa próximos, en curso y pasados; tocar uno abre su plan sin ?dia (txt-ac1-a)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);

  const idRoma = await sembrarViaje(supabase, usuario.user.id, marca, "Roma (ejemplo)", 10, 13);
  await sembrarViaje(supabase, usuario.user.id, marca, "Lisboa (ejemplo)", -62, -60);
  await sembrarViaje(supabase, usuario.user.id, marca, "Turín (ejemplo)", -1, 1);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(verificacion.ok()).toBe(true);

  await pagina.goto("/viajes");
  const proximos = pagina.getByRole("region", { name: "Próximos" });
  const pasados = pagina.getByRole("region", { name: "Pasados" });
  await expect(proximos.getByText("Roma (ejemplo)")).toBeVisible();
  await expect(proximos.getByText("Turín (ejemplo)")).toBeVisible();
  await expect(proximos.getByText("Lisboa (ejemplo)")).toHaveCount(0);
  await expect(pasados.getByText("Lisboa (ejemplo)")).toBeVisible();
  await expect(pasados.getByText("Roma (ejemplo)")).toHaveCount(0);

  await comprobarAccesibilidad(pagina);
  await pagina.screenshot({ path: "artefactos/capturas/mis-viajes-proximos-pasados.png", fullPage: true });

  await proximos.getByRole("listitem").filter({ hasText: "Roma (ejemplo)" }).getByRole("link", { name: "Ver el itinerario" }).click();
  await expect(pagina).toHaveURL(`/plan/${idRoma}`);
  await expect(pagina.getByRole("heading", { level: 1, name: "Roma (ejemplo)" })).toBeVisible();

  await contexto.close();
});

// txt-ac1-a, límite: sin viajes hay un estado vacío con salida; sin sesión de
// por medio, porque lo que se prueba es cómo reacciona el panel a la API.
test("mis-viajes: sin viajes explica qué hacer y enlaza a crear uno (txt-ac1-a, txt-ac3)", async ({ page }) => {
  await page.route("**/api/viajes", (route) => route.fulfill({ json: { correo: "ejemplo@example.com", viajes: [] } }));
  await page.goto("/viajes");
  await expect(page.getByText("Todavía no has pedido ningún viaje.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cuéntanos tu viaje" })).toHaveAttribute("href", "/criterios");
  await comprobarAccesibilidad(page);
});

// txt-ac4: el error dice qué hacer y el botón vuelve a pedir la lista.
test("mis-viajes: un error de la API ofrece reintentar y se recupera (txt-ac4)", async ({ page }) => {
  let llamadas = 0;
  await page.route("**/api/viajes", (route) => {
    llamadas += 1;
    if (llamadas === 1) return route.fulfill({ status: 500, json: { error: "fallo forzado" } });
    return route.fulfill({ json: { correo: "ejemplo@example.com", viajes: [] } });
  });
  await page.goto("/viajes");

  const aviso = page.getByRole("alert").filter({ hasText: /no se ha podido cargar/i });
  await expect(aviso).toContainText("Vuelve a intentarlo");
  await comprobarAccesibilidad(page);
  await page.screenshot({ path: "artefactos/capturas/mis-viajes-error.png", fullPage: true });

  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Todavía no has pedido ningún viaje.")).toBeVisible();
  await expect(aviso).toHaveCount(0);
});
