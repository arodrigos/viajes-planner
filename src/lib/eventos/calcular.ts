import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { EtapaPlan } from "@/lib/plan/tipos";
import { FalloFuenteEventos, type EventoFuente, type FuenteFestivos } from "./festivos";
import { esFecha, normalizarNombre } from "./seguridad";
import type { Evento } from "./tipos";
import type { FiestaWikidata, FuenteWikidata } from "./wikidata";

export interface FuenteEventos {
  festivos: FuenteFestivos;
  wikidata: FuenteWikidata;
}

// Un tramo del viaje en una ciudad: la etapa en un viaje de varias, todo el
// viaje en uno de una ciudad.
export interface SegmentoEventos {
  etapa: number;
  ciudad: string;
  desde: string;
  hasta: string;
}

export interface VersionParaEventos {
  id: string;
  ciudad: CiudadEfectiva | null;
  dias: Array<{ fecha: string }>;
  etapas?: EtapaPlan[] | null;
}

export function segmentosDe(version: VersionParaEventos): SegmentoEventos[] {
  const fechas = version.dias.map((d) => d.fecha).filter(esFecha);
  if (fechas.length === 0 || fechas.length !== version.dias.length) return [];
  if (version.etapas && version.etapas.length > 0) {
    const segmentos: SegmentoEventos[] = [];
    version.etapas.forEach((etapa, indice) => {
      const dias = fechas.slice(etapa.dia_inicio, etapa.dia_inicio + etapa.dias);
      const nombre = etapa.ciudad.estado === "resuelta" ? etapa.ciudad.nombre : undefined;
      if (dias.length > 0 && nombre) segmentos.push({ etapa: indice, ciudad: nombre, desde: dias[0]!, hasta: dias[dias.length - 1]! });
    });
    return segmentos;
  }
  const nombre = version.ciudad?.estado === "resuelta" ? version.ciudad.nombre : undefined;
  return nombre ? [{ etapa: 0, ciudad: nombre, desde: fechas[0]!, hasta: fechas[fechas.length - 1]! }] : [];
}

const mayor = (a: string, b: string) => (a > b ? a : b);
const menor = (a: string, b: string) => (a < b ? a : b);

// Recorta un rango al tramo; null si no se tocan. Todo el filtrado de fechas
// se hace aquí, en código, no en la consulta a la fuente.
function recortar(fecha: string, fin: string | undefined, s: SegmentoEventos): { fecha: string; fecha_fin?: string } | null {
  const hastaEvento = fin ?? fecha;
  if (hastaEvento < s.desde || fecha > s.hasta) return null;
  const inicio = mayor(fecha, s.desde);
  const final = menor(hastaEvento, s.hasta);
  return final > inicio ? { fecha: inicio, fecha_fin: final } : { fecha: inicio };
}

export function filtrarFestivos(candidatos: EventoFuente[], s: SegmentoEventos, pais: string): Evento[] {
  const salida: Evento[] = [];
  for (const c of candidatos) {
    if (c.tipo === "fiesta") continue;
    const rango = recortar(c.fecha, c.fecha_fin, s);
    // El spread de `c` arrastraría su fecha_fin original cuando el recorte deja un solo día.
    if (rango) {
      const evento: Evento = { ...c, ...rango, etapa: s.etapa, pais };
      if (!rango.fecha_fin) delete evento.fecha_fin;
      salida.push(evento);
    }
  }
  return salida;
}

export function filtrarFiestas(fiestas: FiestaWikidata[], s: SegmentoEventos, pais: string | undefined): Evento[] {
  const salida: Evento[] = [];
  const anios: number[] = [];
  for (let a = Number(s.desde.slice(0, 4)); a <= Number(s.hasta.slice(0, 4)); a++) anios.push(a);
  for (const f of fiestas) {
    const fechas: Array<{ fecha: string; fin?: string }> = [];
    if (f.fecha) fechas.push({ fecha: f.fecha, ...(f.fecha_fin ? { fin: f.fecha_fin } : {}) });
    else if (f.mes !== undefined && f.dia !== undefined) {
      for (const a of anios) {
        const iso = `${a}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
        if (esFecha(iso)) fechas.push({ fecha: iso });
      }
    }
    for (const { fecha, fin } of fechas) {
      const rango = recortar(fecha, fin, s);
      if (rango) salida.push({ ...rango, nombre: f.nombre, tipo: "fiesta", fuente: "wikidata", url: f.url, etapa: s.etapa, ...(pais ? { pais } : {}) });
    }
  }
  return salida;
}

const PESO_TIPO = { festivo: 0, vacaciones: 1, fiesta: 2 } as const;

export function deduplicarYOrdenar(eventos: Evento[]): Evento[] {
  const vistos = new Set<string>();
  const unicos: Evento[] = [];
  for (const e of eventos) {
    const clave = `${e.fecha}|${normalizarNombre(e.nombre)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(e);
  }
  return unicos.sort((a, b) => a.fecha.localeCompare(b.fecha) || PESO_TIPO[a.tipo] - PESO_TIPO[b.tipo] || a.nombre.localeCompare(b.nombre));
}

// Consulta las fuentes de cada tramo. Un fallo de red de una fuente no
// tumba el resto: se devuelven los eventos que sí llegaron y `fallo: true`.
export async function calcularEventos(fuentes: FuenteEventos, segmentos: SegmentoEventos[]): Promise<{ eventos: Evento[]; fallo: boolean }> {
  const eventos: Evento[] = [];
  let fallo = false;
  for (const segmento of segmentos) {
    try {
      const ciudad = await fuentes.wikidata.ciudad(segmento.ciudad);
      if (!ciudad) continue;
      if (ciudad.pais) {
        const festivos = await fuentes.festivos.festivos(ciudad.pais, segmento.desde, segmento.hasta);
        eventos.push(...filtrarFestivos(festivos, segmento, ciudad.pais));
      }
      eventos.push(...filtrarFiestas(ciudad.fiestas, segmento, ciudad.pais ?? undefined));
    } catch (error) {
      if (!(error instanceof FalloFuenteEventos)) throw error;
      fallo = true;
    }
  }
  return { eventos: deduplicarYOrdenar(eventos), fallo };
}
