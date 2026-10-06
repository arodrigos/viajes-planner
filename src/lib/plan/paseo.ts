// encaje-y-paseo (enc-ac2): "Paseo estimado" del día a partir de las
// paradas YA resueltas, en el orden real de sus franjas -- sin ninguna API
// de rutas (no-objetivo declarado del diseño): suma de distancias
// geodésicas entre paradas consecutivas, multiplicada por un factor fijo
// que aproxima calle sobre línea recta. Puro y testeable, igual que
// equivalencia.ts, del que reutiliza distanciaMetros.
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { calcularTramosDia } from "./tramos";
import type { Franja, Parada } from "./tipos";

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

// tramos-dia: `km` son SOLO los kilómetros a pie; lo que se recorre en
// transporte va aparte, para que el paseo no cuente como andados los
// kilómetros de un tramo largo.
export interface ResultadoPaseo {
  km: number;
  kmTransporte?: number;
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
// equivalencia.ts. El aviso de «mucho paseo» mira solo lo andado.
export function calcularPaseoDia(puntos: PuntoPaseo[], perfil: string | null, transporte?: readonly string[] | null): ResultadoPaseo | null {
  if (puntos.length < 2) return null;

  const tramos = calcularTramosDia(puntos, { perfil, transporte });
  const suma = (aPie: boolean) => Math.round(tramos.filter((t) => (t.modo === "a-pie") === aPie).reduce((total, t) => total + t.km, 0) * 10) / 10;
  const km = suma(true);
  const kmTransporte = suma(false);
  const enTransporte = tramos.some((t) => t.modo !== "a-pie");

  const umbral = perfil === "familiar" ? UMBRAL_FAMILIAR_KM : UMBRAL_RESTO_KM;
  if (km <= umbral) return { km, ...(enTransporte ? { kmTransporte } : {}) };

  const alejada = paradaMasAlejada(puntos);
  return {
    km,
    ...(enTransporte ? { kmTransporte } : {}),
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
