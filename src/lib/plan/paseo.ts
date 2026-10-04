// encaje-y-paseo (enc-ac2): "Paseo estimado" del día a partir de las
// paradas YA resueltas, en el orden real de sus franjas -- sin ninguna API
// de rutas (no-objetivo declarado del diseño): suma de distancias
// geodésicas entre paradas consecutivas, multiplicada por un factor fijo
// que aproxima calle sobre línea recta. Puro y testeable, igual que
// equivalencia.ts, del que reutiliza distanciaMetros.
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import type { Franja, Parada } from "./tipos";

// Factor calle/línea recta: una calle real nunca es la línea recta entre
// dos puntos. 1,3 es el mismo orden de magnitud que usan los estimadores
// de paseo urbano sin grafo de calles (research del diseño).
const FACTOR_CALLE = 1.3;
const UMBRAL_FAMILIAR_KM = 8;
const UMBRAL_RESTO_KM = 12;

export interface PuntoPaseo {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
}

export interface AvisoPaseo {
  texto: string;
  paradaId: string;
}

export interface ResultadoPaseo {
  km: number;
  aviso?: AvisoPaseo;
}

// Recorre las franjas del día en su orden declarado y, dentro de cada
// franja, las paradas tal cual llegan -- mismo orden que `puntosDelDia` en
// VistaPlan.tsx (map-ac1), para que el paseo y el mapa cuenten la misma
// historia del día.
export function ordenarParadasPorFranja<T extends { franja_id: string }>(franjas: Pick<Franja, "id">[], paradas: T[]): T[] {
  const orden: T[] = [];
  for (const franja of franjas) {
    for (const parada of paradas.filter((p) => p.franja_id === franja.id)) orden.push(parada);
  }
  return orden;
}

export function ordenarParadasResueltas(franjas: Pick<Franja, "id">[], paradas: Parada[]): PuntoPaseo[] {
  return ordenarParadasPorFranja(franjas, paradas)
    .filter((p): p is Parada & { coordenadas: NonNullable<Parada["coordenadas"]> } => Boolean(p.coordenadas))
    .map((p) => ({ id: p.id, nombre: p.nombre, lat: p.coordenadas.lat, lon: p.coordenadas.lon }));
}

function kmEntre(a: PuntoPaseo, b: PuntoPaseo): number {
  return distanciaMetros({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) / 1000;
}

// enc-ac2: la "parada más alejada" es la que más distancia REAL añade al
// recorrido -- su "coste de desvío": cuánto más largo es el día por pasar
// por ella en vez de ir directamente de la parada anterior a la
// siguiente. Un punto casi alineado con sus vecinas apenas añade desvío
// aunque sus tramos sean largos; el extremo de una excursión aislada
// añade el tramo entero. Es la candidata más clara para cambiar por una
// alternativa más cercana a sus vecinas.
function paradaMasAlejada(puntos: PuntoPaseo[]): PuntoPaseo {
  let indiceElegido = 0;
  let costeMaximo = -Infinity;
  for (let i = 0; i < puntos.length; i++) {
    let coste: number;
    if (i === 0) {
      coste = puntos.length > 1 ? kmEntre(puntos[i], puntos[i + 1]) : 0;
    } else if (i === puntos.length - 1) {
      coste = kmEntre(puntos[i - 1], puntos[i]);
    } else {
      const tramoEntrada = kmEntre(puntos[i - 1], puntos[i]);
      const tramoSalida = kmEntre(puntos[i], puntos[i + 1]);
      const directo = kmEntre(puntos[i - 1], puntos[i + 1]);
      coste = tramoEntrada + tramoSalida - directo;
    }
    if (coste > costeMaximo) {
      costeMaximo = coste;
      indiceElegido = i;
    }
  }
  return puntos[indiceElegido];
}

// perfil: el mismo string que `criterios.perfil` ('familiar' | 'amigos' |
// 'pareja' | 'solo') -- cualquier valor distinto de 'familiar' cae en el
// umbral no familiar, el más permisivo, igual que esEquivalente en
// equivalencia.ts.
export function calcularPaseoDia(puntos: PuntoPaseo[], perfil: string | null): ResultadoPaseo | null {
  if (puntos.length < 2) return null;

  let kmLineaRecta = 0;
  for (let i = 1; i < puntos.length; i++) kmLineaRecta += kmEntre(puntos[i - 1], puntos[i]);
  const km = Math.round(kmLineaRecta * FACTOR_CALLE * 10) / 10;

  const umbral = perfil === "familiar" ? UMBRAL_FAMILIAR_KM : UMBRAL_RESTO_KM;
  if (km <= umbral) return { km };

  const alejada = paradaMasAlejada(puntos);
  return {
    km,
    aviso: {
      texto: `Este día tiene mucho paseo: prueba a cambiar ${alejada.nombre} por su alternativa más cercana`,
      paradaId: alejada.id,
    },
  };
}

// Formato español ("2,6 km") -- el resto de la interfaz no usa ninguna
// librería de internacionalización, así que basta con la coma decimal.
export function formatearKm(km: number): string {
  return `${km.toFixed(1).replace(".", ",")} km`;
}
