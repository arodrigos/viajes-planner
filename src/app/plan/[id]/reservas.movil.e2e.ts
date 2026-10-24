import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// res-ac1, res-ac2 (uat-07..uat-10): alta de un vuelo con un error por campo,
// recarga y lista ordenada. Cada paso se captura en los tres tamaños.
test.use({ viewport: { width: 390, height: 844 } });

const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-res-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Roma" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10"].map((fecha) => ({ fecha, franjas }));
  const { data: version, error: errorVersion } = await supabase.from("plan_versiones").insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] }).select("id").single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
  const { error: errorParada } = await supabase.from("paradas").insert({
    id_externo: `p-res-${Date.now()}`,
    plan_version_id: version.id,
    dia_index: 0,
    franja_id: "manana",
    nombre: "Panteón (ejemplo)",
    descripcion: "Visita",
    duracion_min: 60,
    prioridad: 60,
    procedencia_id: procedencia.id,
  });
  if (errorParada) throw new Error(`No se pudo sembrar la parada: ${errorParada.message}`);
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "amigos" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function enTodosLosTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await capturar(pagina, "reservas-datos", `${nombre}-${t.ancho}`);
  }
}

test("vacío, error por campo, alta y recarga de reservas (res-ac1, res-ac2)", async ({ browser }) => {
  const email = "ci-test-reservas@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}`);

  // uat-07
  await pagina.getByText("Reservas", { exact: true }).click();
  await expect(pagina.getByTestId("reservas-vacio")).toContainText("Apunta tus vuelos, trenes, hotel y entradas con hora: saldrán fijos en su día y en el calendario");
  await pagina.getByRole("button", { name: "Apuntar reserva" }).scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "vacio");

  // uat-08
  await pagina.getByRole("button", { name: "Apuntar reserva" }).click();
  await pagina.getByLabel("Origen").fill("MAD");
  await pagina.getByLabel("Destino").fill("FCO");
  await pagina.getByLabel("Día de salida").fill("2027-06-08");
  await pagina.getByLabel("Hora de salida").fill("08:00");
  await pagina.getByLabel("Día de llegada").fill("2027-06-08");
  await pagina.getByLabel("Localizador (opcional)").fill("ABC123");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  const error = pagina.getByText("Falta la hora de llegada: está en tu tarjeta de embarque o en el correo de la reserva");
  await expect(error).toBeVisible();
  await expect(pagina.getByLabel("Origen")).toHaveValue("MAD");
  await comprobarAccesibilidad(pagina);
  await error.scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "error-llegada");

  // uat-09
  await pagina.getByLabel("Hora de llegada").fill("13:00");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  const tarjeta = "Vuelo de ida · MAD → FCO · llega 13:00 · ABC123";
  await expect(pagina.getByText(tarjeta)).toBeVisible();
  await pagina.reload();
  await pagina.getByText("Reservas", { exact: true }).click();
  await expect(pagina.getByText(tarjeta)).toBeVisible();
  await pagina.getByText(tarjeta).scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "vuelo-guardado");

  // uat-10
  await pagina.getByRole("button", { name: "Apuntar reserva" }).click();
  await pagina.getByLabel("Tipo de reserva").selectOption("hotel");
  await pagina.getByLabel("Nombre del hotel").fill("Hotel Sole");
  await pagina.getByLabel("Día de entrada").fill("2027-06-08");
  await pagina.getByLabel("Día de salida").fill("2027-06-10");
  await pagina.getByLabel("…o pega un enlace de mapa o unas coordenadas").fill("41.9028, 12.4964");
  await expect(pagina.getByText("Ubicación guardada")).toBeVisible();
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await pagina.getByRole("button", { name: "Apuntar reserva" }).click();
  await pagina.getByLabel("Tipo de reserva").selectOption("entrada");
  await pagina.getByLabel("Nombre de la entrada o visita").fill("Galería Borghese");
  await pagina.getByLabel("Día", { exact: true }).fill("2027-06-09");
  await pagina.getByLabel("Hora", { exact: true }).fill("10:30");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await expect(pagina.getByTestId("reserva")).toHaveCount(3);
  await expect(pagina.getByTestId("reserva").nth(1)).toContainText("Vuelo");
  await expect(pagina.getByTestId("reserva").nth(0)).toContainText("Hotel Sole");
  await expect(pagina.getByTestId("reserva").nth(0)).toContainText("Ubicación guardada");
  await expect(pagina.getByTestId("reserva").nth(2)).toContainText("Galería Borghese");
  await pagina.getByTestId("reserva").nth(0).scrollIntoViewIfNeeded();
  await enTodosLosTamanos(pagina, "tres-reservas");
  await contexto.close();
});
