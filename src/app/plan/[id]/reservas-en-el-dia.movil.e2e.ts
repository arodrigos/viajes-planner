import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { horaDeMinutos, minutosDeHora } from "@/lib/plan/tiempos";
import type { Plan } from "@/lib/plan/tipos";
import { capturar } from "@/test-utils/capturas";
import { FRANJAS, iniciarSesion, parada, sembrarPlanDeUsuario } from "./orden-e2e";

// res-dia-ac1..ac5 (uat-11, uat-12, uat-13): las reservas como elementos fijos
// del día contra la ruta, la base y el navegador reales. Las reservas se dan de
// alta por la API del dueño; el invitado entra con su propia sesión.
const DUENYO = "ci-test-reservas-dia-duenyo@example.com";
const INVITADO = "ci-test-reservas-dia-invitado@example.com";
const TAMANOS = [360, 820, 1180].map((ancho) => ({ ancho, alto: ancho === 360 ? 640 : ancho === 820 ? 1180 : 820 }));
const SECRETOS = ["ABC123", "Hotel Sole", "Galería Borghese", "MAD → FCO", "FCO", "Sales de"];

// La entrada pisa la primera parada de la mañana a media hora de empezar.
const MANANA = FRANJAS.find((f) => f.id === "manana")!;
const HORA_ENTRADA = horaDeMinutos(minutosDeHora(MANANA.hora_inicio) + 30);

async function enTresTamanos(pagina: Page, nombre: string) {
  for (const t of TAMANOS) {
    await pagina.setViewportSize({ width: t.ancho, height: t.alto });
    // Si desborda, el mensaje dice qué elemento se sale y a qué tamaño.
    const anchos = await pagina.evaluate(() => ({
      pantalla: window.innerWidth,
      pagina: document.documentElement.scrollWidth,
      anchos: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`),
    }));
    expect(anchos.pagina, `${nombre} a ${t.ancho}: ${JSON.stringify(anchos)}`).toBeLessThanOrEqual(anchos.pantalla);
    await capturar(pagina, "reservas-en-el-dia", `${nombre}-${t.ancho}`);
  }
  await pagina.setViewportSize({ width: 360, height: 640 });
}

async function versionMaxima(supabase: SupabaseClient, planId: string): Promise<number> {
  const { data } = await supabase.from("plan_versiones").select("version").eq("plan_id", planId).order("version", { ascending: false }).limit(1).single();
  return data?.version ?? 0;
}

test.describe("reservas en el día", () => {
  test.describe.configure({ mode: "serial" });
  const supabase = clienteDePrueba("servicio");
  const planId = `plan-res-dia-${Date.now()}`;
  let contextoDuenyo: BrowserContext;
  let contextoInvitado: BrowserContext;
  let duenyo: Page;
  let invitado: Page;

  test.beforeAll(async ({ browser }) => {
    const plan: Plan = {
      id: planId,
      version: 1,
      destino: "Granada",
      personas: 2,
      dias: [
        { fecha: "2027-06-10", franjas: FRANJAS, paradas: [parada("d1a", "Alhambra", "manana", 0)] },
        {
          fecha: "2027-06-11",
          franjas: FRANJAS,
          paradas: [parada("d2a", "Paseo del Salón", "manana", 1), parada("d2b", "Mirador de San Nicolás", "manana", 2), parada("d2c", "Sacromonte", "tarde", 3), parada("d2d", "Corral del Carbón", "tarde", 4)],
        },
      ],
    };
    await sembrarPlanDeUsuario(supabase, DUENYO, plan);
    const { data: lista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (!lista?.users.some((u) => u.email === INVITADO)) await supabase.auth.admin.createUser({ email: INVITADO, email_confirm: true });

    contextoDuenyo = await browser.newContext({ viewport: { width: 360, height: 640 } });
    contextoInvitado = await browser.newContext({ viewport: { width: 360, height: 640 } });
    await iniciarSesion(contextoDuenyo, DUENYO);
    await iniciarSesion(contextoInvitado, INVITADO);
    duenyo = await contextoDuenyo.newPage();
    invitado = await contextoInvitado.newPage();

    const reservas = [
      { tipo: "vuelo", sentido: "ida", fecha_inicio: "2027-06-10", hora_inicio: "08:00", zona_inicio: "Europe/Madrid", fecha_fin: "2027-06-10", hora_fin: "13:00", zona_fin: "Europe/Rome", origen: "MAD", destino: "FCO", localizador: "ABC123" },
      { tipo: "hotel", fecha_inicio: "2027-06-10", fecha_fin: "2027-06-12", nombre: "Hotel Sole", ubicacion: { lat: 37.17, lon: -3.59 } },
      { tipo: "entrada", fecha_inicio: "2027-06-11", hora_inicio: HORA_ENTRADA, nombre: "Galería Borghese" },
    ];
    for (const r of reservas) expect((await contextoDuenyo.request.post(`/api/plan/${planId}/reservas`, { data: r })).ok()).toBe(true);
    const invitacion = await contextoDuenyo.request.post(`/api/plan/${planId}/miembros`, { data: { correo: INVITADO } });
    expect(invitacion.ok()).toBe(true);
  });

  test.afterAll(async () => {
    await contextoDuenyo?.close();
    await contextoInvitado?.close();
  });

  test("guardar la entrada no mueve la parada: sigue donde estaba con su conflicto, y arreglarlo lo quita (res-dia-ac2, uat-12)", async () => {
    // Las tres reservas están guardadas y el plan sigue en su versión 1.
    expect(await versionMaxima(supabase, planId)).toBe(1);
    await duenyo.goto(`/plan/${planId}?dia=2`);
    const primera = duenyo.locator("li.tarjeta-parada").filter({ hasText: "Paseo del Salón" });
    await expect(primera).toBeVisible();
    await expect(primera.getByTestId("conflicto-parada")).toContainText(`Choca con tu entrada de las ${HORA_ENTRADA}`);
    await expect(duenyo.getByTestId("contador-conflictos")).toHaveText("1 conflicto");
    await enTresTamanos(duenyo, "conflicto-dia2");

    await primera.getByTestId("arreglar-parada").click();
    const hoja = duenyo.getByTestId("hoja-arreglos");
    await expect(hoja).toBeVisible();
    await hoja.getByTestId(/^arreglo-(otra-franja|otro-dia)$/).first().click();
    await expect(duenyo.getByTestId("aviso-arreglo")).toBeVisible();
    await expect(duenyo.getByTestId("contador-conflictos")).toHaveCount(0);
    await expect.poll(() => versionMaxima(supabase, planId)).toBe(2);
    await enTresTamanos(duenyo, "arreglado-dia2");
    // Recargar confirma que lo guardado tampoco choca.
    await duenyo.reload();
    await expect(duenyo.getByTestId("tarjeta-reserva").first()).toBeVisible();
    await expect(duenyo.getByTestId("contador-conflictos")).toHaveCount(0);
  });

  test("las reservas salen fijas en su día y Optimizar orden no las mueve (res-dia-ac1, res-dia-ac3, uat-11)", async () => {
    await duenyo.goto(`/plan/${planId}?dia=1`);
    const llegada = duenyo.getByTestId("tarjeta-reserva").filter({ hasText: "Llegada · 13:00" });
    await expect(llegada).toBeVisible();
    await expect(llegada).toContainText("MAD → FCO");
    await expect(llegada.getByRole("button")).toHaveCount(0);
    await expect(duenyo.getByTestId("sales-de")).toHaveText("Sales de: Hotel Sole");
    await expect(duenyo.getByTestId("tarjeta-reserva").filter({ hasText: "Hotel" }).first()).toBeVisible();
    await enTresTamanos(duenyo, "llegada-dia1");

    await duenyo.goto(`/plan/${planId}?dia=2`);
    const posicion = async () => (await duenyo.locator("li.tarjeta-parada").allInnerTexts()).findIndex((t) => t.includes("Entrada"));
    const antes = await posicion();
    expect(antes).toBeGreaterThanOrEqual(0);
    await expect(duenyo.getByTestId("tarjeta-reserva")).toContainText(`Entrada · ${HORA_ENTRADA}`);
    await duenyo.getByRole("button", { name: "Optimizar orden" }).click();
    await expect(duenyo.locator(".aviso-orden")).toBeVisible();
    expect(await posicion()).toBe(antes);
    await expect(duenyo.getByTestId("tarjeta-reserva")).toContainText(`Entrada · ${HORA_ENTRADA}`);
    await enTresTamanos(duenyo, "optimizado-dia2");
  });

  test("el invitado ve el tipo y la hora y nada más (res-dia-ac5, uat-13)", async () => {
    const respuesta = await invitado.request.get(`/api/plan/${planId}`);
    expect(respuesta.ok()).toBe(true);
    const cuerpo = await respuesta.text();
    for (const secreto of SECRETOS) expect(cuerpo).not.toContain(secreto);

    await invitado.goto(`/plan/${planId}?dia=1`);
    await expect(invitado.getByTestId("solo-lectura")).toBeVisible();
    await expect(invitado.getByTestId("tarjeta-reserva").filter({ hasText: "Llegada · 13:00" })).toBeVisible();
    await expect(invitado.getByTestId("tarjeta-reserva").filter({ hasText: /^.*Hotel/ })).toBeVisible();
    await expect(invitado.getByRole("button", { name: /arreglar/i })).toHaveCount(0);
    for (const secreto of SECRETOS) expect(await invitado.content()).not.toContain(secreto);
    await enTresTamanos(invitado, "invitado-dia1");

    await invitado.goto(`/plan/${planId}?dia=2`);
    await expect(invitado.getByTestId("tarjeta-reserva")).toContainText(`Entrada · ${HORA_ENTRADA}`);
    for (const secreto of SECRETOS) expect(await invitado.content()).not.toContain(secreto);
    await expect(invitado.getByText("Reservas", { exact: true })).toHaveCount(0);
    await enTresTamanos(invitado, "invitado-dia2");
  });
});
