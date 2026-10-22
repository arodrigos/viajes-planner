import { expect, test, type Page } from "@playwright/test";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Plan } from "@/lib/plan/tipos";
import { capturar } from "@/test-utils/capturas";
import { FRANJAS, iniciarSesion, parada } from "./orden-e2e";
import { sembrarPlan } from "./semillas-e2e";

// inv-ac5: al retirar el acceso, la copia offline del invitado se borra en la
// primera carga con red, así que después sin red ya no hay itinerario que ver.
test.use({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });

// Correos propios y no los de compartir.movil.e2e.ts: con el mismo correo, dos
// specs en paralelo se pisan el código de acceso (límite de envíos de Auth).
const DUENYO = "ci-test-acceso-retirado-duenyo@example.com";
const MIEMBRO = "ci-test-acceso-retirado-miembro@example.com";

async function claves(pagina: Page, cache: string): Promise<string[]> {
  return pagina.evaluate(async (nombre) => ((await caches.has(nombre)) ? (await (await caches.open(nombre)).keys()).map((r) => r.url) : []), cache);
}

test("al retirar el acceso, la copia guardada se borra y sin red no queda itinerario (inv-ac5)", async ({ browser }) => {
  test.setTimeout(180_000);
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: DUENYO, email_confirm: true });
  let duenyoId = usuario?.user?.id;
  if (!duenyoId) {
    const { data: lista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    duenyoId = lista?.users.find((u) => u.email === DUENYO)?.id;
    if (!duenyoId) throw new Error(`No se pudo crear el dueño de prueba: ${error?.message}`);
  }
  const planId = `plan-retirado-${Date.now()}`;
  const otroId = `plan-retirado-otro-${Date.now()}`;
  const plan = (id: string, destino: string): Plan => ({
    id,
    version: 1,
    destino,
    personas: 2,
    etapas: [{ ciudad: { estado: "resuelta", nombre: destino, intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 0, alojamiento_noche_eur: 100, zona: 0, ajustes: [] }],
    dias: [{ fecha: "2027-06-09", etapa: 0, franjas: FRANJAS, paradas: [parada(`${id}-a`, "Alhambra", "manana", 0), parada(`${id}-b`, "Mirador", "tarde", 1)] }],
  });
  for (const p of [plan(planId, "Granada"), plan(otroId, "Sevilla")]) {
    await sembrarPlan(supabase, p);
    const { error: errorTrabajo } = await supabase
      .from("trabajos")
      .insert({ usuario_id: duenyoId, tipo: "generacion", criterios: { destino_o_tipo: p.destino, presupuesto_eur: 4000 }, estado: "completado", plan_id: p.id });
    if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);
  }

  const contextoDuenyo = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const contextoMiembro = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "allow" });
  try {
    await iniciarSesion(contextoDuenyo, DUENYO);
    await iniciarSesion(contextoMiembro, MIEMBRO);
    const invitar = await contextoDuenyo.request.post(`/api/plan/${planId}/miembros`, { data: { correo: MIEMBRO } });
    expect(invitar.status()).toBe(201);
    const miembroId = ((await invitar.json()) as { id: string }).id;

    const pagina = await contextoMiembro.newPage();
    await pagina.goto(`/plan/${planId}`);
    await expect(pagina.getByTestId("solo-lectura")).toBeVisible();
    await pagina.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((resolver) => navigator.serviceWorker.addEventListener("controllerchange", () => resolver(), { once: true }));
    });
    // Una copia de otro plan del mismo navegador, que no debe tocarse.
    await pagina.evaluate(async (id) => {
      await (await caches.open("viajes-datos")).put(`/api/plan/${id}`, new Response("{}"));
    }, otroId);
    await pagina.goto(`/plan/${planId}`);
    await expect.poll(async () => (await claves(pagina, "viajes-datos")).some((u) => u.endsWith(`/api/plan/${planId}`)), { timeout: 30_000 }).toBe(true);

    const quitar = await contextoDuenyo.request.delete(`/api/plan/${planId}/miembros/${miembroId}`);
    expect(quitar.status()).toBe(204);

    await pagina.goto(`/plan/${planId}`);
    await expect(pagina.getByTestId("acceso-retirado")).toHaveText("Ya no tienes acceso a este plan. Quien lo creó ha dejado de compartirlo.");
    await expect.poll(async () => (await claves(pagina, "viajes-datos")).some((u) => u.includes(planId))).toBe(false);
    expect((await claves(pagina, "viajes-datos")).some((u) => u.endsWith(`/api/plan/${otroId}`))).toBe(true);

    await contextoMiembro.setOffline(true);
    try {
      await pagina.goto(`/plan/${planId}`).catch(() => undefined);
      await expect(pagina.locator("li.tarjeta-parada")).toHaveCount(0);
      await expect(pagina.getByText("Estás viendo la copia guardada")).toHaveCount(0);
      await expect(pagina.getByText("Alhambra")).toHaveCount(0);
      await capturar(pagina, "acceso-retirado-sin-red", "acceso-retirado-sin-red", { fullPage: false });
    } finally {
      await contextoMiembro.setOffline(false);
    }
  } finally {
    await contextoDuenyo.close();
    await contextoMiembro.close();
  }
});
