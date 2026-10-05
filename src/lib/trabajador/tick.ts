import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tomarSiguienteTrabajo } from "@/lib/cola/tomar";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { completarParadasPendientes, type ContadoresAlternativas, LIMITE_BARRIDO_DEFECTO, PRESUPUESTO_BARRIDO_MS_DEFECTO } from "./barrido";
import { relojReal } from "@/lib/lugares/limitador";
import { adquirirCerrojo, liberarCerrojo } from "./cerrojo";
import { ESPERA_OCIOSA_MS, INTERVALO_REINTENTO_OCIOSO_MS } from "./config";
import type { EjecutorModelo } from "./ejecutorModelo";
import { procesarTrabajo } from "./procesarTrabajo";
import { crearFuenteAbierta } from "@/lib/lugares/fuenteAbierta";
import { cacheSitiosSupabase } from "@/lib/lugares/cacheSitios";
import type { FuenteGuia } from "@/lib/guia/wikivoyage";
import { crearFuenteFotosAbierta } from "@/lib/lugares/fuenteFotosAbierta";
import { crearFuenteCercanosAbierta, type FuenteCercanos } from "@/lib/alternativas/cercanos";
import { ORIGEN_PASADA_ALTERNATIVAS } from "@/lib/salud";
import type { FuenteCiudad, FuenteFotos, FuenteLugares } from "@/lib/lugares/tipos";

export interface ResultadoTick {
  cerrojoAdquirido: boolean;
  trabajosProcesados: number;
}

export interface OpcionesTick {
  ejecutor: EjecutorModelo;
  directorio: string;
  tomadoPor?: string;
  esperaOciosaMs?: number;
  intervaloOciosoMs?: number;
  // bar-ac1: completarParadasPendientes exige FuenteCiudad (la puerta de la
  // ciudad es obligatoria, no opcional) -- crearFuenteAbierta ya la
  // implementa, así que esto solo endurece el tipo de lo que ya se pasaba.
  fuenteLugares?: FuenteLugares & FuenteCiudad;
  fuenteFotos?: FuenteFotos;
  fuenteCercanos?: FuenteCercanos;
  // guia-abierta: ausente, no se enriquece con la guía (los tests no usan red).
  fuenteGuia?: FuenteGuia;
  // bar-ac4 (feedback del gatekeeper, 2026-10-04): el SHA que de verdad
  // ejecuta este tick en VPS1, distinto del commit que Vercel informa en
  // /api/salud -- scripts/trabajador-tick.ts lo calcula con `git rev-parse`.
  commitSha?: string;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// trabajador-ac4: con la cola vacía desde el principio, el tick no espera
// nada (sale del bucle antes del primer sleep) ni invoca al modelo. Solo
// espera "un rato antes de morir" (arquitectura) si YA ha procesado algo,
// para que una pregunta de la guía que llegue justo después se atienda en
// caliente.
// rel-ac1: con la cola vacía ya no sale de inmediato -- ejecuta UN barrido
// de relleno (completarParadasPendientes) antes de salir. Con trabajos,
// el barrido corre tras drenar la cola y antes de la espera ociosa; nunca
// dos veces en el mismo tick.
export async function tick(supabase: SupabaseClient, opciones: OpcionesTick): Promise<ResultadoTick> {
  const tomadoPor = opciones.tomadoPor ?? `trabajador-${process.pid}-${Date.now()}`;
  const esperaOciosaMs = opciones.esperaOciosaMs ?? ESPERA_OCIOSA_MS;
  const intervaloOciosoMs = opciones.intervaloOciosoMs ?? INTERVALO_REINTENTO_OCIOSO_MS;

  const adquirido = await adquirirCerrojo(supabase, tomadoPor);
  if (!adquirido) {
    console.log("[trabajador] cerrojo ocupado por otro trabajador, esta pasada no arranca nada");
    return { cerrojoAdquirido: false, trabajosProcesados: 0 };
  }

  // esqueleto-ac1: deja constancia de que VPS1 sigue vivo (/api/salud lee la
  // fila más reciente de este origen). Va aquí, no en procesarTrabajo, para
  // que un tick con la cola vacía cuente igual que uno que sí trabaja.
  // bar-ac4: se guarda el id de esta fila para poder completarla al final
  // con el resultado del tick -- así /api/salud distingue "código viejo"
  // (SHA desfasado), "excepción en el barrido" (resultado.error) y "reintento
  // que salió negativo" (resultado.ok con contadores en cero), que hoy son
  // indistinguibles porque el heartbeat se escribe ANTES de hacer nada.
  const { data: filaSalud } = await supabase
    .from("salud")
    .insert({ origen: "trabajador-vps1", commit_sha: opciones.commitSha ?? null })
    .select("id")
    .single();

  const fuenteLugares = opciones.fuenteLugares ?? crearFuenteAbierta({ cache: cacheSitiosSupabase(supabase) });
  const fuenteFotos = opciones.fuenteFotos ?? crearFuenteFotosAbierta();
  const fuenteCercanos = opciones.fuenteCercanos ?? crearFuenteCercanosAbierta({ cache: cacheSitiosSupabase(supabase) });
  let trabajosProcesados = 0;
  let planesMirados = 0;
  let paradasIntentadas = 0;
  let planesResueltos = 0;
  let planesReintentados = 0;
  let planesSaltadosSellados = 0;
  let planesSaltadosPorRed = 0;
  let peticionesNominatimCiudad = 0;
  let alternativas: ContadoresAlternativas | null = null;
  let errorTick: unknown;
  try {
    let ociosoDesde: number | null = null;
    let barridoHecho = false;
    for (;;) {
      const trabajo = await tomarSiguienteTrabajo(supabase, tomadoPor);
      if (trabajo) {
        ociosoDesde = null;
        await procesarTrabajo(
          supabase,
          { id: trabajo.id, plan_id: trabajo.plan_id, criterios: trabajo.criterios as CriteriosViaje },
          { ejecutor: opciones.ejecutor, directorio: opciones.directorio, fuenteLugares, fuenteFotos, fuenteGuia: opciones.fuenteGuia },
        );
        trabajosProcesados += 1;
        continue;
      }

      if (!barridoHecho) {
        barridoHecho = true;
        const resultadoBarrido = await completarParadasPendientes(
          supabase,
          fuenteLugares,
          LIMITE_BARRIDO_DEFECTO,
          fuenteFotos,
          relojReal,
          PRESUPUESTO_BARRIDO_MS_DEFECTO,
          fuenteCercanos,
          undefined,
          opciones.fuenteGuia,
        );
        planesMirados = resultadoBarrido.planesMirados;
        paradasIntentadas = resultadoBarrido.paradasIntentadas;
        planesResueltos = resultadoBarrido.planesResueltos;
        planesReintentados = resultadoBarrido.planesReintentados;
        planesSaltadosSellados = resultadoBarrido.planesSaltadosSellados;
        planesSaltadosPorRed = resultadoBarrido.planesSaltadosPorRed;
        peticionesNominatimCiudad = resultadoBarrido.peticionesNominatimCiudad;
        alternativas = resultadoBarrido.alternativas;
      }

      if (trabajosProcesados === 0) break;
      if (ociosoDesde === null) ociosoDesde = Date.now();
      if (Date.now() - ociosoDesde >= esperaOciosaMs) break;
      await esperar(intervaloOciosoMs);
    }
  } catch (error) {
    errorTick = error;
    throw error;
  } finally {
    if (filaSalud) {
      const resultado = {
        ok: errorTick === undefined,
        trabajos_procesados: trabajosProcesados,
        planes_mirados: planesMirados,
        paradas_intentadas: paradasIntentadas,
        planes_resueltos: planesResueltos,
        planes_reintentados: planesReintentados,
        planes_saltados_sellados: planesSaltadosSellados,
        planes_saltados_por_red: planesSaltadosPorRed,
        peticiones_nominatim_ciudad: peticionesNominatimCiudad,
        ...(alternativas
          ? {
              alternativas_candidatas: alternativas.candidatas,
              alternativas_intentadas: alternativas.intentadas,
              alternativas_con_cercanos: alternativas.conCercanos,
              alternativas_sin_datos: alternativas.sinDatos,
              alternativas_sin_categoria: alternativas.sinCategoria,
              alternativas_sin_coordenadas: alternativas.sinCoordenadas,
              alternativas_categorizadas: alternativas.categorizadas,
              alternativas_fallo_fuente: alternativas.falloFuente,
              alternativas_error_interno: alternativas.errorInterno,
            }
          : {}),
        ...(errorTick === undefined
          ? {}
          : { error: errorTick instanceof Error ? errorTick.message : "fallo desconocido en el tick" }),
      };
      await supabase.from("salud").update({ resultado }).eq("id", filaSalud.id);
      // El resultado del tick se pisa a los 5 min con el siguiente (casi
      // siempre en cero). Un tick que SÍ tuvo candidatas deja además su fila
      // propia, para que /api/salud lo siga mostrando y un 0 se pueda explicar.
      if (alternativas && alternativas.candidatas > 0) {
        await supabase.from("salud").insert({
          origen: ORIGEN_PASADA_ALTERNATIVAS,
          commit_sha: opciones.commitSha ?? null,
          resultado: {
            alternativas_candidatas: alternativas.candidatas,
            alternativas_intentadas: alternativas.intentadas,
            alternativas_con_cercanos: alternativas.conCercanos,
            alternativas_sin_datos: alternativas.sinDatos,
            alternativas_sin_categoria: alternativas.sinCategoria,
            alternativas_sin_coordenadas: alternativas.sinCoordenadas,
            alternativas_categorizadas: alternativas.categorizadas,
            alternativas_fallo_fuente: alternativas.falloFuente,
            alternativas_error_interno: alternativas.errorInterno,
            ultimo_error: alternativas.ultimoError,
          },
        });
      }
    }
    await liberarCerrojo(supabase, tomadoPor);
  }

  return { cerrojoAdquirido: true, trabajosProcesados };
}
