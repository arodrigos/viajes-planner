import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { sembrarPlan } from "./semillas-e2e";

// Siembra y ayudas comunes de los e2e de reordenar-dia (orden-dia y
// orden-ahora): un plan de un día en Granada con paradas de varias franjas.
export const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "comida", etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

export function parada(id: string, nombre: string, franja: string, indice: number): Parada {
  return {
    id,
    franja_id: franja,
    nombre,
    descripcion: "Visita de prueba",
    duracion_min: 60,
    prioridad: 60,
    procedencia: { fuente: "propuesto-sin-verificar" },
    // Separadas ~0,9 km para que cada tramo tenga minutos propios.
    coordenadas: { lat: 37.17 + indice * 0.008, lon: -3.59 },
  };
}

export const NOMBRES = { a: "Alfa", b: "Beta", c: "Gamma", d: "Delta" } as const;

export async function sembrarDia(supabase: SupabaseClient, email: string, sufijo: string, paradas: Parada[], fecha = "2027-06-09") {
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) {
    // Un reintento del CI ya lo habrá creado.
    const { data: lista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existente = lista?.users.find((u) => u.email === email);
    if (!existente) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuario.user = existente;
  }
  const planId = `plan-orden-${sufijo}-${Date.now()}`;
  const plan: Plan = { id: planId, version: 1, destino: "Granada", personas: 2, dias: [{ fecha, franjas: FRANJAS, paradas }] };
  await sembrarPlan(supabase, plan);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user!.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);
  return planId;
}

export async function iniciarSesion(contexto: BrowserContext, email: string) {
  const solicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(solicitud.ok()).toBe(true);
  const verificacion = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo: await leerCodigo(email) } });
  expect(verificacion.ok()).toBe(true);
}

export async function abrirPlan(browser: Browser, email: string, planId: string, opciones: { ahora?: string; viewport?: { width: number; height: number } } = {}) {
  const contexto = await browser.newContext({ viewport: opciones.viewport ?? { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);
  if (opciones.ahora) await pagina.clock.install({ time: new Date(opciones.ahora) });
  await pagina.goto(`/plan/${planId}`);
  return { contexto, pagina };
}

// Nombres de las tarjetas en el orden en que se pintan.
export async function ordenPintado(pagina: Page): Promise<string[]> {
  return pagina.locator("li:has([data-testid='numero-parada']) h4").allInnerTexts();
}

export async function ultimaVersionDelDia(supabase: SupabaseClient, planId: string) {
  const { data: version } = await supabase.from("plan_versiones").select("id, version").eq("plan_id", planId).order("version", { ascending: false }).limit(1).single();
  const { data: filas } = await supabase.from("paradas").select("id_externo, franja_id, orden").eq("plan_version_id", version!.id).eq("dia_index", 0);
  const ordenadas = (filas ?? []).sort((x, y) => (x.orden ?? 1e9) - (y.orden ?? 1e9));
  return { version: version!.version as number, paradas: ordenadas as { id_externo: string; franja_id: string; orden: number | null }[] };
}
