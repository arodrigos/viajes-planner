import "server-only";
import { claveEventos, type CacheSitios, esFalloDeCache } from "@/lib/lugares/cacheSitios";
import { userAgent } from "@/lib/lugares/fuenteAbierta";
import { crearLimitador, relojReal, type Reloj } from "@/lib/lugares/limitador";
import { esFecha, esPais, limpiarNombre } from "./seguridad";
import type { Evento } from "./tipos";

// Ritmo prudente con APIs abiertas sin cuenta: una petición por segundo.
export const INTERVALO_MIN_MS = 1_000;

// La fuente no respondió (red, 429, 5xx): no es «no hay eventos», así que
// no se cachea ni se da el intento por gastado.
export class FalloFuenteEventos extends Error {}

export type EventoFuente = Omit<Evento, "etapa" | "pais">;

export interface FuenteFestivos {
  // Festivos nacionales y vacaciones escolares nacionales entre dos fechas
  // (ambas incluidas). OpenHolidays primero; Nager.Date si OpenHolidays no
  // cubre el país.
  festivos(pais: string, desde: string, hasta: string): Promise<EventoFuente[]>;
}

export interface OpcionesFuenteFestivos {
  fetch?: typeof fetch;
  reloj?: Reloj;
  cache: CacheSitios;
}

const URL_OPENHOLIDAYS = "https://www.openholidaysapi.org/en/";
const urlNager = (pais: string) => `https://date.nager.at/Country/${pais}`;

interface FilaOpenHolidays {
  startDate?: string;
  endDate?: string;
  type?: string;
  name?: Array<{ language?: string; text?: string }>;
  nationwide?: boolean;
}

interface FilaNager {
  date?: string;
  localName?: string;
  name?: string;
  global?: boolean;
  types?: string[];
}

function nombreDe(nombres: FilaOpenHolidays["name"]): string | null {
  const lista = Array.isArray(nombres) ? nombres : [];
  const elegido = lista.find((n) => n.language === "ES") ?? lista.find((n) => n.language === "EN") ?? lista[0];
  return typeof elegido?.text === "string" ? limpiarNombre(elegido.text) || null : null;
}

export function crearFuenteFestivos(opciones: OpcionesFuenteFestivos): FuenteFestivos {
  const fetchImpl = opciones.fetch ?? fetch;
  const limitar = crearLimitador(INTERVALO_MIN_MS, opciones.reloj ?? relojReal);

  async function pedirJson(url: string): Promise<unknown> {
    return limitar(async () => {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new FalloFuenteEventos("red");
      }
      // Un 404 de Nager.Date quiere decir «país que no cubre»; el llamador lo
      // distingue por el código, así que se devuelve null.
      if (respuesta.status === 404) return null;
      if (!respuesta.ok) throw new FalloFuenteEventos(`HTTP ${respuesta.status}`);
      try {
        return await respuesta.json();
      } catch {
        throw new FalloFuenteEventos("respuesta sin JSON");
      }
    });
  }

  async function cacheado<T>(clave: string, obtener: () => Promise<T>): Promise<T> {
    const enCache = await opciones.cache.obtener(clave);
    if (!esFalloDeCache(enCache)) return enCache as T;
    const valor = await obtener();
    await opciones.cache.guardar(clave, valor);
    return valor;
  }

  async function paisesOpenHolidays(): Promise<string[]> {
    return cacheado(claveEventos("oh", "paises"), async () => {
      const datos = await pedirJson("https://openholidaysapi.org/Countries");
      if (!Array.isArray(datos)) throw new FalloFuenteEventos("lista de países inválida");
      return datos.map((p) => (p as { isoCode?: unknown }).isoCode).filter(esPais);
    });
  }

  async function deOpenHolidays(pais: string, desde: string, hasta: string): Promise<EventoFuente[]> {
    const eventos: EventoFuente[] = [];
    for (const [ruta, tipo] of [
      ["PublicHolidays", "festivo"],
      ["SchoolHolidays", "vacaciones"],
    ] as const) {
      const parametros = new URLSearchParams({ countryIsoCode: pais, validFrom: desde, validTo: hasta, languageIsoCode: "ES" });
      const filas = await cacheado(claveEventos("oh", ruta, pais, desde, hasta), async () => {
        const datos = await pedirJson(`https://openholidaysapi.org/${ruta}?${parametros}`);
        if (!Array.isArray(datos)) throw new FalloFuenteEventos("respuesta inválida");
        return datos as FilaOpenHolidays[];
      });
      for (const fila of filas) {
        // Solo lo nacional: sin subdivisión del viajero, un festivo de un
        // municipio cualquiera sería ruido.
        if (fila.nationwide !== true) continue;
        if (tipo === "festivo" && fila.type !== "Public") continue;
        const nombre = nombreDe(fila.name);
        if (!nombre || !esFecha(fila.startDate) || !esFecha(fila.endDate)) continue;
        eventos.push({
          fecha: fila.startDate,
          ...(fila.endDate !== fila.startDate ? { fecha_fin: fila.endDate } : {}),
          nombre,
          tipo,
          fuente: "openholidays",
          url: URL_OPENHOLIDAYS,
        });
      }
    }
    return eventos;
  }

  async function deNager(pais: string, desde: string, hasta: string): Promise<EventoFuente[]> {
    const eventos: EventoFuente[] = [];
    for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) {
      const filas = await cacheado(claveEventos("nager", pais, String(anio)), async () => {
        const datos = await pedirJson(`https://date.nager.at/api/v3/PublicHolidays/${anio}/${pais}`);
        return Array.isArray(datos) ? (datos as FilaNager[]) : [];
      });
      for (const fila of filas) {
        if (fila.global !== true || !fila.types?.includes("Public") || !esFecha(fila.date)) continue;
        if (fila.date < desde || fila.date > hasta) continue;
        const nombre = limpiarNombre(fila.name ?? fila.localName ?? "");
        if (nombre) eventos.push({ fecha: fila.date, nombre, tipo: "festivo", fuente: "nager", url: urlNager(pais) });
      }
    }
    return eventos;
  }

  return {
    async festivos(pais, desde, hasta) {
      if (!esPais(pais) || !esFecha(desde) || !esFecha(hasta) || hasta < desde) return [];
      const cubiertos = await paisesOpenHolidays();
      return cubiertos.includes(pais) ? deOpenHolidays(pais, desde, hasta) : deNager(pais, desde, hasta);
    },
  };
}
