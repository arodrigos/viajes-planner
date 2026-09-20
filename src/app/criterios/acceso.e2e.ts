import { expect, test } from "@playwright/test";
import { leerEnlaceMagico } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// El único correo de CORREOS_PERMITIDOS en CI (.github/workflows/ci.yml);
// fuera de CI hace falta exportar la misma variable con este valor.
const EMAIL = "ci-test@example.com";

// acceso-ac4/ac6: el camino completo contra la pila real de Supabase -sin
// sesión, /api/plan responde 401 y el borrador se guarda; se pide el
// enlace, se lee el correo real (no una intercepción de red) y, al
// confirmarlo, la sesión queda creada y el envío pendiente se reenvía solo.
test("pide acceso, confirma el enlace recibido por correo y reenvía el plan pendiente", async ({ page }) => {
  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill("Sevilla");
  await page.getByLabel("Época del año", { exact: true }).fill("primavera");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  await expect(page.getByText(`Te hemos enviado un enlace a ${EMAIL}.`)).toBeVisible();

  const enlace = await leerEnlaceMagico(EMAIL);
  await page.goto(enlace);

  await expect(page).toHaveURL(/\/trabajos\/[^/]+$/, { timeout: 15_000 });

  // acceso-ac4(h): el paso (g) solo prueba que el navegador LLEGA a esa
  // URL, no que el reenvío automático haya encolado de verdad el trabajo
  // con los criterios escritos antes del desvío por el correo -- sin esta
  // comprobación, una regresión que dejara el reenvío como no-op seguiría
  // aterrizando en /trabajos/<id> con un identificador que no existe en
  // la base de datos, y el test seguiría en verde.
  const id = page.url().split("/").pop();
  const supabase = clienteDePrueba("servicio");
  const { data: trabajo } = await supabase.from("trabajos").select("estado, criterios").eq("id", id).single();
  expect(trabajo?.estado).toBe("encolado");
  expect(trabajo?.criterios).toMatchObject({ destino_o_tipo: "Sevilla", fechas: { modo: "epoca", epoca: "primavera" } });
});
