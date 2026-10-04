import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tomarSiguienteTrabajo } from "@/lib/cola/tomar";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { completarParadasPendientes, LIMITE_BARRIDO_DEFECTO, PRESUPUESTO_BARRIDO_MS_DEFECTO } from "./barrido";
import { relojReal } from "@/lib/lugares/limitador";
import { adquirirCerrojo, liberarCerrojo } from "./cerrojo";
import { ESPERA_OCIOSA_MS, INTERVALO_REINTENTO_OCIOSO_MS } from "./config";
import type { EjecutorModelo } from "./ejecutorModelo";
import { procesarTrabajo } from "./procesarTrabajo";
import { crearFuenteAbierta } from "@/lib/lugares/fuenteAbierta";
import { cacheSitiosSupabase } from "@/lib/lugares/cacheSitios";
import { crearFuenteFotosAbierta } from "@/lib/lugares/fuenteFotosAbierta";
import { crearFuenteCercanosAbierta, type FuenteCercanos } from "@/lib/alternativas/cercanos";
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
  await supabase.from("salud").insert({ origen: "trabajador-vps1" });

  const fuenteLugares = opciones.fuenteLugares ?? crearFuenteAbierta({ cache: cacheSitiosSupabase(supabase) });
  const fuenteFotos = opciones.fuenteFotos ?? crearFuenteFotosAbierta();
  const fuenteCercanos = opciones.fuenteCercanos ?? crearFuenteCercanosAbierta({ cache: cacheSitiosSupabase(supabase) });
  let trabajosProcesados = 0;
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
          { ejecutor: opciones.ejecutor, directorio: opciones.directorio, fuenteLugares, fuenteFotos },
        );
        trabajosProcesados += 1;
        continue;
      }

      if (!barridoHecho) {
        barridoHecho = true;
        await completarParadasPendientes(supabase, fuenteLugares, LIMITE_BARRIDO_DEFECTO, fuenteFotos, relojReal, PRESUPUESTO_BARRIDO_MS_DEFECTO, fuenteCercanos);
      }

      if (trabajosProcesados === 0) break;
      if (ociosoDesde === null) ociosoDesde = Date.now();
      if (Date.now() - ociosoDesde >= esperaOciosaMs) break;
      await esperar(intervaloOciosoMs);
    }
  } finally {
    await liberarCerrojo(supabase, tomadoPor);
  }

  return { cerrojoAdquirido: true, trabajosProcesados };
}
