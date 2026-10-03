import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverNombre } from "@/lib/lugares/resolverPlan";
import type { CajaDelimitadora, FuenteLugares } from "@/lib/lugares/tipos";
import type { CategoriaParada } from "@/lib/plan/tipos";

export const LIMITE_BARRIDO_DEFECTO = 40;
const DIAS_CADUCIDAD_NO_RESUELTA = 30;

export interface CandidatoPendiente {
  paradaId: string;
  fecha: string;
}

// rel-ac3: la métrica es la distancia absoluta a hoy, no la fecha en bruto
// -- así "hoy" o "en curso" gana siempre, y un viaje lejano en el futuro
// pierde contra uno ya pasado exactamente igual que contra uno próximo,
// que es lo que pide el criterio ("lejanos O pasados" al mismo nivel).
export function seleccionarPendientes<T extends CandidatoPendiente>(
  candidatos: T[],
  limite: number,
  hoy: string = new Date().toISOString().slice(0, 10),
): T[] {
  const hoyMs = Date.parse(hoy);
  return [...candidatos]
    .sort((a, b) => Math.abs(Date.parse(a.fecha) - hoyMs) - Math.abs(Date.parse(b.fecha) - hoyMs))
    .slice(0, limite);
}

interface FilaParada {
  id: string;
  nombre: string;
  categoria: CategoriaParada | null;
  dia_index: number;
  plan_version_id: string;
  resolucion: { estado: "resuelta" | "no-resuelta" | "error"; intentado_en: string } | null;
}

interface VersionConDestino {
  id: string;
  destino: string;
  dias: Array<{ fecha: string }>;
}

function estaPendiente(resolucion: FilaParada["resolucion"], cutoffIso: string): boolean {
  if (!resolucion) return true;
  if (resolucion.estado === "error") return true;
  if (resolucion.estado === "no-resuelta") return resolucion.intentado_en < cutoffIso;
  return false;
}

// rel-ac1/rel-ac2: cumple la decisión de Adrián sobre los viajes ya
// guardados -- coordenadas (y, cuando exista fotos-paradas, fotos) sin
// invocar al modelo y sin regenerar el plan. Reutiliza el mismo módulo de
// resolución y el mismo ritmo que la generación (la caché y el limitador
// viven dentro de `fuente`); un fallo en una parada concreta queda en
// `resolucion.estado='error'` y nunca interrumpe el barrido ni el tick.
export async function completarParadasPendientes(
  supabase: SupabaseClient,
  fuente: FuenteLugares,
  limite: number = LIMITE_BARRIDO_DEFECTO,
): Promise<number> {
  const { data: trabajosVivos, error: errorTrabajos } = await supabase
    .from("trabajos")
    .select("plan_id")
    .is("eliminado_en", null)
    .not("plan_id", "is", null);
  if (errorTrabajos) throw new Error(`No se pudo leer los planes vivos: ${errorTrabajos.message}`);
  const planIdsVivos = [...new Set((trabajosVivos ?? []).map((fila) => fila.plan_id as string))];
  if (planIdsVivos.length === 0) return 0;

  const { data: versiones, error: errorVersiones } = await supabase
    .from("plan_versiones")
    .select("id, plan_id, dias, planes(destino)")
    .in("plan_id", planIdsVivos)
    .order("version", { ascending: false });
  if (errorVersiones) throw new Error(`No se pudieron leer las versiones: ${errorVersiones.message}`);

  // Solo la ÚLTIMA versión de cada plan (la primera que aparece tras
  // ordenar por version descendente): las versiones anteriores quedan
  // congeladas en el historial y no necesitan barrido.
  const ultimaVersionPorPlan = new Map<string, VersionConDestino>();
  for (const fila of versiones ?? []) {
    const planId = fila.plan_id as string;
    if (ultimaVersionPorPlan.has(planId)) continue;
    const planesRelacionados = fila.planes as { destino: string } | { destino: string }[] | null;
    const destino = Array.isArray(planesRelacionados) ? planesRelacionados[0]?.destino : planesRelacionados?.destino;
    if (!destino) continue;
    ultimaVersionPorPlan.set(planId, {
      id: fila.id as string,
      destino,
      dias: fila.dias as Array<{ fecha: string }>,
    });
  }
  const versionPorId = new Map<string, VersionConDestino>();
  for (const version of ultimaVersionPorPlan.values()) versionPorId.set(version.id, version);
  const versionIds = [...versionPorId.keys()];
  if (versionIds.length === 0) return 0;

  const { data: paradas, error: errorParadas } = await supabase
    .from("paradas")
    .select("id, nombre, categoria, dia_index, plan_version_id, resolucion")
    .in("plan_version_id", versionIds);
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);

  const cutoffIso = new Date(Date.now() - DIAS_CADUCIDAD_NO_RESUELTA * 24 * 60 * 60 * 1000).toISOString();

  const candidatos = (paradas as FilaParada[] | null ?? [])
    .filter((fila) => estaPendiente(fila.resolucion, cutoffIso))
    .map((fila) => {
      const version = versionPorId.get(fila.plan_version_id);
      return {
        paradaId: fila.id,
        nombre: fila.nombre,
        categoria: fila.categoria ?? undefined,
        destino: version?.destino ?? "",
        // Sin día reconocible (no debería pasar: dia_index siempre viene de
        // un plan guardado con tantos días como el jsonb de su versión),
        // una fecha muy lejana la manda al final en vez de reventar.
        fecha: version?.dias[fila.dia_index]?.fecha ?? "9999-12-31",
      };
    })
    .filter((candidato) => candidato.destino !== "");

  const seleccionados = seleccionarPendientes(candidatos, limite);
  const bboxPorDestino = new Map<string, CajaDelimitadora | null>();

  for (const candidato of seleccionados) {
    try {
      if (!bboxPorDestino.has(candidato.destino)) {
        bboxPorDestino.set(candidato.destino, await fuente.geocodificarDestino(candidato.destino));
      }
      const bbox = bboxPorDestino.get(candidato.destino) ?? null;
      const resultado = await resolverNombre(fuente, candidato.nombre, candidato.categoria, candidato.destino, bbox);
      const { error: errorUpdate } = await supabase
        .from("paradas")
        .update({
          lat: resultado.coordenadas?.lat ?? null,
          lon: resultado.coordenadas?.lon ?? null,
          lugar: resultado.lugar ?? null,
          resolucion: resultado.resolucion,
        })
        .eq("id", candidato.paradaId);
      if (errorUpdate) throw new Error(errorUpdate.message);
    } catch (error) {
      await supabase
        .from("paradas")
        .update({
          resolucion: {
            estado: "error",
            intentado_en: new Date().toISOString(),
            motivo: error instanceof Error ? error.message : "fallo desconocido en el barrido",
          },
        })
        .eq("id", candidato.paradaId);
    }
  }

  return seleccionados.length;
}
