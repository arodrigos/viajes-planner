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

export interface IntervaloVisita {
  fecha: string; // "YYYY-MM-DD"
  inicio: string; // "HH:MM", hora local del lugar
  fin: string;
}

export interface ResultadoApertura {
  estado: EstadoApertura;
  // Hora local a la que cierra a mitad de la visita; solo con "cerrada" y
  // cuando el sitio estaba abierto al empezar.
  cierre?: string;
  zona: string | null;
}

// hor-ac2: «abierta» solo si opening_hours indica abierto en TODO el
// intervalo de la visita, en la hora local del lugar. La librería lee el
// reloj de pared (getHours...) del Date que recibe, y las etiquetas de OSM
// son hora local del lugar, así que se le pasa un Date construido con esa
// hora de pared: el resultado no depende de la zona del proceso. Se probó
// TZDate (@date-fns/tz) como pedía el diseño y no sirve: con el proceso en
// cualquier zona por delante de la del lugar (Tokio, Sídney...) getNextChange
// entra en «infinite loop». Lo que devuelve getNextChange también es hora de
// pared del proceso, de ahí que se compare por sus campos locales. Sin
// etiqueta, sin zona o con una etiqueta ilegible: "desconocida", nunca un
// horario inventado.
export function calcularApertura(openingHours: string | undefined, intervalo: IntervaloVisita, zona: string | null): ResultadoApertura {
  if (!openingHours || !zona) return { estado: "desconocida", zona };
  try {
    const regla = new OpeningHours(openingHours);
    const [anioD, mesD, diaD] = intervalo.fecha.split("-").map(Number);
    const [hi, mi] = intervalo.inicio.split(":").map(Number);
    const desde = new Date(anioD, mesD - 1, diaD, hi, mi);
    if (regla.getUnknown(desde)) return { estado: "desconocida", zona };
    if (!regla.getState(desde)) return { estado: "cerrada", zona };

    const cambio = regla.getNextChange(desde);
    if (cambio) {
      const [anio, mes, dia] = intervalo.fecha.split("-").map(Number);
      const [hf, mf] = intervalo.fin.split(":").map(Number);
      const paredFin = Date.UTC(anio, mes - 1, dia, hf, mf);
      const paredCambio = Date.UTC(cambio.getFullYear(), cambio.getMonth(), cambio.getDate(), cambio.getHours(), cambio.getMinutes());
      if (paredCambio < paredFin) {
        const hh = String(cambio.getHours()).padStart(2, "0");
        const mm = String(cambio.getMinutes()).padStart(2, "0");
        return { estado: "cerrada", cierre: `${hh}:${mm}`, zona };
      }
    }
    return { estado: "abierta", zona };
  } catch {
    return { estado: "desconocida", zona };
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
  // Intervalo que ocuparía la alternativa en el hueco de la parada.
  intervalo: IntervaloVisita;
  zona: string | null;
}): EtiquetasEncaje {
  const { parada, alternativa, coordenadasAnterior, coordenadasSiguiente, intervalo, zona } = params;
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
    apertura: calcularApertura(alternativa.lugar?.etiquetas.opening_hours, intervalo, zona).estado,
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
