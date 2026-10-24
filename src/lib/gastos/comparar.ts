import type { Presupuesto } from "@/lib/presupuesto/calcular";
import type { Gasto } from "./tipos";

export interface ComparacionGasto {
  total: { estimado_c: number; gastado_c: number; queda_c: number };
  alojamiento: { estimado_c: number; gastado_c: number };
  sin_dia_c: number;
  por_dia: { fecha: string; estimado_c: number; gastado_c: number; pasado: boolean }[];
}

const aCentimos = (euros: number) => Math.round(euros * 100);

// Todo en céntimos enteros. Regla de los gastos grandes (decisión de Adrián): el
// alojamiento solo suma al alojamiento, nunca a un día; el transporte sin día
// va a «Todo el viaje»; el resto, a su día. Un gasto cuyo día ya no es del
// viaje (se acortó) se cuenta como «Todo el viaje»: así el total siempre es
// la suma de las partes y «queda» no oculta dinero ya gastado.
export function compararGasto(presupuesto: Pick<Presupuesto, "por_dia" | "total_eur" | "alojamiento_eur">, gastos: readonly Gasto[], fechas: readonly string[]): ComparacionGasto {
  const gastadoPorDia = new Map<string, number>(fechas.map((f) => [f, 0]));
  let alojamiento = 0;
  let sinDia = 0;
  let total = 0;
  for (const g of gastos) {
    total += g.importe_centimos;
    if (g.categoria === "alojamiento") alojamiento += g.importe_centimos;
    else if (g.fecha !== null && gastadoPorDia.has(g.fecha)) gastadoPorDia.set(g.fecha, (gastadoPorDia.get(g.fecha) ?? 0) + g.importe_centimos);
    else sinDia += g.importe_centimos;
  }
  const estimadoPorDia = new Map(presupuesto.por_dia.map((d) => [d.fecha, aCentimos(d.total_eur)]));
  const por_dia = fechas.map((fecha) => {
    const estimado_c = estimadoPorDia.get(fecha) ?? 0;
    const gastado_c = gastadoPorDia.get(fecha) ?? 0;
    return { fecha, estimado_c, gastado_c, pasado: gastado_c > estimado_c };
  });
  const estimado_c = aCentimos(presupuesto.total_eur);
  return {
    total: { estimado_c, gastado_c: total, queda_c: estimado_c - total },
    alojamiento: { estimado_c: aCentimos(presupuesto.alojamiento_eur), gastado_c: alojamiento },
    sin_dia_c: sinDia,
    por_dia,
  };
}
