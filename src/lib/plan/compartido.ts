import type { DiaPublico, ParadaPublica, PlanPublico } from "./publico";
import type { EtapaPlan, TrasladoPlan } from "./tipos";

type ParadaCompartida = Omit<ParadaPublica, "google">;
type DiaCompartido = Omit<DiaPublico, "ancla_alojamiento" | "paradas"> & { paradas: ParadaCompartida[] };
type EtapaCompartida = Omit<EtapaPlan, "alojamiento_noche_eur">;
type TrasladoCompartido = Omit<TrasladoPlan, "coste_eur">;

export interface PlanCompartido extends Omit<PlanPublico, "presupuesto" | "dias" | "etapas" | "traslados" | "compartidoCon"> {
  dias: DiaCompartido[];
  etapas?: EtapaCompartida[];
  traslados?: TrasladoCompartido[];
  compartido: { rol: "miembro" };
}

function quitar<T extends object, K extends keyof T>(objeto: T, ...claves: K[]): Omit<T, K> {
  const copia = { ...objeto };
  for (const clave of claves) delete copia[clave];
  return copia;
}

// Lo que ve quien recibe el plan en solo lectura: los días y paradas completos
// (con su nota y su precio orientativo de entrada, que Adrián confirmó) pero
// nada del dinero de la familia ni de dónde duerme. Se quita en el servidor,
// nunca solo en la interfaz, porque la copia offline guarda el JSON entero.
//
// Acepta también el plan ya adornado por la ruta del dueño (trabajoId,
// regenerando) y lo descarta: la proyección es válida por construcción, no
// por el orden en que la ruta monte la respuesta.
export function aPlanCompartido(plan: PlanPublico & { trabajoId?: string; regenerando?: boolean }): PlanCompartido {
  const { dias, etapas, traslados, ...resto } = quitar(plan, "presupuesto", "compartidoCon", "trabajoId", "regenerando");
  return {
    ...resto,
    dias: dias.map((dia) => ({ ...quitar(dia, "ancla_alojamiento"), paradas: dia.paradas.map((parada) => quitar(parada, "google")) })),
    ...(etapas ? { etapas: etapas.map((etapa) => quitar(etapa, "alojamiento_noche_eur")) } : {}),
    ...(traslados ? { traslados: traslados.map((traslado) => quitar(traslado, "coste_eur")) } : {}),
    compartido: { rol: "miembro" },
  };
}
