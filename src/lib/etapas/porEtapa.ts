// etapas-pais (eta-ac3): aplica una operación sobre los días de cada etapa
// por separado, para que las paradas se resuelvan contra la caja de SU ciudad
// y no contra la de otra: «Mercado do Bolhão» del día de Lisboa no puede
// aceptarse con el de Oporto aunque se llamen igual.
import type { EtapaPlan, Plan } from "@/lib/plan/tipos";
import type { CualificadorCiudad } from "@/lib/lugares/resolverPlan";

export function cualificadorDeEtapa(etapa: EtapaPlan): CualificadorCiudad | null {
  const { ciudad } = etapa;
  return ciudad.estado === "resuelta" && ciudad.nombre && ciudad.caja ? { nombre: ciudad.nombre, caja: ciudad.caja } : null;
}

// Una etapa sin ciudad efectiva deja sus días tal cual («sin comprobar»).
export async function porEtapas(plan: Plan, operacion: (sub: Plan, cualificador: CualificadorCiudad) => Promise<Plan>): Promise<Plan> {
  const etapas = plan.etapas ?? [];
  const dias = [...plan.dias];
  for (const etapa of etapas) {
    const cualificador = cualificadorDeEtapa(etapa);
    if (!cualificador) continue;
    const fin = etapa.dia_inicio + etapa.dias;
    const resultado = await operacion({ ...plan, dias: dias.slice(etapa.dia_inicio, fin) }, cualificador);
    resultado.dias.forEach((d, i) => {
      dias[etapa.dia_inicio + i] = d;
    });
  }
  return { ...plan, dias };
}
