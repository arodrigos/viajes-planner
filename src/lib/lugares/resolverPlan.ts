import "server-only";
import type { CategoriaParada, InfoResolucion, Lugar, Parada, Plan } from "@/lib/plan/tipos";
import { elegirMejorCandidato } from "./aceptacion";
import type { CajaDelimitadora, CandidatoLugar, FuenteLugares } from "./tipos";

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
  const resultado = await resolverNombre(fuente, parada.nombre, parada.categoria, destino, bbox);
  return { ...parada, ...resultado };
}

export interface ResolucionLugar {
  coordenadas?: { lat: number; lon: number };
  lugar?: Lugar;
  resolucion: InfoResolucion;
}

// Núcleo de la resolución, sin nada de Parada/Plan: lo reutiliza
// resolverParada (una parada recién generada por el modelo) y el barrido
// del bloque relleno-planes-existentes (una parada ya guardada que se
// resuelve en segundo plano, sin un objeto Parada completo a mano).
export async function resolverNombre(
  fuente: FuenteLugares,
  nombre: string,
  categoria: CategoriaParada | undefined,
  destino: string,
  bbox: CajaDelimitadora | null,
): Promise<ResolucionLugar> {
  const ahora = new Date().toISOString();

  if (!bbox) {
    return { resolucion: { estado: "error", intentado_en: ahora, motivo: "no se pudo geocodificar el destino" } };
  }

  try {
    const candidatosNominatim = await fuente.buscarNominatim(nombre, destino, bbox);
    const elegidoNominatim = elegirMejorCandidato(nombre, candidatosNominatim, bbox, categoria);
    if (elegidoNominatim.candidato) {
      return lugarResuelto(elegidoNominatim.candidato, ahora);
    }

    const candidatosWikipedia = await fuente.buscarWikipedia(nombre, destino, bbox);
    const elegidoWikipedia = elegirMejorCandidato(nombre, candidatosWikipedia, bbox, categoria);
    if (elegidoWikipedia.candidato) {
      return lugarResuelto(elegidoWikipedia.candidato, ahora);
    }

    return { resolucion: { estado: "no-resuelta", intentado_en: ahora, motivo: elegidoWikipedia.motivo } };
  } catch (error) {
    return {
      resolucion: {
        estado: "error",
        intentado_en: ahora,
        motivo: error instanceof Error ? error.message : "fallo desconocido al resolver",
      },
    };
  }
}

function lugarResuelto(candidato: CandidatoLugar, ahora: string): ResolucionLugar {
  return {
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
