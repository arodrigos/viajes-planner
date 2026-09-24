import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// contraste-ac1: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-contraste-eliminar@example.com";
const DESTINO = "Bilbao";

// Siembra directa con la clave de servicio -mismo motivo ya documentado en
// peso-visual.movil.e2e.ts y eliminar.movil.e2e.ts-: un plan mínimo basta,
// lo que prueba este bloque es el contraste del botón, no el plan.
async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

// Misma fórmula WCAG 2.1 que contraste-peligro.test.ts (tok-ac1/contraste-ac4),
// pero aquí sobre RGB -lo que devuelve `getComputedStyle` en el navegador-,
// nunca sobre los literales hexadecimales de globals.css: contraste-ac1 mide
// el botón realmente renderizado, no un valor copiado a mano.
function srgbALineal(canal: number): number {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanciaRelativa([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbALineal(r) + 0.7152 * srgbALineal(g) + 0.0722 * srgbALineal(b);
}

function ratioDeContraste(a: [number, number, number], b: [number, number, number]): number {
  const lA = luminanciaRelativa(a);
  const lB = luminanciaRelativa(b);
  const claro = Math.max(lA, lB);
  const oscuro = Math.min(lA, lB);
  return (claro + 0.05) / (oscuro + 0.05);
}

function rgbATripla(rgb: string): [number, number, number] {
  const coincidencia = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!coincidencia) throw new Error(`No se pudo interpretar el color computado: ${rgb}`);
  return [Number(coincidencia[1]), Number(coincidencia[2]), Number(coincidencia[3])];
}

test("contraste: el texto de «Eliminar» alcanza 4.5:1 en claro y en oscuro, medido sobre el botón realmente renderizado (contraste-ac1)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const planId = `plan-contraste-eliminar-${marca}`;

  const { data: usuario, error: errorUsuario } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (errorUsuario || !usuario.user) throw new Error(`No se pudo crear el usuario: ${errorUsuario?.message}`);

  await sembrarPlanMinimo(supabase, planId, DESTINO);
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({
    usuario_id: usuario.user.id,
    tipo: "generacion",
    criterios: { destino_o_tipo: DESTINO },
    estado: "completado",
    plan_id: planId,
  });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto("/viajes");
  await expect(pagina.getByText(DESTINO)).toBeVisible();
  const boton = pagina.getByRole("button", { name: "Eliminar" });

  for (const modo of ["light", "dark"] as const) {
    await pagina.emulateMedia({ colorScheme: modo });
    const { color, backgroundColor } = await boton.evaluate((el) => {
      const estilo = getComputedStyle(el);
      return { color: estilo.color, backgroundColor: estilo.backgroundColor };
    });
    const ratio = ratioDeContraste(rgbATripla(color), rgbATripla(backgroundColor));
    expect(ratio, `${modo}: ratio de «Eliminar» (color ${color} sobre fondo ${backgroundColor})`).toBeGreaterThanOrEqual(4.5);
  }

  await contexto.close();
});
