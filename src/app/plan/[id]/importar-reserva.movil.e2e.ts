import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comprobarAccesibilidad } from "@/app/axe-e2e";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { capturar } from "@/test-utils/capturas";

// imp-ac1..imp-ac5, imp-ac7, imp-ac10 (uat u1..u6): importar una reserva desde
// un .ics, de punta a punta, con el archivo real elegido en el selector.
test.use({ viewport: { width: 390, height: 844 } });

const FIXTURES = path.resolve(process.cwd(), "src/lib/reservas/importar/__fixtures__");
const fixture = (nombre: string) => ({ name: nombre, mimeType: nombre.endsWith(".ics") ? "text/calendar" : "text/plain", buffer: readFileSync(path.join(FIXTURES, nombre)) });
const TAMANOS = [
  { ancho: 360, alto: 640 },
  { ancho: 390, alto: 844 },
  { ancho: 820, alto: 1180 },
  { ancho: 1180, alto: 820 },
  { ancho: 1280, alto: 800 },
];

async function sembrar(supabase: SupabaseClient, email: string) {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-ics-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Roma" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
  const dias = Array.from({ length: 7 }, (_, i) => ({ fecha: `2027-07-0${3 + i}`, franjas }));
  const { error: errorVersion } = await supabase.from("plan_versiones").insert({ plan_id: planId, version: 1, personas: 2, dias, avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión: ${errorVersion.message}`);
  const { error: errorTrabajo } = await supabase.from("trabajos").insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "amigos" }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

async function entrar(contexto: BrowserContext, email: string) {
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } })).ok()).toBe(true);
}

async function enTodosLosTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    await pagina.mouse.move(-1, -1);
    await capturar(pagina, "ics-importar", `${nombre}-${t.ancho}`);
  }
  await pagina.setViewportSize({ width: 390, height: 844 });
}

async function abrirReservas(pagina: Page, planId: string) {
  await pagina.goto(`/plan/${planId}`);
  await pagina.getByText("Reservas", { exact: true }).click();
}

test("hotel de punta a punta: marcas, zonas y nada se guarda hasta Guardar (imp-ac1, imp-ac3, imp-ac5)", async ({ browser }) => {
  const email = "ci-test-importar-ics@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/reservas")) posts.push(r.url());
  });
  await entrar(contexto, email);
  await abrirReservas(pagina, planId);

  // u1: el botón, su ayuda y el aviso de privacidad
  const boton = pagina.getByRole("button", { name: "Importar desde archivo" });
  await expect(boton).toBeVisible();
  expect((await boton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(pagina.getByText("En iPhone, guárdalo antes en Archivos", { exact: false })).toBeVisible();
  await expect(pagina.getByText("El archivo se lee en tu móvil y no se sube")).toBeVisible();
  await expect(pagina.getByTestId("importar-archivo")).toHaveAttribute("accept", ".ics,text/calendar");
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "boton");

  // teclado: Tab llega al botón y Enter abre el selector de archivos
  await pagina.getByRole("button", { name: "Apuntar reserva" }).focus();
  await pagina.keyboard.press("Tab");
  await expect(boton).toBeFocused();
  const [selector] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.keyboard.press("Enter")]);
  await selector.setFiles(fixture("hotel-booking.ics"));

  // u2: formulario rellenado y marcado
  await expect(pagina.getByText("Rellenado desde el archivo", { exact: false })).toBeVisible();
  await expect(pagina.getByLabel("Nombre del hotel")).toHaveValue("Hotel Arco Sereno");
  await expect(pagina.getByLabel("Día de entrada")).toHaveValue("2027-07-03");
  await expect(pagina.getByLabel("Día de salida")).toHaveValue("2027-07-09");
  await expect(pagina.getByText("Falta: complétalo").first()).toBeVisible();
  await expect(pagina.getByText("Sugerido: revísalo").first()).toBeVisible();
  expect(posts).toHaveLength(0);
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "hotel-revisar");
  await pagina.emulateMedia({ colorScheme: "dark" });
  await comprobarAccesibilidad(pagina);
  await capturar(pagina, "ics-importar", "hotel-revisar-oscuro");
  await pagina.emulateMedia({ colorScheme: "light" });

  // u3: al guardar sale una sola petición y la reserva queda tras recargar
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await expect(pagina.getByTestId("reserva")).toHaveCount(1);
  expect(posts).toHaveLength(1);
  await pagina.reload();
  await pagina.getByText("Reservas", { exact: true }).click();
  await expect(pagina.getByTestId("reserva")).toContainText("Hotel Arco Sereno");
  await enTodosLosTamanos(pagina, "hotel-guardado");
  await contexto.close();
});

test("varios eventos: lista, «siguiente (n de N)» y cero peticiones hasta Guardar (imp-ac2, imp-ac3)", async ({ browser }) => {
  const email = "ci-test-importar-ics-invitado@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  const posts: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/reservas")) posts.push(r.url());
  });
  await entrar(contexto, email);
  await abrirReservas(pagina, planId);

  await pagina.getByTestId("importar-archivo").setInputFiles(fixture("vuelo-ida-vuelta.ics"));
  await expect(pagina.getByText("Este archivo trae 2 reservas")).toBeVisible();
  await expect(pagina.getByTestId("evento-ics")).toHaveCount(2);
  await expect(pagina.getByTestId("evento-ics").first()).toContainText("hora de Madrid");
  expect(posts).toHaveLength(0);
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "lista-eventos");

  await pagina.getByTestId("evento-ics").first().getByRole("button", { name: "Usar esta" }).click();
  await expect(pagina.getByText("Zona de salida:", { exact: false })).toBeVisible();
  await expect(pagina.getByText("Falta: complétalo").first()).toBeVisible();
  expect(posts).toHaveLength(0);
  await enTodosLosTamanos(pagina, "vuelo-revisar");
  await pagina.getByLabel("Sentido").selectOption({ index: 1 });
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await expect(pagina.getByTestId("importar-aviso")).toContainText("Importar la siguiente del archivo (2 de 2)");
  await enTodosLosTamanos(pagina, "siguiente");
  await contexto.close();
});

test("errores claros sin romper la página, y el título hostil no ejecuta nada (imp-ac4)", async ({ browser }) => {
  const email = "ci-test-importar-ics-errores@example.com";
  const planId = await sembrar(clienteDePrueba("servicio"), email);
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  await entrar(contexto, email);
  await abrirReservas(pagina, planId);
  const entrada = pagina.getByTestId("importar-archivo");

  await entrada.setInputFiles(fixture("no-es-ics.txt"));
  await expect(pagina.getByTestId("importar-error")).toContainText("Este archivo no es un calendario (.ics)");
  await comprobarAccesibilidad(pagina);
  await enTodosLosTamanos(pagina, "error-no-es-ics");

  const veintiuno = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//e2e//ES"];
  for (let i = 0; i < 21; i++) veintiuno.push("BEGIN:VEVENT", `UID:e${i}@e2e`, "DTSTAMP:20270101T000000Z", `DTSTART;VALUE=DATE:2027070${(i % 6) + 3}`, `SUMMARY:Evento ${i}`, "END:VEVENT");
  veintiuno.push("END:VCALENDAR");
  await entrada.setInputFiles({ name: "agenda.ics", mimeType: "text/calendar", buffer: Buffer.from(veintiuno.join("\r\n")) });
  await expect(pagina.getByTestId("importar-error")).toContainText("más de 20 eventos");

  const hostil = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//e2e//ES", "BEGIN:VEVENT", "UID:x@e2e", "DTSTAMP:20270101T000000Z", "DTSTART;VALUE=DATE:20270705", "SUMMARY:Hotel <img src=x onerror=window.__xss=1>", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  await entrada.setInputFiles({ name: "hostil.ics", mimeType: "text/calendar", buffer: Buffer.from(hostil) });
  await expect(pagina.getByText("Rellenado desde el archivo", { exact: false })).toBeVisible();
  expect(await pagina.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await pagina.locator("img[src='x']").count()).toBe(0);
  await contexto.close();
});
