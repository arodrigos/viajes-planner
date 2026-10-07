import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium, type APIRequestContext } from "@playwright/test";
import { DIRECTORIO, RUTA_PLAN, RUTA_SESION, variable } from "./entorno";
import { iniciarSesion } from "./login";

const ESPERA_MAXIMA_MS = 40 * 60_000;
const SONDEO_MS = 30_000;
const DIAS = 10;
const DIAS_DE_ANTELACION = 60;
// Un país entero es lo que el producto trata como viaje de varias ciudades
// (etapas). «Lisboa y Oporto» va por el flujo de una sola ciudad y sus
// paradas no se ubican, así que no sirve para juzgar los casos con etapas.
const DESTINO_PRUEBA = "Portugal";
// El presupuesto por defecto (1.000 €) deja inviable un viaje de 10 días y
// 2 adultos por varias ciudades: el trabajador lo descartaría sin plan.
const PRESUPUESTO_PRUEBA_EUR = 4000;
const MIN_ETAPAS = 2;
const MIN_PARADAS_UBICADAS = 0.5;

function fechaIso(sumarDias: number): string {
  const f = new Date();
  f.setUTCDate(f.getUTCDate() + sumarDias);
  return f.toISOString().slice(0, 10);
}

type PlanPrueba = { etapas?: unknown[]; dias?: Array<{ paradas?: Array<{ coordenadas?: unknown }> }> };

// pv-setup: si el plan generado no sirve para juzgar (sin etapas o con casi
// ninguna parada ubicada), falla aquí una sola vez y con el motivo, en vez de
// dejar que cada caso falle por su lado.
async function comprobarPlanUtil(peticiones: APIRequestContext, planId: string): Promise<void> {
  const r = await peticiones.get(`/api/plan/${planId}`);
  if (!r.ok()) throw new Error(`pv-setup: no se pudo leer el plan generado (HTTP ${r.status()})`);
  const plan = (await r.json()) as PlanPrueba;
  const paradas = (plan.dias ?? []).flatMap((d) => d.paradas ?? []);
  const ubicadas = paradas.filter((p) => p.coordenadas).length;
  const etapas = plan.etapas?.length ?? 0;
  if (etapas < MIN_ETAPAS) throw new Error(`pv-setup: el plan generado tiene ${etapas} etapas y hacen falta ${MIN_ETAPAS}`);
  if (paradas.length === 0 || ubicadas / paradas.length < MIN_PARADAS_UBICADAS) {
    throw new Error(`pv-setup: solo ${ubicadas} de ${paradas.length} paradas ubicadas: el plan no sirve para juzgar los casos`);
  }
}

type Trabajo = { estado: string; plan_id?: string | null };

// ver-ac1: deja la sesión lista para las specs y el plan de prueba generado
// por el trabajador real. Devuelve la función de limpieza que borra el plan
// solo si lo ha creado él (con PLAN_PRUEBA_ID no toca nada).
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const baseURL = variable("URL_OBJETIVO");
  mkdirSync(DIRECTORIO, { recursive: true });

  const navegador = await chromium.launch();
  // La sesión de Vercel (bypass de la protección del preview) viaja en el
  // storageState; las cookies de la app se le suman al canjear el código.
  const contexto = await navegador.newContext({ baseURL, storageState: process.env.VERCEL_SESION || undefined });
  try {
    await iniciarSesion(contexto.request);
    await contexto.storageState({ path: RUTA_SESION });

    const existente = process.env.PLAN_PRUEBA_ID;
    if (existente) {
      const r = await contexto.request.get(`/api/plan/${existente}`);
      if (!r.ok()) throw new Error(`PLAN_PRUEBA_ID no es un plan visible para el usuario de pruebas (HTTP ${r.status()})`);
      return undefined;
    }

    const pagina = await contexto.newPage();
    await pagina.setViewportSize({ width: 393, height: 851 });
    await pagina.goto("/criterios");
    await pagina.getByLabel("Destino o tipo de viaje").fill(DESTINO_PRUEBA);
    await pagina.getByLabel("Usar fechas concretas").check();
    await pagina.getByLabel("Fecha de inicio").fill(fechaIso(DIAS_DE_ANTELACION));
    await pagina.getByLabel("Fecha de fin").fill(fechaIso(DIAS_DE_ANTELACION + DIAS - 1));
    await pagina.getByLabel("Presupuesto total (€)").fill(String(PRESUPUESTO_PRUEBA_EUR));
    await pagina.getByLabel("Número de días").fill(String(DIAS));
    await pagina.getByLabel("Persona 1, edad").fill("35");
    await pagina.getByRole("button", { name: /añadir persona/i }).click();
    await pagina.getByLabel("Persona 2, edad").fill("35");
    await pagina.getByRole("button", { name: "Continuar" }).click();
    await pagina.waitForURL(/\/trabajos\/[^/]+$/, { timeout: 60_000 });
    const trabajoId = new URL(pagina.url()).pathname.split("/").pop()!;
    await pagina.close();

    const limite = Date.now() + ESPERA_MAXIMA_MS;
    let trabajo: Trabajo = { estado: "encolado" };
    while (Date.now() < limite) {
      const r = await contexto.request.get(`/api/trabajos/${trabajoId}`);
      if (r.ok()) trabajo = (await r.json()) as Trabajo;
      if (trabajo.estado === "completado" && trabajo.plan_id) break;
      if (["fallido", "caducado"].includes(trabajo.estado)) throw new Error(`El trabajo de generación terminó en estado ${trabajo.estado}`);
      await new Promise((resolver) => setTimeout(resolver, SONDEO_MS));
    }
    if (trabajo.estado !== "completado" || !trabajo.plan_id) throw new Error("el trabajador no ha generado el plan a tiempo");

    await comprobarPlanUtil(contexto.request, trabajo.plan_id);

    writeFileSync(RUTA_PLAN, JSON.stringify({ id: trabajo.plan_id, trabajoId }));
    process.env.PLAN_PRUEBA_ID = trabajo.plan_id;

    // VERIFICACION_CONSERVAR=1 deja el plan para otra pasada de la misma
    // sesión de juicio (plan.json lo recoge), a cambio de borrarlo a mano.
    if (process.env.VERIFICACION_CONSERVAR === "1") return undefined;
    return async () => {
      const otro = await chromium.launch();
      const limpio = await otro.newContext({ baseURL, storageState: RUTA_SESION });
      // Es el mismo borrado que dispara «Eliminar de verdad» en Mis viajes.
      await limpio.request.delete(`/api/viajes/${trabajoId}`);
      await otro.close();
      rmSync(RUTA_PLAN, { force: true });
    };
  } finally {
    await contexto.close();
    await navegador.close();
  }
}
