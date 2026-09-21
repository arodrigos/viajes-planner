import { expect, test } from "@playwright/test";
import { leerEnlaceMagico } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const EMAIL = "ci-test-acceso-ac6b@example.com";

// UUID bien formado pero que no existe en `trabajos` (como en confirm.e2e.ts):
// un trabajo ajeno-inexistente responde 404, y solo un 404 (no un 401)
// confirma que hay sesión real.
const ID_TRABAJO_INEXISTENTE = "00000000-0000-0000-0000-000000000000";

// Mismo patrón que los mensajes de PanelAcceso/FormularioCriterios: un
// aviso legible no puede filtrar un código de estado ni jerga de sistema.
const PATRON_MENSAJE_DE_SISTEMA = /\b[45]\d\d\b|undefined|null|\[object|Error:/;

async function contarTrabajos(supabase: ReturnType<typeof clienteDePrueba>, usuarioId: string): Promise<number> {
  const { count, error } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);
  if (error) throw new Error(`No se pudo contar los trabajos: ${error.message}`);
  return count ?? 0;
}

// acceso-ac6b-prueba: reproduce el caso real -enlace abierto en un
// navegador sin el borrador, como la vista web aislada del cliente de
// correo del móvil- con DOS BrowserContext reales que no comparten
// almacenamiento, en vez de simular la ausencia de localStorage.
test("confirmar sin borrador en ese navegador avisa explícitamente y no encola nada", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const usuarioId = usuario.user.id;

  // Contexto A: el navegador donde se escriben los criterios -el borrador
  // se guarda en su localStorage con cada cambio, sin necesidad de enviar
  // el formulario.
  const contextoA = await browser.newContext();
  const paginaA = await contextoA.newPage();
  await paginaA.goto("/criterios");
  await paginaA.getByLabel("Destino o tipo de viaje").fill("Oporto");
  await paginaA.getByLabel("Época del año", { exact: true }).fill("otoño");

  const respuestaSolicitud = await contextoA.request.post("/api/acceso/solicitar-enlace", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const enlace = await leerEnlaceMagico(EMAIL);

  const filasAntes = await contarTrabajos(supabase, usuarioId);

  // Contexto B: el navegador que confirma el enlace, SIN el localStorage
  // de A -- es exactamente la vista web aislada del cliente de correo.
  const contextoB = await browser.newContext();
  const paginaB = await contextoB.newPage();
  await paginaB.goto(enlace);

  // (i) aviso explícito y legible, nunca un formulario vacío en silencio.
  // El filtro por texto descarta el otro role="alert" que Next.js inyecta
  // siempre (el route announcer), que si no haría fallar en modo estricto.
  const aviso = paginaB.getByRole("alert").filter({ hasText: /otro navegador/ });
  await expect(aviso).toBeVisible();
  const textoAviso = (await aviso.textContent()) ?? "";
  expect(textoAviso.length).toBeGreaterThanOrEqual(60);
  expect(textoAviso).toMatch(/otro navegador/);
  expect(textoAviso).toMatch(/vuelve/i);
  expect(textoAviso).not.toMatch(PATRON_MENSAJE_DE_SISTEMA);

  // (ii) el formulario de criterios NO está presente.
  await expect(paginaB.getByRole("form", { name: "Criterios del viaje" })).toHaveCount(0);

  // (iii) la sesión SÍ se ha creado: esto no es un fallo de acceso.
  const respuestaTrabajo = await contextoB.request.get(`/api/trabajos/${ID_TRABAJO_INEXISTENTE}`);
  expect(respuestaTrabajo.status()).toBe(404);

  // (iv) efecto de negocio: confirmar sin borrador no encola nada.
  const filasDespues = await contarTrabajos(supabase, usuarioId);
  expect(filasDespues).toBe(filasAntes);

  await contextoA.close();
  await contextoB.close();
});
