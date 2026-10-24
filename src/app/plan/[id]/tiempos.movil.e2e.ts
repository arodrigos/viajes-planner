import { expect, test, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// tie-ac9: lo que se ve en pantalla (conector, rango de la tarjeta y «sal a las»
// de «Ahora») sale del mismo cálculo. «Ahora» lo fija page.clock.
test.use({ viewport: { width: 390, height: 844 } });

const RESUELTO_EN = new Date("2026-10-04").toISOString();
const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
];

// A 09:00–10:30; 1 km en línea recta a pie (≈ 20 min); B 60 min; 3 km en
// transporte (≈ 25 min); C 30 min.
const PARADAS = [
  { id: "a", nombre: "Primera (ejemplo)", dLat: 0, duracion: 90 },
  { id: "b", nombre: "Segunda (ejemplo)", dLat: 0.009, duracion: 60 },
  { id: "c", nombre: "Tercera (ejemplo)", dLat: 0.036, duracion: 30 },
];

async function sembrar(supabase: SupabaseClient, email: string, sufijo: string, horaFin: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-tie-${sufijo}-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: horaFin }];
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
      id_externo: `p-tie-${p.id}-${sufijo}`,
      plan_version_id: version.id,
      dia_index: 1,
      franja_id: "manana",
      nombre: p.nombre,
      descripcion: "Visita guiada",
      lat: 38.7139 + p.dLat,
      lon: -9.1394,
      duracion_min: p.duracion,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: { fuente: "osm", id: `osm:way/${p.id}-${sufijo}`, url: `https://www.openstreetmap.org/way/${p.id}`, nombre_fuente: p.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
      resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${p.id}': ${errorParada.message}`);
  }
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({
    usuario_id: usuario.user.id,
    tipo: "generacion",
    criterios: { perfil: "amigos", transporte: ["transporte-publico"] },
    estado: "completado",
    plan_id: planId,
  });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

// Las 10:00 en Lisboa (junio: UTC+1), con la primera parada ya marcada.
async function abrir(browser: Browser, email: string, planId: string) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Lisbon" });
  const pagina = await contexto.newPage();
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } });
  expect(verificacion.ok()).toBe(true);
  await pagina.clock.install({ time: new Date(Date.UTC(2027, 5, 9, 9, 0, 10)) });
  await pagina.goto(`/plan/${planId}`);
  const ahora = pagina.getByRole("region", { name: "Ahora" });
  await ahora.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(ahora).toContainText("1 de 3 visitadas");
  return { contexto, pagina, ahora };
}

async function capturarEnTodosLosTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await capturar(pagina, "tiempos-unicos", `${nombre}-${t.ancho}`);
  }
}

test("conector, rango y «sal a las» cuentan los mismos minutos (tie-ac9)", async ({ browser }) => {
  const email = "ci-test-tie-ac9@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "a", "13:00");
  const { contexto, pagina, ahora } = await abrir(browser, email, planId);

  const conectores = pagina.getByTestId("tramo-parada");
  await expect(conectores.nth(0)).toContainText("≈ 20 min");
  await expect(conectores.nth(0)).toContainText("A pie");
  await expect(conectores.nth(1)).toContainText("≈ 25 min");
  await expect(conectores.nth(1)).toContainText("Transporte público");
  await expect(pagina.getByText("10:50 – 11:50")).toBeVisible();
  await expect(pagina.getByText("12:15 – 12:45")).toBeVisible();
  await expect(ahora).toContainText("Sal antes de las 10:30 para llegar a las 10:50 (≈ 20 min a pie)");
  await expect(pagina.getByText(/Se pasa \d+ min/)).toHaveCount(0);
  await comprobarAccesibilidad(pagina);

  await conectores.nth(0).scrollIntoViewIfNeeded();
  await capturarEnTodosLosTamanos(pagina, "conector-y-rango");
  await ahora.scrollIntoViewIfNeeded();
  await capturarEnTodosLosTamanos(pagina, "ahora-salida");
  await contexto.close();
});

test("la parada que no cabe conserva su duración y avisa (tie-ac9)", async ({ browser }) => {
  const email = "ci-test-tie-ac9-limite@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email, "b", "12:00");
  const { contexto, pagina } = await abrir(browser, email, planId);

  await expect(pagina.getByText("12:15 – 12:45")).toBeVisible();
  const aviso = pagina.getByText("Se pasa 45 min del final de la mañana");
  await expect(aviso).toBeVisible();
  await aviso.scrollIntoViewIfNeeded();
  await capturarEnTodosLosTamanos(pagina, "recortada");
  await contexto.close();
});
