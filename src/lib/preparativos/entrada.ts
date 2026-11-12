import type { CriteriosViaje } from "@/lib/criterios/tipos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { Reserva } from "@/lib/reservas/tipos";
import type { EntradaPreparativos } from "./tipos";

// Lista blanca explícita: solo datos estructurados, nunca nombre, notas ni
// localizador. El plan aún no guarda el país como código, así que queda a null
// y la plantilla pide comprobar el enchufe (atajo: cuando el plan lo traiga, leerlo aquí).
export function entradaDesdePlan(
  plan: { criterios: CriteriosViaje; ciudad?: Pick<CiudadEfectiva, "caja"> | CiudadEfectiva },
  reservas: Pick<Reserva, "tipo">[],
): EntradaPreparativos {
  const caja = plan.ciudad?.caja;
  return {
    personas: plan.criterios.personas.map((p) => ({ edad: p.edad })),
    perfil: plan.criterios.perfil,
    fechas: plan.criterios.fechas,
    dias: plan.criterios.dias,
    latitud: caja ? (caja.minLat + caja.maxLat) / 2 : null,
    pais: null,
    transporte: [...(plan.criterios.transporte ?? [])],
    tiposReserva: reservas.map((r) => r.tipo),
  };
}
