import type { SupabaseClient } from "@supabase/supabase-js";
import type { EtapaPlan, Parada, Plan } from "../../../lib/plan/tipos";
import { franjasComoArray } from "../../../lib/plan/config-franjas";

// Siembra compartida de los e2e del plan. Los planes se describen como un Plan
// y se insertan con el formato que deja etapas-pais, de modo que el generador
// de goldens de la infografía (scripts/generar-goldens-infografia.ts) dibuja
// exactamente los mismos datos que los tests siembran. Imports relativos y sin
// «server-only»: lo cargan Playwright y tsx, no Next.

export async function sembrarPlan(supabase: SupabaseClient, plan: Plan): Promise<void> {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: plan.id, destino: plan.destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: plan.id,
      version: plan.version,
      personas: plan.personas,
      dias: plan.dias.map((d) => ({ fecha: d.fecha, franjas: d.franjas, ...(d.etapa !== undefined ? { etapa: d.etapa } : {}) })),
      avisos: [],
      etapas: plan.etapas ?? null,
      traslados: plan.traslados ?? null,
      eventos: plan.eventos ?? null,
    })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);

  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  for (const [diaIndex, dia] of plan.dias.entries()) {
    for (const p of dia.paradas) {
      const { error } = await supabase.from("paradas").insert({
        id_externo: p.id,
        plan_version_id: version.id,
        dia_index: diaIndex,
        franja_id: p.franja_id,
        nombre: p.nombre,
        descripcion: p.descripcion,
        lat: p.coordenadas?.lat ?? null,
        lon: p.coordenadas?.lon ?? null,
        duracion_min: p.duracion_min,
        prioridad: p.prioridad,
        coste: p.coste ?? null,
        lugar: p.lugar ?? null,
        resolucion: p.resolucion ?? null,
        procedencia_id: procedencia?.id,
      });
      if (error) throw new Error(`No se pudo sembrar la parada ${p.id}: ${error.message}`);
    }
  }
}

const CAJAS = {
  Lisboa: { minLat: 38.6, maxLat: 38.9, minLon: -9.35, maxLon: -9.0 },
  Coímbra: { minLat: 40.1, maxLat: 40.3, minLon: -8.55, maxLon: -8.3 },
  Oporto: { minLat: 41.0, maxLat: 41.3, minLon: -8.8, maxLon: -8.45 },
};
export const CAJA_LISBOA = CAJAS.Lisboa;
export const CAJA_OPORTO = CAJAS.Oporto;

export const etapaSembrada = (nombre: keyof typeof CAJAS, dias: number, dia_inicio: number, noche: number, ajustes: string[] = [], motivo?: string): EtapaPlan => ({
  ciudad: { estado: "resuelta", nombre, metodo: "destino", caja: CAJAS[nombre], intentado_en: "2026-10-05T00:00:00Z" },
  pais: "Portugal",
  dias,
  dia_inicio,
  ...(motivo ? { motivo } : {}),
  alojamiento_noche_eur: noche,
  zona: 0,
  ajustes,
});

const parada = (id: string, nombre: string, prioridad: number, importe: number): Parada => ({
  id, franja_id: "manana", nombre, descripcion: "Visita", duracion_min: 90, prioridad, procedencia: { fuente: "propuesto-sin-verificar" },
  coste: { importe_eur: importe, por: "persona", procedencia: "estimado", fecha: "2027-06-08" },
});

const fechaDesde = (mes: string, dia0: number, i: number) => `${mes}-${String(dia0 + i).padStart(2, "0")}`;

// ie2e-ac1 (cp-ie2e-01): Portugal, 9 días, tres ciudades de tres días, dos
// traslados en tren, dos paradas por día y dos eventos de fecha fija.
export const PRESUPUESTO_MULTICIUDAD = 3000;
export function planMulticiudadInfografia(id: string): Plan {
  const franjas = franjasComoArray("Portugal");
  const nombres = ["Mosteiro dos Jerónimos y paseo largo por la orilla del Tajo hasta Belém", "Alfama", "Sintra", "Universidad de Coímbra", "Biblioteca Joanina", "Quinta da Regaleira", "Ribeira", "Livraria Lello", "Palacio da Bolsa"];
  return {
    id, version: 1, destino: "Portugal", personas: 2,
    dias: Array.from({ length: 9 }, (_, i) => ({
      fecha: fechaDesde("2027-06", 8, i), franjas, etapa: Math.floor(i / 3),
      paradas: [parada(`m${i}a`, nombres[i], 90 - i, 15), parada(`m${i}b`, `Paseo ${i + 1}`, 40, 0)],
    })),
    etapas: [etapaSembrada("Lisboa", 3, 0, 90), etapaSembrada("Coímbra", 3, 3, 70), etapaSembrada("Oporto", 3, 6, 80)],
    traslados: [
      { desde: "Lisboa", hasta: "Coímbra", modo: "tren", distancia_km: 200, duracion_min: 110, coste_eur: 25, procedencia: "estimado" },
      { desde: "Coímbra", hasta: "Oporto", modo: "tren", distancia_km: 120, duracion_min: 90, coste_eur: 20, procedencia: "estimado" },
    ],
    eventos: {
      estado: "consultado", consultado_en: "2027-01-01T00:00:00Z",
      eventos: [
        { fecha: "2027-06-10", nombre: "Día de Portugal", tipo: "festivo", fuente: "nager", url: "https://date.nager.at", etapa: 0, pais: "PT" },
        { fecha: "2027-06-13", nombre: "Fiesta de San Antonio", tipo: "fiesta", fuente: "wikidata", url: "https://www.wikidata.org", etapa: 1, pais: "PT" },
      ],
    },
  };
}

// ie2e-ac2 (cp-ie2e-02): una ciudad, 10 días, nombres largos, sin etapas.
export const PRESUPUESTO_UNA_CIUDAD_LARGA = 800;
export function planUnaCiudadLargaInfografia(id: string): Plan {
  const franjas = franjasComoArray("Ciudad de prueba con un nombre deliberadamente largo para la lámina");
  return {
    id, version: 1, destino: "Ciudad de prueba con un nombre deliberadamente largo para la lámina", personas: 2,
    dias: Array.from({ length: 10 }, (_, i) => ({
      fecha: fechaDesde("2027-03", 5, i), franjas,
      paradas: [
        parada(`c${i}a`, i === 0 ? "Monasterio de Santo Estevo de Ribas de Sil y paseo por cañones del Sil" : `Mirador ${i + 1}`, 90 - i, 15),
        parada(`c${i}b`, `Paseo ${i + 1}`, 40, 0),
      ],
    })),
  };
}

// enl-ac1 (cp-enl-01): Londres, 1 día. Comida resuelta en OSM, cena sin
// resolver y mañana resuelta en Wikipedia.
export function planLondresEnlaces(id: string): Plan {
  const franjas = franjasComoArray("Londres");
  const resuelta = (fuente: "osm" | "wikipedia", url: string, nombre: string) => ({
    fuente, url, id: url, nombre_fuente: nombre, etiquetas: {}, resuelto_en: "2026-10-05T00:00:00Z",
  });
  return {
    id, version: 1, destino: "Londres", personas: 2,
    dias: [{
      fecha: "2027-05-10", franjas,
      paradas: [
        { ...parada("l1", "British Museum", 90, 0), coordenadas: { lat: 51.5194, lon: -0.127 }, lugar: resuelta("wikipedia", "https://en.wikipedia.org/wiki/British_Museum", "British Museum"), procedencia: { fuente: "wikipedia", url: "https://en.wikipedia.org/wiki/British_Museum" } },
        { ...parada("l2", "Borough Market", 80, 15), franja_id: "comida", coordenadas: { lat: 51.5055, lon: -0.091 }, lugar: resuelta("osm", "https://www.openstreetmap.org/node/1", "Borough Market"), procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/1" } },
        { ...parada("l3", "Cena en Dishoom Covent Garden", 70, 30), franja_id: "cena" },
      ],
    }],
  };
}
