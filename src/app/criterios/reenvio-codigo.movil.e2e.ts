import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// reenvio-ac7: la primera petición no llega al servidor (Auth limita a un
// envío por minuto y por correo), el primer reenvío falla y el reintento va a
// la pila real: tiene que llegar UN correo, canjearse y encolar el trabajo.
const EMAIL = "ci-test-reenvio@example.com";
const DESTINO = "Oporto";
const MENSAJE = "Si tu correo está autorizado, te llegará un código en un minuto.";

test("tras un reenvío fallido, el reintento envía el código y se canjea con los criterios escritos", async ({ page }) => {
  let sesionIniciada = false;
  let llamadas = 0;
  await page.clock.install();
  await page.route("**/api/plan", async (ruta) => {
    // Solo el primer envío (sin sesión) se simula; el reenvío tras el canje va al servidor real.
    if (!sesionIniciada) return ruta.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    return ruta.continue();
  });
  await page.route("**/api/acceso/solicitar-codigo", (ruta) => {
    llamadas += 1;
    if (llamadas === 1) return ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mensaje: MENSAJE }) });
    if (llamadas === 2) return ruta.fulfill({ status: 500, body: "" });
    return ruta.continue();
  });

  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO);
  await page.getByLabel("Época del año", { exact: true }).fill("otoño");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();
  await expect(page.getByRole("form", { name: "Introducir código" })).toBeVisible();

  await page.clock.runFor(61_000);
  await page.getByRole("button", { name: "Pedir otro código", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Pedir otro código", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Pedir otro código", exact: true }).click();
  const codigo = await leerCodigo(EMAIL);
  await page.getByLabel("Código de acceso").fill(codigo);
  sesionIniciada = true;
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await page.waitForURL(/\/trabajos\/[^/]+$/);

  const supabase = clienteDePrueba("servicio");
  const { data: usuarios, error: errorUsuarios } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (errorUsuarios) throw new Error(`No se pudo listar usuarios: ${errorUsuarios.message}`);
  const usuario = usuarios.users.find((u) => u.email === EMAIL);
  expect(usuario, "el canje crea la cuenta").toBeTruthy();
  const { data, error } = await supabase.from("trabajos").select("criterios").eq("usuario_id", usuario!.id);
  if (error) throw new Error(`No se pudo leer trabajos: ${error.message}`);
  expect(data).toHaveLength(1);
  expect((data![0].criterios as { destino_o_tipo: string }).destino_o_tipo).toBe(DESTINO);
});
