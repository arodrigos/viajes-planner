import { expect, test, type Browser, type APIRequestContext } from "@playwright/test";
import { leerEnlaceMagico } from "@/lib/auth/__tests__/mailpit";

// acceso-ac6a-prueba: un enlace mágico que ya no sirve -agotado o
// manipulado- tiene que caer en el MISMO camino que uno caducado por
// reloj, sin depositar sesión. Probar la caducidad por reloj exigiría
// bajar «Email OTP Expiration» -ajuste GLOBAL del proyecto Supabase
// compartido- y esperar con un `sleep`, que el reglamento de la flota
// prohíbe en el camino crítico (carreras de tiempo real). Los enlaces de
// correo de Supabase son de un solo uso y el mismo ajuste de expiración
// gobierna magic links y OTP: `verifyOtp` devuelve el mismo `otp_expired`
// tanto si el token está caducado como si ya se ha consumido, y el
// producto recorre exactamente el mismo camino (`redirigirAError()`) en
// los dos casos -- agotar el token prueba el mismo comportamiento, no uno
// parecido.
const EMAIL_AGOTADO = "ci-test-acceso-ac6a-agotado@example.com";
const EMAIL_MANIPULADO = "ci-test-acceso-ac6a-manipulado@example.com";

const MENSAJE_ENLACE_MUERTO = "El enlace no es válido o ha caducado.";

async function pedirEnlace(request: APIRequestContext, email: string): Promise<string> {
  const respuesta = await request.post("/api/acceso/solicitar-enlace", { data: { email } });
  expect(respuesta.ok()).toBe(true);
  return leerEnlaceMagico(email);
}

// Abre `enlace` en un contexto de navegador PROPIO (sin la cookie que
// pudiera haber dejado una apertura anterior) y comprueba que el camino de
// error no deja rastro: destino /criterios?acceso=error con el aviso
// visible y ninguna sesión depositada.
async function verificarCaeComoEnlaceCaducado(browser: Browser, enlace: string): Promise<void> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto(enlace);

  await expect(pagina).toHaveURL(/\/criterios\?acceso=error/);
  await expect(pagina.getByText(MENSAJE_ENLACE_MUERTO)).toBeVisible();

  // La aserción que hoy no existe y es el punto del criterio: si el camino
  // de error hubiera depositado una cookie de sesión, esta petición
  // respondería otra cosa que 401 (202, 400 o 429 según el cuerpo).
  const respuestaPlan = await contexto.request.post("/api/plan", {
    data: {},
    headers: { "content-type": "application/json" },
  });
  expect(respuestaPlan.status()).toBe(401);

  await contexto.close();
}

test("token agotado: un enlace ya consumido cae en el mismo camino que uno caducado por reloj", async ({ browser, request }) => {
  const enlace = await pedirEnlace(request, EMAIL_AGOTADO);

  // Primera apertura, en un contexto propio: consume el token de un solo
  // uso y crea una sesión real.
  const contextoConsumidor = await browser.newContext();
  const paginaConsumidora = await contextoConsumidor.newPage();
  await paginaConsumidora.goto(enlace);
  await expect(paginaConsumidora).toHaveURL(/\/criterios\?acceso=confirmado/);
  await contextoConsumidor.close();

  // Segunda apertura del MISMO enlace: el token ya está gastado, así que
  // verifyOtp falla con el mismo error que un enlace caducado por reloj.
  await verificarCaeComoEnlaceCaducado(browser, enlace);
});

test("token manipulado: un token_hash alterado produce el mismo resultado que un enlace caducado", async ({ browser, request }) => {
  const enlace = await pedirEnlace(request, EMAIL_MANIPULADO);
  const url = new URL(enlace);
  const original = url.searchParams.get("token_hash") ?? "";
  // El atacante que fabrica un enlace no necesita correo ni pila de Auth:
  // le basta un token_hash inventado, que es la otra mitad del sub-caso.
  const alterado = (original[0] === "a" ? "b" : "a") + original.slice(1);
  url.searchParams.set("token_hash", alterado);

  await verificarCaeComoEnlaceCaducado(browser, url.toString());
});
