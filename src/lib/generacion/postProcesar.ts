import type { CriteriosViaje } from "@/lib/criterios/tipos";
import type { Dia, Parada, Plan } from "@/lib/plan/tipos";
import { detectarCategoriaRiesgo } from "./categoriasRiesgo";
import { topeEfectivo } from "./tope";

export interface ResultadoPostProceso {
  plan: Plan;
  avisos: string[];
}

function mensajeAviso(etiqueta: string, n: number): string {
  const sujeto = n === 1 ? "1 parada" : `${n} paradas`;
  return `Se han excluido ${sujeto} de la categoría "${etiqueta}" por política de seguridad de la herramienta.`;
}

function filtrarPorCategoriaDeRiesgo(paradas: Parada[], categoriasExcluidas: Map<string, number>): Parada[] {
  return paradas.filter((parada) => {
    const categoria = detectarCategoriaRiesgo(parada);
    if (!categoria) return true;
    categoriasExcluidas.set(categoria.etiqueta, (categoriasExcluidas.get(categoria.etiqueta) ?? 0) + 1);
    return false;
  });
}

// Mantiene, por franja, las `tope` paradas de mayor prioridad, conservando
// el orden original del resto de la lista (importa solo cuando el modelo
// no ha respetado el tope pedido en el prompt; si lo respeta, este filtro
// no cambia nada).
function recortarPorTope(paradas: Parada[], tope: number): Parada[] {
  const contadorPorFranja = new Map<string, number>();
  const conservar = new Set(
    [...paradas]
      .sort((a, b) => b.prioridad - a.prioridad)
      .filter((parada) => {
        const n = contadorPorFranja.get(parada.franja_id) ?? 0;
        if (n >= tope) return false;
        contadorPorFranja.set(parada.franja_id, n + 1);
        return true;
      }),
  );
  return paradas.filter((parada) => conservar.has(parada));
}

// generacion-ac1 / generacion-ac2: red de seguridad determinista que no
// depende de que el modelo obedezca las instrucciones del prompt. Se aplica
// SIEMPRE sobre un plan ya validado estructuralmente (ensamblarYValidar):
// filtrar y recortar un plan válido sigue siendo un plan válido, el
// esquema no exige un número exacto de paradas por franja.
export function postProcesarPlan(plan: Plan, criterios: CriteriosViaje): ResultadoPostProceso {
  const tope = topeEfectivo(criterios);
  const categoriasExcluidas = new Map<string, number>();

  const dias: Dia[] = plan.dias.map((dia) => {
    const sinRiesgo = filtrarPorCategoriaDeRiesgo(dia.paradas, categoriasExcluidas);
    return { ...dia, paradas: recortarPorTope(sinRiesgo, tope) };
  });

  const avisos = [...categoriasExcluidas.entries()].map(([etiqueta, n]) => mensajeAviso(etiqueta, n));

  return { plan: { ...plan, dias, avisos }, avisos };
}
