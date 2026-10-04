// alt-ac1/alt-ac3/alt-ac4: orquesta la resolución de las alternativas de
// cada parada -- primero las que propuso el modelo (resueltas contra
// FuenteLugares y filtradas por equivalencia), y, si quedan menos de 2,
// el complemento sin modelo de Overpass (cercanos.ts). Nunca se llama al
// modelo desde aquí.
import "server-only";
import { resolverNombre } from "@/lib/lugares/resolverPlan";
import type { FuenteLugares } from "@/lib/lugares/tipos";
import type { Alternativa, Parada, Plan } from "@/lib/plan/tipos";
import { ETIQUETA_OSM_POR_CATEGORIA, type FuenteCercanos } from "./cercanos";
import { distanciaMetros, esEquivalente } from "./equivalencia";

const MINIMO_ALTERNATIVAS_SIN_COMPLEMENTO = 2;
const MAXIMO_CERCANOS = 3;

export async function resolverAlternativasPlan(
  fuenteLugares: FuenteLugares,
  fuenteCercanos: FuenteCercanos,
  plan: Plan,
  perfil: string,
): Promise<Plan> {
  const bbox = await fuenteLugares.geocodificarDestino(plan.destino);

  const dias = await Promise.all(
    plan.dias.map(async (dia) => ({
      ...dia,
      paradas: await Promise.all(
        dia.paradas.map((parada) => resolverAlternativasParada(fuenteLugares, fuenteCercanos, parada, plan.destino, bbox, perfil)),
      ),
    })),
  );

  return { ...plan, dias };
}

async function resolverAlternativasParada(
  fuenteLugares: FuenteLugares,
  fuenteCercanos: FuenteCercanos,
  parada: Parada,
  destino: string,
  bbox: Awaited<ReturnType<FuenteLugares["geocodificarDestino"]>>,
  perfil: string,
): Promise<Parada> {
  const propuestas = parada.alternativas ?? [];
  // Sin categoria no hay con qué comparar equivalencia ni qué pedir a
  // Overpass: las propuestas del modelo se descartan (ninguna resuelve a
  // nada comprobado) en vez de guardarse sin verificar.
  if (!parada.categoria) return { ...parada, alternativas: undefined };

  const resueltas: Alternativa[] = [];
  for (const propuesta of propuestas) {
    const resolucion = await resolverNombre(fuenteLugares, propuesta.nombre, parada.categoria, destino, bbox);
    const candidata: Alternativa = {
      ...propuesta,
      categoria: parada.categoria,
      origen: "modelo",
      coordenadas: resolucion.coordenadas,
      lugar: resolucion.lugar,
    };
    const { equivalente } = esEquivalente(parada, candidata, perfil);
    if (equivalente) resueltas.push(candidata);
  }

  if (resueltas.length < MINIMO_ALTERNATIVAS_SIN_COMPLEMENTO && parada.coordenadas) {
    const cercanos = await fuenteCercanos.buscar(parada.categoria, parada.coordenadas.lat, parada.coordenadas.lon);
    const etiqueta = ETIQUETA_OSM_POR_CATEGORIA[parada.categoria];
    for (const cercano of cercanos.slice(0, MAXIMO_CERCANOS)) {
      const distanciaM = distanciaMetros(parada.coordenadas, cercano);
      resueltas.push({
        nombre: cercano.nombre,
        descripcion: `Sitio cercano de la categoría '${parada.categoria}' según OpenStreetMap.`,
        motivo: `A ${Math.round(distanciaM)} m, misma categoría (${etiqueta}) según OpenStreetMap.`,
        duracion_min: parada.duracion_min,
        categoria: parada.categoria,
        origen: "cercano",
        coordenadas: { lat: cercano.lat, lon: cercano.lon },
        lugar: {
          fuente: "osm",
          id: cercano.id,
          url: `https://www.openstreetmap.org/${cercano.id.replace("osm:", "")}`,
          nombre_fuente: cercano.nombre,
          etiquetas: {},
          resuelto_en: new Date().toISOString(),
        },
      });
    }
  }

  return { ...parada, alternativas: resueltas.length > 0 ? resueltas : undefined };
}
