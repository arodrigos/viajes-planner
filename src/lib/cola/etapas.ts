// El nombre de la etapa ES el texto que ve el usuario (lo que Adrián pidió
// a cambio de aceptar más espera): no hay una traducción id -> texto
// legible por separado. El porcentaje es la posición de esa etapa dentro
// del flujo declarado en el diseño (arquitectura), no un dato guardado.
export const ETAPAS_GENERACION = [
  "preparando la petición",
  "generando el plan",
  "verificando sitios",
  "comprobando horarios",
  "eligiendo zona de alojamiento",
  "calculando desplazamientos",
  "componiendo el presupuesto",
  "guardando",
] as const;

export type EtapaGeneracion = (typeof ETAPAS_GENERACION)[number];

export function porcentajeParaEtapa(etapa: string | null): number {
  if (!etapa) return 0;
  const indice = ETAPAS_GENERACION.indexOf(etapa as EtapaGeneracion);
  if (indice === -1) return 0;
  return Math.round(((indice + 1) / ETAPAS_GENERACION.length) * 100);
}
