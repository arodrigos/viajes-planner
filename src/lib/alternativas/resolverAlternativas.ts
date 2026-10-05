// alt-ac1/alt-ac3/alt-ac4: orquesta la resolución de las alternativas de
// cada parada -- primero las que propuso el modelo (resueltas contra
// FuenteLugares y filtradas por equivalencia), y, si quedan menos de 2,
// el complemento sin modelo de Overpass (cercanos.ts). Nunca se llama al
// modelo desde aquí.
import "server-only";
import { normalizarNombre } from "@/lib/lugares/normalizar";
import { resolverNombre, type CualificadorCiudad } from "@/lib/lugares/resolverPlan";
import { resolverFoto } from "@/lib/lugares/resolverFotos";
import type { FuenteFotos, FuenteLugares } from "@/lib/lugares/tipos";
import type { Alternativa, Parada, Plan } from "@/lib/plan/tipos";
import { ETIQUETA_OSM_POR_CATEGORIA, FalloFuenteCercanos, type FuenteCercanos } from "./cercanos";
import { duracionParaCercano } from "./duraciones";
import { distanciaMetros, esEquivalente, mismasCoordenadas } from "./equivalencia";

const MINIMO_ALTERNATIVAS_SIN_COMPLEMENTO = 2;
const MAXIMO_CERCANOS = 3;

// alt-ac4 (hallazgo del gatekeeper, iteración 12): Overpass puede devolver
// la propia parada como "alternativa" de sí misma (el nombre que el
// modelo dio y el nombre oficial de OSM casi nunca son idénticos: "Mercado
// Central de Valencia" -> "Mercat Central" a 2 m), o la de otra parada del
// mismo plan. Un sitio que ya es parte del itinerario no es una
// alternativa, aunque resuelva y sea equivalente.
function identidadesDelPlan(plan: Plan): Set<string> {
  const identidades = new Set<string>();
  for (const dia of plan.dias) {
    for (const parada of dia.paradas) {
      identidades.add(normalizarNombre(parada.nombre));
      if (parada.lugar?.id) identidades.add(parada.lugar.id);
    }
  }
  return identidades;
}

// alt-ac1 (barrido-planes-existentes): exportado para que el tercer
// barrido de completarParadasPendientes reutilice el MISMO filtro, con la
// identidad del plan reconstruida desde las filas de `paradas` en vez del
// objeto `Plan` completo (el barrido no lo tiene: lee la tabla directo).
export function esLaMismaParadaDelPlan(candidato: { nombre: string; lugar?: { id: string } }, identidades: Set<string>): boolean {
  if (identidades.has(normalizarNombre(candidato.nombre))) return true;
  return !!candidato.lugar?.id && identidades.has(candidato.lugar.id);
}

export async function resolverAlternativasPlan(
  fuenteLugares: FuenteLugares,
  fuenteCercanos: FuenteCercanos,
  plan: Plan,
  perfil: string,
  ciudad?: CualificadorCiudad,
  fuenteFotos?: FuenteFotos,
): Promise<Plan> {
  const bbox = ciudad?.caja ?? (await fuenteLugares.geocodificarDestino(plan.destino));
  const cualificador = ciudad?.nombre ?? plan.destino;
  const identidades = identidadesDelPlan(plan);

  const dias = await Promise.all(
    plan.dias.map(async (dia) => ({
      ...dia,
      paradas: await Promise.all(
        dia.paradas.map((parada) =>
          resolverAlternativasParada(fuenteLugares, fuenteCercanos, parada, cualificador, bbox, perfil, identidades, fuenteFotos),
        ),
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
  identidades: Set<string>,
  fuenteFotos?: FuenteFotos,
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
    if (equivalente && !esLaMismaParadaDelPlan(candidata, identidades)) resueltas.push(candidata);
  }

  if (resueltas.length < MINIMO_ALTERNATIVAS_SIN_COMPLEMENTO && parada.coordenadas) {
    // En la generación un fallo de Overpass solo deja la parada sin
    // complemento; el barrido posterior lo reintenta porque no se marca.
    const cercanos = await fuenteCercanos
      .buscar(parada.categoria, parada.coordenadas.lat, parada.coordenadas.lon)
      .catch((error: unknown) => {
        if (error instanceof FalloFuenteCercanos) return [];
        throw error;
      });
    const etiqueta = ETIQUETA_OSM_POR_CATEGORIA[parada.categoria];
    const cercanosAjenos = cercanos.filter(
      (cercano) =>
        !esLaMismaParadaDelPlan({ nombre: cercano.nombre, lugar: { id: cercano.id } }, identidades) &&
        !mismasCoordenadas(parada.coordenadas as { lat: number; lon: number }, cercano),
    );
    for (const cercano of cercanosAjenos.slice(0, MAXIMO_CERCANOS)) {
      const distanciaM = distanciaMetros(parada.coordenadas, cercano);
      resueltas.push({
        nombre: cercano.nombre,
        descripcion: `Sitio cercano de la categoría '${parada.categoria}' según OpenStreetMap.`,
        motivo: `A ${Math.round(distanciaM)} m, misma categoría (${etiqueta}) según OpenStreetMap.`,
        duracion_min: duracionParaCercano(parada.categoria, parada.duracion_min),
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

  // alc-ac4: misma resolución de foto que las paradas. Un fallo de red de
  // Wikipedia/Commons deja esa alternativa sin foto, nunca sin alternativa.
  const conFoto = fuenteFotos
    ? await Promise.all(
        resueltas.map(async (alternativa) => {
          if (alternativa.foto) return alternativa;
          try {
            const foto = await resolverFoto(fuenteFotos, alternativa.lugar, alternativa.categoria, alternativa.coordenadas);
            return foto ? { ...alternativa, foto } : alternativa;
          } catch {
            return alternativa;
          }
        }),
      )
    : resueltas;

  return { ...parada, alternativas: conFoto.length > 0 ? conFoto : undefined };
}
