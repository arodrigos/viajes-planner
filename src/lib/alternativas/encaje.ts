// encaje-y-paseo (enc-ac1): por cada alternativa, hechos verificables y
// deterministas sobre cómo encaja en el plan -- nunca un motivo redactado.
// Puro y testeable: nada de red ni de Supabase aquí, igual que
// equivalencia.ts, del que reutiliza distanciaMetros.
import OpeningHours from "opening_hours";
import { distanciaMetros } from "./equivalencia";
import type { Alternativa, CategoriaParada, Dia, Parada } from "@/lib/plan/tipos";
import { ordenarParadasPorFranja } from "@/lib/plan/paseo";

const TOLERANCIA_DURACION = 0.3;
const REDONDEO_DISTANCIA_M = 50;

export type EstadoApertura = "abierta" | "cerrada" | "desconocida";

export interface EtiquetasEncaje {
  distanciaAnteriorM?: number;
  distanciaSiguienteM?: number;
  // Presente SOLO cuando coincide con la categoría de la parada que se
  // quiere sustituir -- es lo que formatearEtiquetasEncaje pinta como
  // "Misma categoría (<categoria>)".
  categoria?: CategoriaParada;
  duracionSimilar: boolean;
  apertura: EstadoApertura;
}

function redondearA(metros: number, paso: number): number {
  return Math.round(metros / paso) * paso;
}

// enc-ac1: evalúa la apertura en el instante de inicio de la franja -- un
// rango horario de OpenStreetMap cubre la ventana entera o ninguna parte
// de ella en la inmensa mayoría de los casos; esta herramienta no
// pretende resolver un cierre a mitad de franja. Sin etiqueta
// `opening_hours`, o con una que la librería no sepa interpretar, el
// resultado es siempre "desconocida" -- nunca un horario inventado.
export function calcularApertura(openingHours: string | undefined, fecha: string, horaInicioFranja: string): EstadoApertura {
  if (!openingHours) return "desconocida";
  try {
    const regla = new OpeningHours(openingHours);
    const instante = new Date(`${fecha}T${horaInicioFranja}:00`);
    return regla.getState(instante) ? "abierta" : "cerrada";
  } catch {
    return "desconocida";
  }
}

// Busca, en el orden real de franjas del día, la parada resuelta más
// próxima antes y después de `paradaId` -- que puede ser una parada que
// todavía no está resuelta: lo que importa es su posición en el día, no
// si ella misma tiene coordenadas.
export function vecinosResueltos(
  dia: Pick<Dia, "franjas" | "paradas">,
  paradaId: string,
): { anterior?: { lat: number; lon: number }; siguiente?: { lat: number; lon: number } } {
  const orden = ordenarParadasPorFranja(dia.franjas, dia.paradas);
  const indice = orden.findIndex((p) => p.id === paradaId);
  if (indice === -1) return {};

  let anterior: { lat: number; lon: number } | undefined;
  for (let i = indice - 1; i >= 0; i--) {
    if (orden[i].coordenadas) {
      anterior = orden[i].coordenadas;
      break;
    }
  }
  let siguiente: { lat: number; lon: number } | undefined;
  for (let i = indice + 1; i < orden.length; i++) {
    if (orden[i].coordenadas) {
      siguiente = orden[i].coordenadas;
      break;
    }
  }
  return { anterior, siguiente };
}

export function calcularEtiquetasEncaje(params: {
  parada: Pick<Parada, "categoria" | "duracion_min">;
  alternativa: Pick<Alternativa, "categoria" | "duracion_min" | "coordenadas" | "lugar">;
  coordenadasAnterior?: { lat: number; lon: number };
  coordenadasSiguiente?: { lat: number; lon: number };
  fecha: string;
  horaInicioFranja: string;
}): EtiquetasEncaje {
  const { parada, alternativa, coordenadasAnterior, coordenadasSiguiente, fecha, horaInicioFranja } = params;
  const categoriaCoincide = alternativa.categoria !== undefined && alternativa.categoria === parada.categoria;

  return {
    distanciaAnteriorM:
      coordenadasAnterior && alternativa.coordenadas
        ? redondearA(distanciaMetros(coordenadasAnterior, alternativa.coordenadas), REDONDEO_DISTANCIA_M)
        : undefined,
    distanciaSiguienteM:
      coordenadasSiguiente && alternativa.coordenadas
        ? redondearA(distanciaMetros(coordenadasSiguiente, alternativa.coordenadas), REDONDEO_DISTANCIA_M)
        : undefined,
    categoria: categoriaCoincide ? alternativa.categoria : undefined,
    duracionSimilar: Math.abs(alternativa.duracion_min - parada.duracion_min) <= parada.duracion_min * TOLERANCIA_DURACION,
    apertura: calcularApertura(alternativa.lugar?.etiquetas.opening_hours, fecha, horaInicioFranja),
  };
}

export function formatearEtiquetasEncaje(etiquetas: EtiquetasEncaje): string[] {
  const textos: string[] = [];
  if (etiquetas.distanciaAnteriorM !== undefined) textos.push(`A ${etiquetas.distanciaAnteriorM} m de la parada anterior`);
  if (etiquetas.distanciaSiguienteM !== undefined) textos.push(`A ${etiquetas.distanciaSiguienteM} m de la siguiente parada`);
  if (etiquetas.categoria) textos.push(`Misma categoría (${etiquetas.categoria})`);
  if (etiquetas.duracionSimilar) textos.push("Duración similar");
  textos.push(
    etiquetas.apertura === "abierta" ? "Abre a esa hora" : etiquetas.apertura === "cerrada" ? "Cerrado a esa hora" : "Horario desconocido",
  );
  return textos;
}
