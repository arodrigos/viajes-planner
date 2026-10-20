// Reglas cerradas del service worker, como funciones puras: las importan sw.ts
// y los tests, para que lo que se prueba sea exactamente lo que corre en el
// dispositivo. Todo lo que no case aquí va a red sin que el SW lo toque.

export const CACHE_DATOS = "viajes-datos";
export const CACHE_FOTOS = "viajes-fotos";
export const CACHE_MAPA = "viajes-mapa";
export const CABECERA_LEIDO_EN = "x-plan-leido-en";
export const CABECERA_COPIA = "x-copia-guardada";
export const LIMITE_RED_MS = 6000;
export const HOST_FOTOS = "upload.wikimedia.org";
export const HOST_MAPA = "tiles.openfreemap.org";
// Más corto que el de la API: un mapa que no llega en 3 s se sustituye por la
// copia guardada antes de que la persona crea que la pantalla se ha colgado.
export const LIMITE_RED_MAPA_MS = 3000;

// Los ids de plan son texto (uuid en producción, «plan-xxx» en las semillas de
// prueba): basta con que sean un solo segmento de ruta sin nada raro.
export const ID_PLAN = "[A-Za-z0-9_-]{1,64}";
const RUTA_API_PLAN = new RegExp(`^/api/plan/(${ID_PLAN})$`);
const RUTA_PLAN = new RegExp(`^/plan/(${ID_PLAN})/?$`);

const DOMINIOS_GOOGLE = ["googleapis.com", "gstatic.com", "google.com", "googleusercontent.com", "ggpht.com"];

export type Clase = "red" | "api-plan" | "foto" | "mapa" | "navegacion-plan" | "navegacion-sin-conexion" | "navegacion";

export function esHostGoogle(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return DOMINIOS_GOOGLE.some((d) => h === d || h.endsWith(`.${d}`));
}

export interface PeticionSW {
  url: string;
  metodo: string;
  // request.mode del navegador: «navigate» solo en navegaciones de documento.
  modo: string;
}

export function clasificar(peticion: PeticionSW, origen: string): Clase {
  let url: URL;
  try {
    url = new URL(peticion.url);
  } catch {
    return "red";
  }
  if (peticion.metodo.toUpperCase() !== "GET") return "red";
  if (esHostGoogle(url.hostname)) return "red";

  if (url.origin === origen) {
    if (url.pathname.startsWith("/api/")) return RUTA_API_PLAN.test(url.pathname) ? "api-plan" : "red";
    if (peticion.modo !== "navigate") return "red";
    if (url.pathname === "/sin-conexion") return "navegacion-sin-conexion";
    return RUTA_PLAN.test(url.pathname) ? "navegacion-plan" : "navegacion";
  }

  if (url.protocol === "https:" && url.hostname === HOST_FOTOS) return "foto";
  if (url.protocol === "https:" && url.hostname === HOST_MAPA) return "mapa";
  return "red";
}

// Las teselas llevan la versión del planeta en la ruta (/planet/<versión>/z/x/y.pbf)
// y OpenFreeMap la cambia cada semana: sin normalizarla, un mapa guardado
// dejaría de casar con lo que pide un TileJSON más nuevo. La versión no entra
// en la clave; cualquier otra URL queda tal cual.
const RUTA_TESELA = /^\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/;
// En los glifos, la coma de «Pila,Otra» llega unas veces escrita y otras como
// %2C según quién arme la URL: las dos casan con la misma copia.
export function claveMapa(urlOriginal: string): string {
  try {
    const url = new URL(urlOriginal);
    const tesela = RUTA_TESELA.exec(url.pathname);
    if (tesela) {
      url.pathname = `/planet/_/${tesela[1]}`;
      return url.href;
    }
    if (url.pathname.startsWith("/fonts/")) {
      url.pathname = url.pathname.replace(/%2c/gi, ",");
      return url.href;
    }
    return urlOriginal;
  } catch {
    return urlOriginal;
  }
}

// Solo el plan entra en la caché: un 401, un 404, un 500, una redirección o
// la pantalla de login de Vercel nunca sustituyen a una copia buena.
export function esGuardable(respuesta: { status: number; redirected: boolean; contentType: string | null; leidoEn: string | null }): boolean {
  return (
    respuesta.status === 200 &&
    !respuesta.redirected &&
    /^application\/json\b/i.test(respuesta.contentType ?? "") &&
    respuesta.leidoEn !== null &&
    respuesta.leidoEn !== ""
  );
}

export function idDeClavePlan(url: string): string | null {
  try {
    return RUTA_API_PLAN.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Ruta (nunca otro origen) a la que se redirige una navegación sin red. El id
// y el día salen de la URL original, que puede ser cualquier cosa: solo pasa
// lo que tiene forma de uno y otro.
export function destinoSinConexion(urlOriginal: string, origen: string): string {
  let url: URL;
  try {
    url = new URL(urlOriginal, origen);
  } catch {
    return "/sin-conexion";
  }
  const id = RUTA_PLAN.exec(url.pathname)?.[1] ?? url.searchParams.get("plan")?.match(new RegExp(`^${ID_PLAN}$`))?.[0];
  if (!id) return "/sin-conexion";
  const destino = new URLSearchParams({ plan: id });
  const dia = url.searchParams.get("dia");
  if (dia !== null && (dia === "resumen" || /^[1-9][0-9]{0,5}$/.test(dia))) destino.set("dia", dia);
  return `/sin-conexion?${destino.toString()}`;
}

const DIA_LARGO = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });

export function formatearHora(fecha: Date): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false }).format(fecha);
}

export function textoAviso(fecha: Date): string {
  return `Sin conexión · Estás viendo la copia guardada el ${DIA_LARGO.format(fecha)} a las ${formatearHora(fecha)}. Se actualizará sola cuando vuelva la conexión.`;
}
