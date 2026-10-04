import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idsExternosVisitados } from "./visitas";
import type { Alternativa, AnclaAlojamiento, Dia, Franja, Lugar, Parada, Plan, Procedencia, Recomendacion } from "./tipos";

// Forma en la que se guardan los días dentro de plan_versiones.dias: todo
// menos las paradas, que tienen su propia tabla porque procedencias y
// visitas (bloques posteriores) necesitan referenciarlas una a una.
interface DiaAlmacenado {
  fecha: string;
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: Franja[];
}

export async function guardarPlan(supabase: SupabaseClient, plan: Plan): Promise<{ version: number }> {
  const { error: errorPlan } = await supabase
    .from("planes")
    .upsert({ id: plan.id, destino: plan.destino }, { onConflict: "id" });
  if (errorPlan) throw new Error(`No se pudo guardar el plan: ${errorPlan.message}`);

  const { data: versionesPrevias, error: errorVersiones } = await supabase
    .from("plan_versiones")
    .select("version")
    .eq("plan_id", plan.id)
    .order("version", { ascending: false })
    .limit(1);
  if (errorVersiones) throw new Error(`No se pudo leer la versión previa: ${errorVersiones.message}`);
  const siguienteVersion = (versionesPrevias?.[0]?.version ?? 0) + 1;

  const diasAlmacenados: DiaAlmacenado[] = plan.dias.map((dia) => ({
    fecha: dia.fecha,
    ancla_alojamiento: dia.ancla_alojamiento,
    franjas: dia.franjas,
  }));

  const { data: versionInsertada, error: errorInsertarVersion } = await supabase
    .from("plan_versiones")
    .insert({
      plan_id: plan.id,
      version: siguienteVersion,
      personas: plan.personas,
      dias: diasAlmacenados,
      avisos: plan.avisos ?? [],
      recomendaciones: plan.recomendaciones ?? [],
    })
    .select("id")
    .single();
  if (errorInsertarVersion || !versionInsertada) {
    throw new Error(`No se pudo crear la versión del plan: ${errorInsertarVersion?.message}`);
  }
  const planVersionId = versionInsertada.id as string;

  for (const [diaIndex, dia] of plan.dias.entries()) {
    for (const parada of dia.paradas) {
      // El CHECK de `procedencias.fuente` solo admite 'propuesto-sin-verificar'
      // (migración 005); la procedencia real ('osm'/'wikipedia') se deriva al
      // LEER a partir de `lugar`, nunca se escribe aquí -- aunque `parada`
      // venga de un `recuperarPlan` previo (sustituirParada) con `procedencia`
      // ya derivada a 'osm'/'wikipedia', lo que se guarda es siempre el valor
      // fijo que el CHECK acepta.
      const { data: procedenciaInsertada, error: errorProcedencia } = await supabase
        .from("procedencias")
        .insert({ fuente: "propuesto-sin-verificar" })
        .select("id")
        .single();
      if (errorProcedencia || !procedenciaInsertada) {
        throw new Error(`No se pudo guardar la procedencia: ${errorProcedencia?.message}`);
      }

      const { data: paradaInsertada, error: errorParada } = await supabase
        .from("paradas")
        .insert({
          id_externo: parada.id,
          plan_version_id: planVersionId,
          dia_index: diaIndex,
          franja_id: parada.franja_id,
          nombre: parada.nombre,
          descripcion: parada.descripcion,
          lat: parada.coordenadas?.lat ?? null,
          lon: parada.coordenadas?.lon ?? null,
          duracion_min: parada.duracion_min,
          prioridad: parada.prioridad,
          procedencia_id: procedenciaInsertada.id,
          categoria: parada.categoria ?? null,
          lugar: parada.lugar ?? null,
          foto: parada.foto ?? null,
          resolucion: parada.resolucion ?? null,
          foto_intentada_en: parada.foto_intentada_en ?? null,
        })
        .select("id")
        .single();
      if (errorParada || !paradaInsertada) throw new Error(`No se pudo guardar la parada '${parada.id}': ${errorParada?.message}`);

      // alt-ac3: solo las alternativas que ya pasaron el filtro de
      // equivalencia llegan aquí (resolverAlternativasPlan) -- se guardan
      // todas tal cual, sin ningún filtro adicional en el repositorio.
      // `categoria` es opcional en el tipo (p. ej. la parada sustituida que
      // sustituir.ts convierte en alternativa puede no tenerla si el modelo
      // nunca la dio), pero la columna es NOT NULL: mismo "otro" de reserva
      // que ya usa el enum para la parada sin categoría.
      for (const alternativa of parada.alternativas ?? []) {
        const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
          parada_id: paradaInsertada.id,
          origen: alternativa.origen,
          nombre: alternativa.nombre,
          descripcion: alternativa.descripcion,
          motivo: alternativa.motivo,
          duracion_min: alternativa.duracion_min,
          categoria: alternativa.categoria ?? "otro",
          lat: alternativa.coordenadas?.lat ?? null,
          lon: alternativa.coordenadas?.lon ?? null,
          lugar: alternativa.lugar ?? null,
          foto: alternativa.foto ?? null,
        });
        if (errorAlternativa) {
          throw new Error(`No se pudo guardar la alternativa '${alternativa.nombre}' de la parada '${parada.id}': ${errorAlternativa.message}`);
        }
      }
    }
  }

  return { version: siguienteVersion };
}

export async function recuperarPlan(
  supabase: SupabaseClient,
  planId: string,
  version?: number,
): Promise<Plan | null> {
  const { data: planRow, error: errorPlan } = await supabase
    .from("planes")
    .select("id, destino")
    .eq("id", planId)
    .maybeSingle();
  if (errorPlan) throw new Error(`No se pudo leer el plan: ${errorPlan.message}`);
  if (!planRow) return null;

  let consultaVersion = supabase
    .from("plan_versiones")
    .select("id, version, personas, dias, avisos, recomendaciones")
    .eq("plan_id", planId);
  consultaVersion =
    version === undefined
      ? consultaVersion.order("version", { ascending: false }).limit(1)
      : consultaVersion.eq("version", version);
  const { data: versionRows, error: errorVersion } = await consultaVersion;
  if (errorVersion) throw new Error(`No se pudo leer la versión del plan: ${errorVersion.message}`);
  const versionRow = versionRows?.[0];
  if (!versionRow) return null;

  const { data: paradaRows, error: errorParadas } = await supabase
    .from("paradas")
    .select(
      "id, id_externo, dia_index, franja_id, nombre, descripcion, lat, lon, duracion_min, prioridad, categoria, lugar, foto, resolucion, procedencias(fuente)",
    )
    .eq("plan_version_id", versionRow.id)
    .order("dia_index", { ascending: true });
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);

  // alt-ac5: las alternativas se leen aparte, indexadas por el id INTERNO
  // de la parada (paradas.id, nunca id_externo -- es la clave real de la
  // FK) y se adjuntan al construir cada Parada pública más abajo.
  const idsParadas = (paradaRows ?? []).map((fila) => fila.id as string);
  const { data: alternativaRows, error: errorAlternativas } =
    idsParadas.length > 0
      ? await supabase
          .from("paradas_alternativas")
          .select("id, parada_id, origen, nombre, descripcion, motivo, duracion_min, categoria, lat, lon, lugar, foto")
          .in("parada_id", idsParadas)
      : { data: [] as never[], error: null };
  if (errorAlternativas) throw new Error(`No se pudieron leer las alternativas: ${errorAlternativas.message}`);

  // dest-ac4: a través de CUALQUIER versión de este plan, nunca solo de la
  // que se está leyendo -- es lo que hace que la marca sobreviva a una
  // sustitución (nueva versión, mismo id_externo).
  const idsVisitados = await idsExternosVisitados(supabase, planId);

  const alternativasPorParadaId = new Map<string, Alternativa[]>();
  for (const fila of alternativaRows ?? []) {
    const lat = fila.lat as number | null;
    const lon = fila.lon as number | null;
    const alternativa: Alternativa = {
      id: fila.id as string,
      nombre: fila.nombre as string,
      descripcion: fila.descripcion as string,
      motivo: fila.motivo as string,
      duracion_min: fila.duracion_min as number,
      categoria: fila.categoria as Alternativa["categoria"],
      origen: fila.origen as Alternativa["origen"],
      ...(lat !== null && lon !== null ? { coordenadas: { lat, lon } } : {}),
      ...(fila.lugar ? { lugar: fila.lugar as Lugar } : {}),
      ...(fila.foto ? { foto: fila.foto as Alternativa["foto"] } : {}),
    };
    const listaExistente = alternativasPorParadaId.get(fila.parada_id as string) ?? [];
    listaExistente.push(alternativa);
    alternativasPorParadaId.set(fila.parada_id as string, listaExistente);
  }

  const diasAlmacenados = versionRow.dias as DiaAlmacenado[];
  const dias: Dia[] = diasAlmacenados.map((diaMeta, indice) => {
    const paradasDelDia: Parada[] = (paradaRows ?? [])
      .filter((fila) => fila.dia_index === indice)
      .map((fila) => {
        const lat = fila.lat as number | null;
        const lon = fila.lon as number | null;
        const lugar = fila.lugar as Lugar | null;
        // lug-ac1: la procedencia PÚBLICA se deriva aquí a partir de
        // `lugar`, nunca de la tabla `procedencias` (su CHECK solo admite
        // 'propuesto-sin-verificar': ver el porqué en tipos.ts).
        const procedencia: Procedencia = lugar ? { fuente: lugar.fuente, url: lugar.url } : { fuente: "propuesto-sin-verificar" };
        const alternativas = alternativasPorParadaId.get(fila.id as string);
        return {
          id: fila.id_externo as string,
          franja_id: fila.franja_id as string,
          nombre: fila.nombre as string,
          descripcion: fila.descripcion as string,
          duracion_min: fila.duracion_min as number,
          prioridad: fila.prioridad as number,
          procedencia,
          ...(lat !== null && lon !== null ? { coordenadas: { lat, lon } } : {}),
          ...(fila.categoria ? { categoria: fila.categoria as Parada["categoria"] } : {}),
          ...(lugar ? { lugar } : {}),
          ...(fila.foto ? { foto: fila.foto as Parada["foto"] } : {}),
          ...(fila.resolucion ? { resolucion: fila.resolucion as Parada["resolucion"] } : {}),
          ...(alternativas && alternativas.length > 0 ? { alternativas } : {}),
          ...(idsVisitados.has(fila.id_externo as string) ? { visitada: true } : {}),
        };
      });
    return {
      fecha: diaMeta.fecha,
      ancla_alojamiento: diaMeta.ancla_alojamiento,
      franjas: diaMeta.franjas,
      paradas: paradasDelDia,
    };
  });

  return {
    id: planRow.id as string,
    version: versionRow.version as number,
    destino: planRow.destino as string,
    personas: versionRow.personas as number,
    dias,
    avisos: (versionRow.avisos as string[] | null) ?? [],
    recomendaciones: (versionRow.recomendaciones as Recomendacion[] | null) ?? [],
  };
}
