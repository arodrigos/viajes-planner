// alt-ac3: filtro de equivalencia determinista -- una alternativa (del
// modelo o de Overpass) se guarda SOLO si resolvió y cumple las cuatro
// reglas de abajo. Puro y testeable: nada de red ni de Supabase aquí.
import distance from "@turf/distance";
import type { Alternativa, CategoriaParada, Parada } from "@/lib/plan/tipos";
import { DURACION_POR_CATEGORIA } from "./duraciones";

const DISTANCIA_MAX_FAMILIAR_M = 2000;
const DISTANCIA_MAX_RESTO_M = 3000;

export function distanciaMetros(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return distance([a.lon, a.lat], [b.lon, b.lat], { units: "meters" });
}

// Cinco decimales son ~1 m: dos puntos que coinciden a esa precisión son
// el mismo sitio aunque OSM y el modelo lo nombren distinto.
const redondear5 = (n: number): number => Math.round(n * 1e5);

export function mismasCoordenadas(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return redondear5(a.lat) === redondear5(b.lat) && redondear5(a.lon) === redondear5(b.lon);
}

export interface ResultadoEquivalencia {
  equivalente: boolean;
  motivo?: string;
}

// `perfil` decide el radio -2.000 m para el perfil familiar, 3.000 m para
// el resto (diseño, decisión de producto sobre el alcance del paseo)-.
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

  // La duración de la parada (estimada por el modelo) no interviene: solo
  // el rango típico de la categoría.
  const rango = DURACION_POR_CATEGORIA[parada.categoria as CategoriaParada];
  if (rango && (alternativa.duracion_min < rango.min || alternativa.duracion_min > rango.max)) {
    return {
      equivalente: false,
      motivo: `duración ${alternativa.duracion_min} min fuera del rango de '${parada.categoria}' (${rango.min}–${rango.max} min)`,
    };
  }

  if (mismasCoordenadas(parada.coordenadas, alternativa.coordenadas)) {
    return { equivalente: false, motivo: "mismas coordenadas que la propia parada" };
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
