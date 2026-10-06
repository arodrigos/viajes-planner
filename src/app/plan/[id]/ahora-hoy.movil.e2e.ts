import { expect, test, type BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { urlComoLlegar } from "@/lib/plan/urlComoLlegar";

// hoy-ac1..ac3: la tarjeta «Ahora» contra la API /visitas real. «Hoy» lo fija
// page.clock, no el reloj de la máquina.
test.use({ viewport: { width: 390, height: 844 } });

const DESTINO = "Granada";
const RESUELTO_EN = new Date("2026-10-04").toISOString();
// Día 2 del viaje, 09:30 en Granada (UTC+2 en junio).
const DURANTE = "2027-06-09T07:30:00Z";
const ANTES = "2027-06-01T07:30:00Z";
const PARADAS = [
  { id: "p-ahora-1", nombre: "Alhambra (ejemplo)", franja: "manana", lat: 37.1761, lon: -3.5881 },
  { id: "p-ahora-2", nombre: "Mirador de San Nicolás (ejemplo)", franja: "comida", lat: 37.1793, lon: -3.5903 },
  { id: "p-ahora-3", nombre: "Albaicín (ejemplo)", franja: "tarde", lat: 37.1815, lon: -3.5925 },
];

async function sembrar(supabase: SupabaseClient, email: string, sufijo: string, ubicadas: boolean) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-ahora-${sufijo}-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = franjasComoArray(DESTINO);
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha) => ({ fecha, franjas }));
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  for (const p of PARADAS) {
    const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: `${p.id}-${sufijo}`,
      plan_version_id: version.id,
      dia_index: 1,
      franja_id: p.franja,
      nombre: p.nombre,
      descripcion: "Visita guiada",
      lat: ubicadas ? p.lat : null,
      lon: ubicadas ? p.lon : null,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: ubicadas
        ? { fuente: "osm", id: `osm:way/${p.id}-${sufijo}`, url: `https://www.openstreetmap.org/way/${p.id}`, nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN }
        : null,
      resolucion: ubicadas ? { estado: "resuelta", intentado_en: RESUELTO_EN } : { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ningún candidato aceptable" },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
  }
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function iniciarSesion(contexto: BrowserContext, email: string) {
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(verificacion.ok()).toBe(true);
}

async function abrir(browser: import("@playwright/test").Browser, email: string, planId: string, ahora: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);
  await pagina.clock.install({ time: new Date(ahora) });
  await pagina.goto(`/plan/${planId}`);
  return { contexto, pagina };
}

test("la tarjeta Ahora nombra la siguiente, avanza al marcar y lo guarda (hoy-ac1, hoy-ac3)", async ({ browser }) => {
  const email = "ci-test-ahora@example.com";
  const supabase = clienteDePrueba("servicio");
  const planId = await sembrar(supabase, email, "a", true);
  const { contexto, pagina } = await abrir(browser, email, planId, DURANTE);

  const ahora = pagina.getByRole("region", { name: "Ahora" });
  await expect(ahora).toBeVisible();
  await expect(ahora).toContainText(PARADAS[0].nombre);
  await expect(ahora).toContainText("0 de 3 visitadas");
  await expect(ahora.getByRole("link", { name: "Cómo llegar" })).toHaveCount(0);
  // ah-ac1: cada botón de visita dice a qué parada se refiere.
  await expect(ahora.getByRole("button")).toHaveCount(1);
  await expect(ahora.getByRole("button", { name: `Marcar como visitada: ${PARADAS[0].nombre}`, exact: true })).toHaveCount(1);
  await expect(pagina.getByRole("listitem").filter({ hasText: PARADAS[1].nombre }).getByRole("button", { name: `Marcar como visitada: ${PARADAS[1].nombre}`, exact: true })).toHaveCount(1);
  const nombresBotones = await pagina.getByRole("button", { name: /^Marcar como visitada/ }).evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""));
  for (const texto of nombresBotones) {
    expect(PARADAS.some((p) => texto === `Marcar como visitada: ${p.nombre}`)).toBe(true);
  }
  await comprobarAccesibilidad(pagina);

  await ahora.getByRole("button", { name: `Marcar como visitada: ${PARADAS[0].nombre}`, exact: true }).click();
  await expect(ahora).toContainText(PARADAS[1].nombre);
  await expect(ahora).toContainText("1 de 3 visitadas");
  await expect(ahora.getByRole("link", { name: "Cómo llegar" })).toHaveAttribute("href", urlComoLlegar(PARADAS[0], PARADAS[1]));
  await expect(ahora.getByRole("status")).toContainText(`Ahora toca ${PARADAS[1].nombre}`);
  await comprobarAccesibilidad(pagina);

  await pagina.reload();
  const trasRecargar = pagina.getByRole("region", { name: "Ahora" });
  await expect(trasRecargar).toContainText(PARADAS[1].nombre);
  await expect(trasRecargar).toContainText("1 de 3 visitadas");
  await expect(pagina.getByRole("button", { name: `Visitada ✓: ${PARADAS[0].nombre}`, exact: true })).toHaveAttribute("aria-pressed", "true");

  // Con todas visitadas: sin siguiente y con salida a las recomendaciones.
  await trasRecargar.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(trasRecargar).toContainText(PARADAS[2].nombre);
  await trasRecargar.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(trasRecargar).toContainText("Has visitado todas las paradas de hoy");
  await trasRecargar.getByRole("button", { name: "Ver más sitios recomendados" }).click();
  await expect(pagina.getByRole("heading", { level: 2, name: "Resumen" })).toBeVisible();

  await contexto.close();
});

test("sin paradas ubicadas la tarjeta lo explica y no ofrece el botón (hoy-ac1)", async ({ browser }) => {
  const email = "ci-test-ahora-sin-ubicar@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "b", false);
  const { contexto, pagina } = await abrir(browser, email, planId, DURANTE);

  const ahora = pagina.getByRole("region", { name: "Ahora" });
  await expect(ahora).toContainText("no podemos calcular cómo llegar");
  await expect(ahora.getByRole("button", { name: "Marcar como visitada" })).toHaveCount(0);
  await expect(ahora).toContainText("0 de 3 visitadas");

  await contexto.close();
});

test("antes del viaje no hay tarjeta Ahora ni botones de visita en ningún día (hoy-ac2)", async ({ browser }) => {
  const email = "ci-test-ahora-antes@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "c", true);
  const { contexto, pagina } = await abrir(browser, email, planId, ANTES);

  await expect(pagina.getByRole("heading", { level: 2, name: "Resumen" })).toBeVisible();
  for (const dia of ["1", "2", "3"]) {
    await pagina.goto(`/plan/${planId}?dia=${dia}`);
    await expect(pagina.getByRole("heading", { level: 2, name: new RegExp(`^Día ${dia} · `) })).toBeVisible();
    await expect(pagina.getByRole("region", { name: "Ahora" })).toHaveCount(0);
    await expect(pagina.getByRole("button", { name: "Marcar como visitada" })).toHaveCount(0);
  }

  await contexto.close();
});
