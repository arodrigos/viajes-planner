import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tomarSiguienteTrabajo } from "@/lib/cola/tomar";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { adquirirCerrojo, liberarCerrojo } from "./cerrojo";
import { ESPERA_OCIOSA_MS, INTERVALO_REINTENTO_OCIOSO_MS } from "./config";
import type { EjecutorModelo } from "./ejecutorModelo";
import { procesarTrabajo } from "./procesarTrabajo";

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
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// trabajador-ac4: con la cola vacía desde el principio, el tick no espera
// nada (sale del bucle antes del primer sleep) ni invoca al modelo. Solo
// espera "un rato antes de morir" (arquitectura) si YA ha procesado algo,
// para que una pregunta de la guía que llegue justo después se atienda en
// caliente.
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

  let trabajosProcesados = 0;
  try {
    let ociosoDesde: number | null = null;
    for (;;) {
      const trabajo = await tomarSiguienteTrabajo(supabase, tomadoPor);
      if (trabajo) {
        ociosoDesde = null;
        await procesarTrabajo(
          supabase,
          { id: trabajo.id, plan_id: trabajo.plan_id, criterios: trabajo.criterios as CriteriosViaje },
          { ejecutor: opciones.ejecutor, directorio: opciones.directorio },
        );
        trabajosProcesados += 1;
        continue;
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
