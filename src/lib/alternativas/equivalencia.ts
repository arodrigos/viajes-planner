// alt-ac3: filtro de equivalencia determinista -- una alternativa (del
// modelo o de Overpass) se guarda SOLO si resolvió y cumple las cuatro
// reglas de abajo. Puro y testeable: nada de red ni de Supabase aquí.
import distance from "@turf/distance";
import type { Alternativa, CategoriaParada, Parada } from "@/lib/plan/tipos";

const TOLERANCIA_DURACION = 0.3;
const DISTANCIA_MAX_FAMILIAR_M = 2000;
const DISTANCIA_MAX_RESTO_M = 3000;

export function distanciaMetros(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return distance([a.lon, a.lat], [b.lon, b.lat], { units: "meters" });
}

function duracionEquivalente(duracionParada: number, duracionAlternativa: number): boolean {
  const tolerancia = duracionParada * TOLERANCIA_DURACION;
  return Math.abs(duracionAlternativa - duracionParada) <= tolerancia;
}

export interface ResultadoEquivalencia {
  equivalente: boolean;
  motivo?: string;
}

// `perfil` decide el radio -2.000 m para el perfil familiar, 3.000 m para
// el resto (diseño, decisión de Adrián sobre el alcance del paseo)-.
export function esEquivalente(
  parada: Pick<Parada, "categoria" | "duracion_min" | "coordenadas">,
  alternativa: Pick<Alternativa, "categoria" | "duracion_min" | "coordenadas">,
  perfil: string,
): ResultadoEquivalencia {
  if (!alternativa.coordenadas) {
    return { equivalente: false, motivo: "la alternativa no resolvió contra ninguna fuente real" };
  }
  if (!parada.coordenadas) {
    return { equivalente: false, motivo: "la parada no tiene coordenadas con las que comparar la distancia" };
  }

  const categoriasCoinciden = (alternativa.categoria as CategoriaParada | undefined) === parada.categoria;
  if (!categoriasCoinciden) {
    return {
      equivalente: false,
      motivo: `categoría '${alternativa.categoria}' distinta de la parada ('${parada.categoria}')`,
    };
  }

  if (!duracionEquivalente(parada.duracion_min, alternativa.duracion_min)) {
    return {
      equivalente: false,
      motivo: `duración ${alternativa.duracion_min} min fuera de ±30 % de ${parada.duracion_min} min`,
    };
  }

  const distanciaMaxima = perfil === "familiar" ? DISTANCIA_MAX_FAMILIAR_M : DISTANCIA_MAX_RESTO_M;
  const distanciaM = distanciaMetros(parada.coordenadas, alternativa.coordenadas);
  if (distanciaM > distanciaMaxima) {
    return {
      equivalente: false,
      motivo: `a ${Math.round(distanciaM)} m de la parada, por encima del máximo de ${distanciaMaxima} m (perfil '${perfil}')`,
    };
  }

  return { equivalente: true };
}
