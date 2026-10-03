import "server-only";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { elegirMejorCandidato } from "./aceptacion";
import type { CajaDelimitadora, FuenteLugares } from "./tipos";

// lug-ac1: resuelve cada parada del plan contra la fuente de lugares.
// Nunca hace fallar el plan -- una parada que no resuelve se queda sin
// coordenadas, con resolucion.estado y un motivo, y el plan se guarda
// igual. El orden de intento es Nominatim primero, Wikipedia como
// respaldo solo si Nominatim no dio ningún candidato aceptable.
export async function resolverPlan(fuente: FuenteLugares, plan: Plan): Promise<Plan> {
  const bbox = await fuente.geocodificarDestino(plan.destino);

  const dias = await Promise.all(
    plan.dias.map(async (dia) => ({
      ...dia,
      paradas: await Promise.all(dia.paradas.map((parada) => resolverParada(fuente, parada, plan.destino, bbox))),
    })),
  );

  return { ...plan, dias };
}

async function resolverParada(fuente: FuenteLugares, parada: Parada, destino: string, bbox: CajaDelimitadora | null): Promise<Parada> {
  const ahora = new Date().toISOString();

  if (!bbox) {
    return {
      ...parada,
      resolucion: { estado: "error", intentado_en: ahora, motivo: "no se pudo geocodificar el destino" },
    };
  }

  try {
    const candidatosNominatim = await fuente.buscarNominatim(parada.nombre, destino, bbox);
    const elegidoNominatim = elegirMejorCandidato(parada.nombre, candidatosNominatim, bbox, parada.categoria);
    if (elegidoNominatim.candidato) {
      return paradaResuelta(parada, elegidoNominatim.candidato, ahora);
    }

    const candidatosWikipedia = await fuente.buscarWikipedia(parada.nombre, destino, bbox);
    const elegidoWikipedia = elegirMejorCandidato(parada.nombre, candidatosWikipedia, bbox, parada.categoria);
    if (elegidoWikipedia.candidato) {
      return paradaResuelta(parada, elegidoWikipedia.candidato, ahora);
    }

    return {
      ...parada,
      resolucion: { estado: "no-resuelta", intentado_en: ahora, motivo: elegidoWikipedia.motivo },
    };
  } catch (error) {
    return {
      ...parada,
      resolucion: {
        estado: "error",
        intentado_en: ahora,
        motivo: error instanceof Error ? error.message : "fallo desconocido al resolver",
      },
    };
  }
}

function paradaResuelta(parada: Parada, candidato: Awaited<ReturnType<FuenteLugares["buscarNominatim"]>>[number], ahora: string): Parada {
  return {
    ...parada,
    coordenadas: { lat: candidato.lat, lon: candidato.lon },
    lugar: {
      fuente: candidato.fuente,
      id: candidato.id,
      url: candidato.url,
      nombre_fuente: candidato.nombreFuente,
      etiquetas: candidato.etiquetas,
      resuelto_en: ahora,
    },
    resolucion: { estado: "resuelta", intentado_en: ahora },
  };
}
