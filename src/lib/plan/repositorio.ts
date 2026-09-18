import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnclaAlojamiento, Dia, Franja, Parada, Plan } from "./tipos";

// Forma en la que se guardan los días dentro de plan_versiones.dias: todo
// menos las paradas, que tienen su propia tabla porque procedencias y
// visitas (bloques posteriores) necesitan referenciarlas una a una.
interface DiaAlmacenado {
  fecha: string;
  ancla_alojamiento: AnclaAlojamiento;
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
    .insert({ plan_id: plan.id, version: siguienteVersion, personas: plan.personas, dias: diasAlmacenados })
    .select("id")
    .single();
  if (errorInsertarVersion || !versionInsertada) {
    throw new Error(`No se pudo crear la versión del plan: ${errorInsertarVersion?.message}`);
  }
  const planVersionId = versionInsertada.id as string;

  for (const [diaIndex, dia] of plan.dias.entries()) {
    for (const parada of dia.paradas) {
      const { data: procedenciaInsertada, error: errorProcedencia } = await supabase
        .from("procedencias")
        .insert({ fuente: parada.procedencia.fuente, url: parada.procedencia.url ?? null })
        .select("id")
        .single();
      if (errorProcedencia || !procedenciaInsertada) {
        throw new Error(`No se pudo guardar la procedencia: ${errorProcedencia?.message}`);
      }

      const { error: errorParada } = await supabase.from("paradas").insert({
        id_externo: parada.id,
        plan_version_id: planVersionId,
        dia_index: diaIndex,
        franja_id: parada.franja_id,
        sitio_nombre: parada.sitio.nombre,
        sitio_lat: parada.sitio.lat,
        sitio_lon: parada.sitio.lon,
        duracion_min: parada.duracion_min,
        prioridad: parada.prioridad,
        procedencia_id: procedenciaInsertada.id,
      });
      if (errorParada) throw new Error(`No se pudo guardar la parada '${parada.id}': ${errorParada.message}`);
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
    .select("id, version, personas, dias")
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
    .select("id_externo, dia_index, franja_id, sitio_nombre, sitio_lat, sitio_lon, duracion_min, prioridad, procedencias(fuente, url)")
    .eq("plan_version_id", versionRow.id)
    .order("dia_index", { ascending: true });
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);

  const diasAlmacenados = versionRow.dias as DiaAlmacenado[];
  const dias: Dia[] = diasAlmacenados.map((diaMeta, indice) => {
    const paradasDelDia: Parada[] = (paradaRows ?? [])
      .filter((fila) => fila.dia_index === indice)
      .map((fila) => {
        const procedencia = Array.isArray(fila.procedencias) ? fila.procedencias[0] : fila.procedencias;
        return {
          id: fila.id_externo as string,
          franja_id: fila.franja_id as string,
          sitio: { nombre: fila.sitio_nombre as string, lat: fila.sitio_lat as number, lon: fila.sitio_lon as number },
          duracion_min: fila.duracion_min as number,
          prioridad: fila.prioridad as number,
          procedencia: { fuente: procedencia.fuente, url: procedencia.url ?? undefined },
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
  };
}
