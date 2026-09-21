import { expect, test, type BrowserContext } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { LIMITE_TRABAJOS_POR_HORA } from "@/lib/cola/config";

const EMAIL = "ci-test-acceso-ac6c@example.com";

// Distinguibles de CRITERIOS_INICIALES (FormularioCriterios.tsx): si
// cualquiera de estos valores sobreviviera por casualidad -por ejemplo un
// campo que no se hubiera limpiado desde una prueba anterior- se notaría,
// en vez de que un `5` de sobra pasara por el `5` inicial de `dias`.
const DESTINO = "Kioto";
const EPOCA = "invierno";
const DIAS = 12;
const PRESUPUESTO = 2500;
const EDAD = 45;

const PATRON_MENSAJE_DE_SISTEMA = /\b[45]\d\d\b|undefined|null|\[object|Error:/;

// Sesión real vía las dos peticiones del canje de código (bloque
// codigo-en-la-misma-pantalla): `contexto.request` comparte el almacén de
// cookies con `contexto.newPage()`, así que las que deposite
// verificar-codigo quedan disponibles para la navegación de verdad que
// sigue -sin pasar por ningún enlace, porque ya no existe ninguno.
async function obtenerSesionReal(contexto: BrowserContext, email: string): Promise<void> {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

// acceso-ac6c-prueba: el 429 se provoca sembrando trabajos reales en vez
// de esperar a que el usuario agote el límite por su cuenta, para que sea
// determinista y no dependa de ninguna variable de entorno del servidor ni
// del orden de los tests.
test("el envío que choca con el límite por hora conserva lo escrito tras recargar", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const usuarioId = usuario.user.id;

  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();

  // Sesión real: se pide el código, se lee de Mailpit y se canjea. El
  // objetivo de este test es el límite por hora, no el recorrido de acceso
  // en sí (ya cubierto por pantalla-ac5), así que se navega directo a
  // /criterios con la sesión ya puesta.
  await obtenerSesionReal(contexto, EMAIL);
  await pagina.goto("/criterios");

  // El 429 es determinista: se siembra exactamente el límite antes de
  // escribir nada, con `creado_en` implícito en la ventana (por defecto,
  // el momento de la inserción).
  const filas = Array.from({ length: LIMITE_TRABAJOS_POR_HORA }, () => ({ usuario_id: usuarioId, tipo: "generacion" as const }));
  const { error: errorSiembra } = await supabase.from("trabajos").insert(filas);
  if (errorSiembra) throw new Error(`No se pudieron sembrar los trabajos de prueba: ${errorSiembra.message}`);

  await pagina.getByLabel("Destino o tipo de viaje").fill(DESTINO);
  await pagina.getByLabel("Época del año", { exact: true }).fill(EPOCA);
  await pagina.getByLabel("Número de días").fill(String(DIAS));
  await pagina.getByLabel("Presupuesto total (€)").fill(String(PRESUPUESTO));
  await pagina.getByLabel("Persona 1, edad").fill(String(EDAD));

  // (i) la respuesta real de POST /api/plan observada en la red es 429.
  const [respuestaPlan] = await Promise.all([
    pagina.waitForResponse((r) => r.url().endsWith("/api/plan") && r.request().method() === "POST"),
    pagina.getByRole("button", { name: "Continuar" }).click(),
  ]);
  expect(respuestaPlan.status()).toBe(429);

  // (ii) mensaje visible que nombra el límite por hora y dice que lo
  // escrito no se pierde, sin código de estado ni jerga. El filtro por
  // texto descarta el otro role="alert" que Next.js inyecta siempre (el
  // route announcer), que si no haría fallar en modo estricto.
  const aviso = pagina.getByRole("alert").filter({ hasText: /límite/ });
  await expect(aviso).toBeVisible();
  const textoAviso = (await aviso.textContent()) ?? "";
  expect(textoAviso).toMatch(/límite/i);
  expect(textoAviso).toMatch(/hora/i);
  expect(textoAviso).not.toMatch(PATRON_MENSAJE_DE_SISTEMA);

  // (iii) LA PARTE QUE PRUEBA LA SUPERVIVENCIA: se recarga la página y los
  // cinco campos vuelven con exactamente los valores escritos.
  await pagina.reload();
  await expect(pagina.getByLabel("Destino o tipo de viaje")).toHaveValue(DESTINO);
  await expect(pagina.getByLabel("Época del año", { exact: true })).toHaveValue(EPOCA);
  await expect(pagina.getByLabel("Número de días")).toHaveValue(String(DIAS));
  await expect(pagina.getByLabel("Presupuesto total (€)")).toHaveValue(String(PRESUPUESTO));
  await expect(pagina.getByLabel("Persona 1, edad")).toHaveValue(String(EDAD));

  // (iv) no se ha encolado ninguna fila nueva.
  const { count, error: errorConteo } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);
  if (errorConteo) throw new Error(`No se pudo contar los trabajos: ${errorConteo.message}`);
  expect(count).toBe(LIMITE_TRABAJOS_POR_HORA);

  await contexto.close();
});
