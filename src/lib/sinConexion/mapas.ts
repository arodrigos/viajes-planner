import { pointToTile } from "@mapbox/tilebelt";
import { CACHE_MAPA, HOST_MAPA, claveMapa } from "./reglas";

// Mapa del día sin conexión. Todo lo que se descarga aquí lo pide el navegador
// de la persona, solo al pulsar «Guardar mapas para usar sin red» y con los
// límites que docs/fuentes-de-datos.md documenta para OpenFreeMap: z ≤ 14,
// ≤ 150 teselas por día, ≤ 3 peticiones a la vez y parar ante 429/5xx.

export const ESTILO_MAPA = `https://${HOST_MAPA}/styles/liberty`;
export const ZOOMS_MAPA = [10, 11, 12, 13, 14] as const;
export const MAX_TESELAS_DIA = 150;
export const MARGEN_M = 500;
export const MAX_SIMULTANEAS = 3;
// Estimación para avisar antes de guardar; la medida real se anota en el test
// con las fixtures. Una tesela vectorial de zoom 10-14 en ciudad ronda 20-60 KB.
export const BYTES_POR_TESELA_ESTIMADOS = 40_000;
const RANGOS_GLIFOS = ["0-255", "256-511", "8192-8447"] as const;
const INDICE_PREFIJO = `https://${HOST_MAPA}/__viajes/indice/`;

export interface PuntoGeo {
  lat: number;
  lon: number;
}
export interface Tesela {
  z: number;
  x: number;
  y: number;
}
export interface PlanParaMapa {
  id: string;
  dias: Array<{ paradas: Array<{ coordenadas?: PuntoGeo | null }> }>;
}
export interface OpcionesTeselas {
  margenM?: number;
  zooms?: readonly number[];
  maxTeselas?: number;
}

function teselasEnZoom(puntos: PuntoGeo[], margenM: number, z: number): Tesela[] {
  const lats = puntos.map((p) => p.lat);
  const lons = puntos.map((p) => p.lon);
  const norte = Math.min(85, Math.max(...lats) + margenM / 111_320);
  const sur = Math.max(-85, Math.min(...lats) - margenM / 111_320);
  const cos = Math.max(0.01, Math.cos((((norte + sur) / 2) * Math.PI) / 180));
  const dLon = margenM / (111_320 * cos);
  const oeste = Math.max(-180, Math.min(...lons) - dLon);
  const este = Math.min(180, Math.max(...lons) + dLon);
  const [x0, y0] = pointToTile(oeste, norte, z);
  const [x1, y1] = pointToTile(este, sur, z);
  const salida: Tesela[] = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) salida.push({ z, x, y });
  }
  return salida;
}

// Si la caja del día no cabe en el tope, se quita el zoom más alto hasta que
// quepa: es el que más teselas cuesta y el que menos falta hace para orientarse.
export function teselasDelDia(puntos: PuntoGeo[], opciones: OpcionesTeselas = {}): Tesela[] {
  const { margenM = MARGEN_M, maxTeselas = MAX_TESELAS_DIA } = opciones;
  const zooms = [...new Set((opciones.zooms ?? ZOOMS_MAPA).filter((z) => z >= 10 && z <= 14))].sort((a, b) => a - b);
  if (puntos.length === 0) return [];
  let porZoom = zooms.map((z) => teselasEnZoom(puntos, margenM, z));
  while (porZoom.length > 1 && porZoom.flat().length > maxTeselas) porZoom = porZoom.slice(0, -1);
  return porZoom.flat().slice(0, maxTeselas);
}

export const claveTesela = (t: Tesela): string => `https://${HOST_MAPA}/planet/_/${t.z}/${t.x}/${t.y}.pbf`;

function puntosDe(plan: PlanParaMapa, indiceDia: number): PuntoGeo[] {
  const salida: PuntoGeo[] = [];
  for (const parada of plan.dias[indiceDia]?.paradas ?? []) {
    if (parada.coordenadas) salida.push({ lat: parada.coordenadas.lat, lon: parada.coordenadas.lon });
  }
  return salida;
}

// Los días sin ninguna parada ubicada no tienen mapa que guardar.
export function diasConMapa(plan: PlanParaMapa): number[] {
  return plan.dias.flatMap((_, i) => (puntosDe(plan, i).length > 0 ? [i + 1] : []));
}

export function estimarMB(teselas: number): number {
  return Math.max(1, Math.round((teselas * BYTES_POR_TESELA_ESTIMADOS) / 1_000_000));
}

export function estimarPlan(plan: PlanParaMapa): { dias: number; teselas: number; mb: number } {
  const dias = diasConMapa(plan);
  const teselas = dias.reduce((n, d) => n + teselasDelDia(puntosDe(plan, d - 1)).length, 0);
  return { dias: dias.length, teselas, mb: estimarMB(teselas) };
}

// «1 a 3», «1 y 3», «1, 2 y 4».
export function describirDias(dias: number[]): string {
  const tramos: string[] = [];
  const ordenados = [...dias].sort((a, b) => a - b);
  for (let i = 0; i < ordenados.length; ) {
    let j = i;
    while (j + 1 < ordenados.length && ordenados[j + 1] === ordenados[j] + 1) j++;
    tramos.push(j === i ? `${ordenados[i]}` : j === i + 1 ? `${ordenados[i]} y ${ordenados[j]}` : `${ordenados[i]} a ${ordenados[j]}`);
    i = j + 1;
  }
  return tramos.length <= 1 ? (tramos[0] ?? "") : `${tramos.slice(0, -1).join(", ")} y ${tramos[tramos.length - 1]}`;
}

export type MotivoFallo = "servidor" | "red" | "cancelado" | "almacenamiento";
export interface ResultadoGuardado {
  guardados: number[];
  fallo?: { dia: number; motivo: MotivoFallo };
}
export interface OpcionesGuardado {
  alProgreso?: (p: { dia: number; total: number }) => void;
  señal?: AbortSignal;
  // Inyectable para los tests; en producción, el fetch del navegador.
  peticion?: typeof fetch;
}

class ParadaPedida extends Error {
  constructor(readonly motivo: MotivoFallo) {
    super(motivo);
  }
}

function abierta(): Promise<Cache> {
  return caches.open(CACHE_MAPA);
}

async function pedir(url: string, peticion: typeof fetch, señal?: AbortSignal): Promise<Response> {
  if (señal?.aborted) throw new ParadaPedida("cancelado");
  let respuesta: Response;
  try {
    respuesta = await peticion(url, { signal: señal });
  } catch {
    throw new ParadaPedida(señal?.aborted ? "cancelado" : "red");
  }
  if (respuesta.status === 429 || respuesta.status >= 500) throw new ParadaPedida("servidor");
  return respuesta;
}

async function guardarUrl(cache: Cache, url: string, peticion: typeof fetch, señal?: AbortSignal, aceptar404 = false): Promise<Response> {
  const clave = claveMapa(url);
  const previa = await cache.match(clave);
  if (previa) return previa;
  const respuesta = await pedir(url, peticion, señal);
  if (!respuesta.ok && !(aceptar404 && respuesta.status === 404)) throw new ParadaPedida("red");
  try {
    await cache.put(clave, respuesta.clone());
  } catch {
    throw new ParadaPedida("almacenamiento");
  }
  return respuesta;
}

interface EstiloMinimo {
  sprite?: string;
  glyphs?: string;
  sources?: Record<string, { url?: string; tiles?: string[] }>;
  layers?: Array<{ layout?: { "text-font"?: string[] } }>;
}

function fontstacks(estilo: EstiloMinimo): string[] {
  const pilas = new Set<string>();
  for (const capa of estilo.layers ?? []) {
    const fuentes = capa.layout?.["text-font"];
    if (Array.isArray(fuentes) && fuentes.length > 0) pilas.add(fuentes.join(","));
  }
  return [...pilas];
}

// Estilo, TileJSON, sprite y glifos: lo común a todos los días. Devuelve la
// plantilla de teselas, que sale del TileJSON y no está fija en el código.
async function guardarBase(cache: Cache, peticion: typeof fetch, señal?: AbortSignal): Promise<string> {
  const estilo = (await (await guardarUrl(cache, ESTILO_MAPA, peticion, señal)).clone().json()) as EstiloMinimo;
  let plantilla: string | undefined;
  for (const fuente of Object.values(estilo.sources ?? {})) {
    if (fuente.url) {
      const tilejson = (await (await guardarUrl(cache, fuente.url, peticion, señal)).clone().json()) as { tiles?: string[] };
      plantilla ??= tilejson.tiles?.[0];
    } else plantilla ??= fuente.tiles?.[0];
  }
  if (!plantilla) throw new ParadaPedida("red");
  if (estilo.sprite) {
    for (const sufijo of [".json", ".png", "@2x.json", "@2x.png"]) await guardarUrl(cache, `${estilo.sprite}${sufijo}`, peticion, señal);
  }
  if (estilo.glyphs) {
    for (const pila of fontstacks(estilo)) {
      for (const rango of RANGOS_GLIFOS) {
        const url = estilo.glyphs.replace("{fontstack}", encodeURIComponent(pila)).replace("{range}", rango);
        await guardarUrl(cache, url, peticion, señal, true);
      }
    }
  }
  return plantilla;
}

function urlTesela(plantilla: string, t: Tesela): string {
  return plantilla.replace("{z}", `${t.z}`).replace("{x}", `${t.x}`).replace("{y}", `${t.y}`);
}

const urlIndice = (planId: string): string => `${INDICE_PREFIJO}${encodeURIComponent(planId)}.json`;

// Descarga con un máximo de MAX_SIMULTANEAS en vuelo. Al primer fallo no se
// lanza ninguna petición más (las que ya vuelan terminan).
async function descargarTeselas(cache: Cache, plantilla: string, teselas: Tesela[], peticion: typeof fetch, señal?: AbortSignal): Promise<void> {
  let siguiente = 0;
  let parada: ParadaPedida | null = null;
  async function trabajador() {
    while (!parada && siguiente < teselas.length) {
      const t = teselas[siguiente++];
      try {
        await guardarUrl(cache, urlTesela(plantilla, t), peticion, señal, true);
      } catch (e) {
        parada ??= e instanceof ParadaPedida ? e : new ParadaPedida("red");
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_SIMULTANEAS, teselas.length) }, trabajador));
  if (parada) throw parada;
}

// Solo se invoca desde el botón. Un día cuenta como guardado cuando TODAS sus
// teselas están en la caché; ante cualquier fallo se conservan los anteriores.
export async function guardarMapasPlan(plan: PlanParaMapa, opciones: OpcionesGuardado = {}): Promise<ResultadoGuardado> {
  const { alProgreso, señal, peticion = fetch } = opciones;
  const dias = diasConMapa(plan);
  const guardados: number[] = [];
  if (dias.length === 0) return { guardados };
  if (typeof navigator !== "undefined" && typeof navigator.storage?.persist === "function") {
    // Se pide, pero el resultado no cambia lo que se promete: iOS puede
    // expulsar el almacenamiento igualmente.
    void navigator.storage.persist().catch(() => false);
  }
  let diaActual = dias[0];
  try {
    const cache = await abierta();
    const plantilla = await guardarBase(cache, peticion, señal);
    const claves = new Set<string>();
    for (const dia of dias) {
      diaActual = dia;
      alProgreso?.({ dia, total: dias.length });
      const teselas = teselasDelDia(puntosDe(plan, dia - 1));
      await descargarTeselas(cache, plantilla, teselas, peticion, señal);
      teselas.forEach((t) => claves.add(claveTesela(t)));
      await cache.put(urlIndice(plan.id), new Response(JSON.stringify({ teselas: [...claves] }), { headers: { "content-type": "application/json" } }));
      guardados.push(dia);
    }
    return { guardados };
  } catch (e) {
    return { guardados, fallo: { dia: diaActual, motivo: e instanceof ParadaPedida ? e.motivo : "red" } };
  }
}

async function baseGuardada(cache: Cache): Promise<boolean> {
  const estilo = await cache.match(ESTILO_MAPA);
  if (!estilo) return false;
  try {
    const e = (await estilo.clone().json()) as EstiloMinimo;
    for (const fuente of Object.values(e.sources ?? {})) if (fuente.url && !(await cache.match(fuente.url))) return false;
    if (e.sprite) for (const s of [".json", ".png", "@2x.json", "@2x.png"]) if (!(await cache.match(`${e.sprite}${s}`))) return false;
    return true;
  } catch {
    return false;
  }
}

async function diaGuardadoEn(cache: Cache, puntos: PuntoGeo[]): Promise<boolean> {
  if (puntos.length === 0) return false;
  for (const t of teselasDelDia(puntos)) if (!(await cache.match(claveTesela(t)))) return false;
  return true;
}

// El estado se lee de la caché real y no de una marca escrita al guardar: si
// el sistema la expulsa, el aviso deja de mentir.
export async function diaEstaGuardado(puntos: PuntoGeo[]): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    if (!(await caches.has(CACHE_MAPA))) return false;
    const cache = await abierta();
    return (await baseGuardada(cache)) && (await diaGuardadoEn(cache, puntos));
  } catch {
    return false;
  }
}

export async function diasGuardados(plan: PlanParaMapa): Promise<number[]> {
  if (typeof caches === "undefined") return [];
  try {
    if (!(await caches.has(CACHE_MAPA))) return [];
    const cache = await abierta();
    if (!(await baseGuardada(cache))) return [];
    const salida: number[] = [];
    for (const dia of diasConMapa(plan)) if (await diaGuardadoEn(cache, puntosDe(plan, dia - 1))) salida.push(dia);
    return salida;
  } catch {
    return [];
  }
}

// Las teselas se comparten entre planes de la misma ciudad: solo se borran las
// que ningún otro plan guardado referencia. Nunca lanza.
export async function borrarMapasPlan(planId: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    if (!(await caches.has(CACHE_MAPA))) return;
    const cache = await abierta();
    const propio = urlIndice(planId);
    const respuesta = await cache.match(propio);
    if (!respuesta) return;
    const { teselas } = (await respuesta.json()) as { teselas?: string[] };
    await cache.delete(propio);
    const ajenas = new Set<string>();
    for (const peticion of await cache.keys()) {
      if (!peticion.url.startsWith(INDICE_PREFIJO)) continue;
      const otro = (await (await cache.match(peticion))?.json()) as { teselas?: string[] } | undefined;
      otro?.teselas?.forEach((c) => ajenas.add(c));
    }
    for (const clave of teselas ?? []) if (!ajenas.has(clave)) await cache.delete(clave);
  } catch {
    // Igual que borrarCopias: es una limpieza, no puede bloquear nada.
  }
}
