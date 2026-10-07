import type { APIRequestContext, Page } from "@playwright/test";
import { planDePrueba } from "./entorno";

export const ANCHO_MOVIL = 393;
export const DIAS_PLAN_PRUEBA = 10;

export interface ParadaApi {
  id: string;
  nombre: string;
  coordenadas?: { lat: number; lon: number };
  guia?: unknown;
  curiosidades?: unknown;
  motivo?: string;
  coste?: unknown;
  procedencia: { fuente: string };
  alternativas?: { id?: string; nombre: string }[];
}
export interface PlanApi {
  dias: { paradas: ParadaApi[] }[];
}

export async function leerPlan(peticiones: APIRequestContext): Promise<PlanApi> {
  const r = await peticiones.get(`/api/plan/${planDePrueba()}`);
  if (!r.ok()) throw new Error(`No se pudo leer el plan de prueba: HTTP ${r.status()}`);
  return (await r.json()) as PlanApi;
}

export async function abrirDia(pagina: Page, dia: number): Promise<void> {
  await pagina.goto(`/plan/${planDePrueba()}?dia=${dia}`);
  await pagina.locator("li.tarjeta-parada").first().waitFor();
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

export function pngDimensiones(bytes: Buffer): { ancho: number; alto: number; firma: number[] } {
  return { firma: [...bytes.subarray(0, 4)], ancho: bytes.readUInt32BE(16), alto: bytes.readUInt32BE(20) };
}

export const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47];
