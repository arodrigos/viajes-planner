import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { conCupo } from "@/lib/google/cupo";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { CategoriaParada, Lugar } from "@/lib/plan/tipos";

const URL_TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
// Solo id y ubicación: la ubicación se usa para validar la distancia y se
// descarta; pedir más campos subiría el tramo de facturación.
export const MASCARA_CAMPOS = "places.id,places.location";
const TIMEOUT_MS = 10_000;
const PAGINA = 5;
const LIMITE_POR_TICK = 20;
const DIAS_SIN_COINCIDENCIA = 30;
const MESES_CASADO = 12;

// Distancia máxima entre la ubicación comprobada y la que devuelve Google.
// aceptacion.ts valida nombre y caja, pero no tiene umbral de distancia:
// este es propio. Los sitios extensos (un parque, una playa) tienen un
// centroide que puede quedar lejos del que eligió OSM; un museo no.
const UMBRAL_EXTENSO_M = 1000;
const UMBRAL_PUNTUAL_M = 300;
const CATEGORIAS_EXTENSAS: ReadonlySet<CategoriaParada> = new Set(["parque", "playa", "naturaleza", "barrio", "plaza", "mirador"]);

export function umbralCasadoM(categoria: CategoriaParada | null | undefined): number {
  return categoria && CATEGORIAS_EXTENSAS.has(categoria) ? UMBRAL_EXTENSO_M : UMBRAL_PUNTUAL_M;
}

export interface Punto {
  lat: number;
  lon: number;
}

export interface ResultadoGoogle {
  id: string;
  location?: { latitude: number; longitude: number };
}

// Rectángulo centrado en el ancla con semilado igual al umbral. Un grado de
// longitud mide menos lejos del ecuador, de ahí el coseno.
export function rectanguloAlrededor(ancla: Punto, metros: number) {
  const dLat = metros / 111_320;
  const dLon = metros / (111_320 * Math.max(Math.cos((ancla.lat * Math.PI) / 180), 0.01));
  return {
    low: { latitude: ancla.lat - dLat, longitude: ancla.lon - dLon },
    high: { latitude: ancla.lat + dLat, longitude: ancla.lon + dLon },
  };
}

// El primer resultado, en el orden de Google, cuya ubicación cae a menos del
// umbral del ancla. Sin ubicación no hay forma de validar: no se acepta.
export function elegirCoincidencia(ancla: Punto, umbralM: number, resultados: readonly ResultadoGoogle[]): string | null {
  for (const resultado of resultados) {
    const ubicacion = resultado.location;
    if (!resultado.id || !ubicacion) continue;
    if (distanciaMetros(ancla, { lat: ubicacion.latitude, lon: ubicacion.longitude }) <= umbralM) return resultado.id;
  }
  return null;
}

export type EstadoLugar = "casado" | "sin-coincidencia" | "obsoleto" | "error";

// Lo único que se escribe: nunca ubicación, nombre ni nada más de Google.
export interface FilaLugarGoogle {
  clave: string;
  place_id: string | null;
  estado: EstadoLugar;
  comprobado_en: string;
}

export interface FilaExistente {
  clave: string;
  estado: EstadoLugar;
  comprobado_en: string;
}

export function necesitaCasado(existente: FilaExistente | undefined, ahora: Date): boolean {
  if (!existente) return true;
  if (existente.estado === "obsoleto" || existente.estado === "error") return true;
  const comprobado = new Date(existente.comprobado_en);
  if (existente.estado === "sin-coincidencia") {
    return ahora.getTime() - comprobado.getTime() > DIAS_SIN_COINCIDENCIA * 86_400_000;
  }
  const limite = new Date(ahora);
  limite.setUTCMonth(limite.getUTCMonth() - MESES_CASADO);
  return comprobado.getTime() < limite.getTime();
}

export type Peticion = (url: string, init: RequestInit) => Promise<Response>;

export interface OpcionesCasado {
  // Sin clave el módulo no hace nada: en dev y en los tests no hay red.
  clave: string | undefined;
  peticion?: Peticion;
  ahora?: () => Date;
  limite?: number;
}

export interface ResultadoCasado {
  clavePresente: boolean;
  candidatas: number;
  peticiones: number;
  casadas: number;
  sinCoincidencia: number;
  errores: number;
  topeAgotado: boolean;
}

const VACIO: ResultadoCasado = { clavePresente: false, candidatas: 0, peticiones: 0, casadas: 0, sinCoincidencia: 0, errores: 0, topeAgotado: false };

// La clave va en cabecera, nunca en la URL (acaba en logs de proxies), y el
// mensaje de error solo lleva el código HTTP: ni la URL ni el cuerpo.
export async function buscarEnGoogle(
  peticion: Peticion,
  clave: string,
  consulta: string,
  ancla: Punto,
  umbralM: number,
): Promise<ResultadoGoogle[]> {
  const respuesta = await peticion(URL_TEXT_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": clave, "X-Goog-FieldMask": MASCARA_CAMPOS },
    body: JSON.stringify({
      textQuery: consulta,
      languageCode: "es",
      pageSize: PAGINA,
      locationRestriction: { rectangle: rectanguloAlrededor(ancla, umbralM) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!respuesta.ok) throw new Error(`Text Search respondió ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { places?: ResultadoGoogle[] };
  return Array.isArray(cuerpo.places) ? cuerpo.places : [];
}

interface CandidatoLugar {
  clave: string;
  consulta: string;
  ancla: Punto;
  umbralM: number;
  inicioViaje: string;
}

interface FilaParadaCasar {
  nombre: string;
  categoria: CategoriaParada | null;
  lat: number | null;
  lon: number | null;
  lugar: Lugar | null;
  plan_version_id: string;
}

function ciudadDe(ciudad: CiudadEfectiva | null, destino: string): string {
  return ciudad?.estado === "resuelta" && ciudad.nombre ? ciudad.nombre : destino;
}

// Paradas con procedencia comprobada y coordenadas, de la última versión de
// cada plan, una por lugar y con el viaje más próximo primero. Las demás no
// tienen ancla contra la que validar y nunca generan una petición.
async function leerCandidatos(supabase: SupabaseClient, hoy: string): Promise<CandidatoLugar[]> {
  const { data: versiones, error: errorVersiones } = await supabase
    .from("plan_versiones")
    .select("id, plan_id, dias, planes(destino, ciudad)")
    .order("version", { ascending: false });
  if (errorVersiones) throw new Error(`No se pudieron leer las versiones: ${errorVersiones.message}`);

  const vistos = new Set<string>();
  const porVersion = new Map<string, { inicio: string; ciudad: string }>();
  for (const fila of versiones ?? []) {
    const planId = fila.plan_id as string;
    if (vistos.has(planId)) continue;
    vistos.add(planId);
    const relacion = fila.planes as unknown as { destino: string; ciudad: CiudadEfectiva | null } | { destino: string; ciudad: CiudadEfectiva | null }[] | null;
    const plan = Array.isArray(relacion) ? relacion[0] : relacion;
    if (!plan?.destino) continue;
    const dias = (fila.dias as Array<{ fecha: string }> | null) ?? [];
    porVersion.set(fila.id as string, { inicio: dias[0]?.fecha ?? hoy, ciudad: ciudadDe(plan.ciudad, plan.destino) });
  }
  if (porVersion.size === 0) return [];

  const { data: paradas, error: errorParadas } = await supabase
    .from("paradas")
    .select("nombre, categoria, lat, lon, lugar, plan_version_id")
    .in("plan_version_id", [...porVersion.keys()]);
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);

  const porClave = new Map<string, CandidatoLugar>();
  for (const parada of (paradas as FilaParadaCasar[] | null) ?? []) {
    const { lugar, lat, lon } = parada;
    if (!lugar || (lugar.fuente !== "osm" && lugar.fuente !== "wikipedia") || lat === null || lon === null) continue;
    const version = porVersion.get(parada.plan_version_id);
    if (!version) continue;
    const existente = porClave.get(lugar.id);
    if (existente && Math.abs(Date.parse(existente.inicioViaje) - Date.parse(hoy)) <= Math.abs(Date.parse(version.inicio) - Date.parse(hoy))) continue;
    porClave.set(lugar.id, {
      clave: lugar.id,
      consulta: `${parada.nombre}, ${version.ciudad}`,
      ancla: { lat, lon },
      umbralM: umbralCasadoM(parada.categoria),
      inicioViaje: version.inicio,
    });
  }
  return [...porClave.values()].sort(
    (a, b) => Math.abs(Date.parse(a.inicioViaje) - Date.parse(hoy)) - Math.abs(Date.parse(b.inicioViaje) - Date.parse(hoy)),
  );
}

export async function casarLugaresPendientes(supabase: SupabaseClient, opciones: OpcionesCasado): Promise<ResultadoCasado> {
  const { clave } = opciones;
  if (!clave) return VACIO;
  const peticion: Peticion = opciones.peticion ?? ((url, init) => fetch(url, init));
  const ahora = (opciones.ahora ?? (() => new Date()))();
  const resultado: ResultadoCasado = { ...VACIO, clavePresente: true };

  const candidatos = await leerCandidatos(supabase, ahora.toISOString().slice(0, 10));
  if (candidatos.length === 0) return resultado;

  const { data: existentes, error: errorExistentes } = await supabase
    .from("lugares_google")
    .select("clave, estado, comprobado_en")
    .in("clave", candidatos.map((c) => c.clave));
  if (errorExistentes) throw new Error(`No se pudo leer lugares_google: ${errorExistentes.message}`);
  const porClave = new Map(((existentes as FilaExistente[] | null) ?? []).map((fila) => [fila.clave, fila]));

  const pendientes = candidatos.filter((c) => necesitaCasado(porClave.get(c.clave), ahora)).slice(0, opciones.limite ?? LIMITE_POR_TICK);
  resultado.candidatas = pendientes.length;

  for (const candidato of pendientes) {
    // La reserva va antes de la petición y no se devuelve si Google falla:
    // un bucle contra una API caída gastaría cupo igual que uno bueno.
    const reserva = await conCupo<{ estado: EstadoLugar; placeId: string | null }>(supabase, "text_search_pro", null, async () => {
      resultado.peticiones += 1;
      try {
        const encontrados = await buscarEnGoogle(peticion, clave, candidato.consulta, candidato.ancla, candidato.umbralM);
        const placeId = elegirCoincidencia(candidato.ancla, candidato.umbralM, encontrados);
        return placeId ? { estado: "casado", placeId } : { estado: "sin-coincidencia", placeId: null };
      } catch {
        return { estado: "error", placeId: null };
      }
    });
    if (!reserva.concedido) {
      // Tope agotado o contador caído: el resto queda pendiente para otro tick.
      resultado.topeAgotado = true;
      break;
    }
    const { estado, placeId } = reserva.valor;
    const fila: FilaLugarGoogle = { clave: candidato.clave, place_id: placeId, estado, comprobado_en: ahora.toISOString() };
    const { error } = await supabase.from("lugares_google").upsert(fila, { onConflict: "clave" });
    if (error) throw new Error(`No se pudo escribir lugares_google: ${error.message}`);
    if (estado === "casado") resultado.casadas += 1;
    else if (estado === "sin-coincidencia") resultado.sinCoincidencia += 1;
    else resultado.errores += 1;
  }
  return resultado;
}
