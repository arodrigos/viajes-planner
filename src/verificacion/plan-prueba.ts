import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium, type BrowserContext } from "@playwright/test";
import { DIRECTORIO, RUTA_PLAN, RUTA_SESION, variable } from "./entorno";
import { iniciarSesion } from "./login";
import { limpiezaDePlan, resolverPlan } from "./reutilizar";

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

function fechaIso(sumarDias: number): string {
  const f = new Date();
  f.setUTCDate(f.getUTCDate() + sumarDias);
  return f.toISOString().slice(0, 10);
}

// Envía el formulario real y devuelve el id del trabajo encolado.
async function crearTrabajo(contexto: BrowserContext): Promise<string> {
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
  return trabajoId;
}

// ver-ac1: deja la sesión lista para las specs y el plan de prueba generado
// por el trabajador real, reutilizando uno existente antes de crear nada.
// Por defecto conserva el plan; solo VERIFICACION_BORRAR=1 devuelve la
// limpieza que borra el que creó él.
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

    const guardado = existsSync(RUTA_PLAN) ? (JSON.parse(readFileSync(RUTA_PLAN, "utf8")) as { id?: string; trabajoId?: string }) : undefined;
    const resultado = await resolverPlan({
      peticiones: contexto.request,
      destino: DESTINO_PRUEBA,
      diasDeAntelacion: DIAS_DE_ANTELACION,
      crearTrabajo: () => crearTrabajo(contexto),
      ahora: Date.now,
      dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
      esperaMaximaMs: ESPERA_MAXIMA_MS,
      sondeoMs: SONDEO_MS,
      entorno: process.env,
      guardado,
      guardarTrabajo: (trabajoId) => writeFileSync(RUTA_PLAN, JSON.stringify({ trabajoId })),
    });
    // Modo «solo encolar»: el trabajador sigue generando mientras el juicio
    // hace sus comprobaciones estáticas; plan.json solo lleva el trabajoId.
    if ("encolado" in resultado) return undefined;

    const trabajoId = resultado.trabajoId;
    if (trabajoId) writeFileSync(RUTA_PLAN, JSON.stringify({ id: resultado.planId, trabajoId }));
    process.env.PLAN_PRUEBA_ID = resultado.planId;
    if (!trabajoId) return undefined;

    return limpiezaDePlan(resultado.creado, process.env, async () => {
      const otro = await chromium.launch();
      const limpio = await otro.newContext({ baseURL, storageState: RUTA_SESION });
      // Es el mismo borrado que dispara «Eliminar de verdad» en Mis viajes.
      await limpio.request.delete(`/api/viajes/${trabajoId}`);
      await otro.close();
      rmSync(RUTA_PLAN, { force: true });
    });
  } finally {
    await contexto.close();
    await navegador.close();
  }
}
