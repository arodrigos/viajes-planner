import type { CriteriosViaje, Modo } from "@/lib/criterios/tipos";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import type { Zona } from "./clasificar";
import { PISO_ALOJAMIENTO_EUR, TOPE_AVION_MIN, TOPE_TIERRA_MIN } from "./constantes";
import { maxEtapas, nochesDe, DIAS_POR_ETAPA, MAX_ETAPAS } from "./reglas";
import { estimarPorDistancia } from "./traslados";

export type CodigoRazon = "dias" | "distancia" | "presupuesto" | "zona-sin-etapa";

export interface Razon {
  codigo: CodigoRazon;
  texto: string;
}

export interface Inviable {
  razones: Razon[];
  sugerencias: string[];
}

export type ResultadoViabilidad = { viable: true } | ({ viable: false } & Inviable);

const MUESTRAS_POR_LADO = 32;

function solapan(a: CajaDelimitadora, b: CajaDelimitadora): boolean {
  return a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLon <= b.maxLon && b.minLon <= a.maxLon;
}

function perimetro(caja: CajaDelimitadora): { puntos: { lat: number; lon: number }[]; paso_km: number } {
  const puntos: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= MUESTRAS_POR_LADO; i++) {
    const t = i / MUESTRAS_POR_LADO;
    const lat = caja.minLat + t * (caja.maxLat - caja.minLat);
    const lon = caja.minLon + t * (caja.maxLon - caja.minLon);
    puntos.push({ lat, lon: caja.minLon }, { lat, lon: caja.maxLon }, { lat: caja.minLat, lon }, { lat: caja.maxLat, lon });
  }
  const ladoMayorGrados = Math.max(caja.maxLat - caja.minLat, caja.maxLon - caja.minLon);
  return { puntos, paso_km: ((ladoMayorGrados * 111.2) / MUESTRAS_POR_LADO) };
}

// Distancia mínima entre dos cajas: 0 si se tocan; si no, la menor entre los
// puntos muestreados de sus bordes MENOS el paso de muestreo, porque entre dos
// muestras el borde real puede acercarse un poco más. Restar ese margen la
// hace una cota inferior: la viabilidad nunca debe exagerar una distancia.
export function distanciaMinimaEntreCajas(a: CajaDelimitadora, b: CajaDelimitadora): number {
  if (solapan(a, b)) return 0;
  const pa = perimetro(a);
  const pb = perimetro(b);
  let minimo = Infinity;
  for (const x of pa.puntos) for (const y of pb.puntos) minimo = Math.min(minimo, distanciaMetros(x, y) / 1000);
  return Math.max(0, minimo - pa.paso_km - pb.paso_km);
}

function formatearMiles(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatearEuros(n: number): string {
  return `${formatearMiles(Math.ceil(n))} €`;
}

const NOMBRE_MODO: Record<Modo, string> = { coche: "coche", avion: "avión", tren: "tren", autobus: "autobús" };

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

interface Salto {
  desde: number;
  hasta: number;
  km: number;
}

function permutaciones(n: number): number[][] {
  const resultado: number[][] = [];
  const usar = (actual: number[], libres: number[]) => {
    if (libres.length === 0) {
      resultado.push(actual);
      return;
    }
    for (const i of libres) usar([...actual, i], libres.filter((l) => l !== i));
  };
  usar([], Array.from({ length: n }, (_, i) => i));
  return resultado;
}

// Cotas inferiores, para no descartar nunca un viaje que sí podría cumplir
// las reglas: (a) días, (b) distancia entre zonas con un orden posible y
// (c) coste mínimo de alojamiento más el traslado más barato de cada salto.
// `pedidas` es cuántas zonas ha pedido el viajero; supera `zonas.length` solo
// cuando pidió más de las que se geocodificaron (siempre inviable por días).
export function comprobarViabilidad(zonas: readonly Zona[], criterios: CriteriosViaje, pedidas: number = zonas.length): ResultadoViabilidad {
  const razones: Razon[] = [];
  const sugerencias: string[] = [];
  const personas = criterios.personas.length;
  const modos = criterios.transporte ?? [];
  const todosPaises = zonas.every((z) => z.tipo === "country");
  const cosa = (n: number) => (todosPaises ? plural(n, "país", "países") : plural(n, "zona", "zonas"));

  const cabenEtapas = maxEtapas(criterios.dias);
  const demasiadas = pedidas > cabenEtapas;
  if (demasiadas) {
    const cabenTexto = pedidas > MAX_ETAPAS && cabenEtapas === MAX_ETAPAS ? `como mucho ${MAX_ETAPAS} ciudades` : `como mucho ${plural(cabenEtapas, "ciudad", "ciudades")} (una cada ${DIAS_POR_ETAPA} días)`;
    razones.push({
      codigo: "dias",
      texto: `Con ${plural(criterios.dias, "día", "días")} caben ${cabenTexto} y has pedido ${cosa(pedidas)}.`,
    });
    const diasNecesarios = DIAS_POR_ETAPA * Math.min(pedidas, MAX_ETAPAS);
    sugerencias.push(
      pedidas > MAX_ETAPAS
        ? `Pide como mucho ${MAX_ETAPAS} ${todosPaises ? "países" : "zonas"}.`
        : `Alarga el viaje a ${diasNecesarios} días o pide menos ${todosPaises ? "países" : "zonas"}.`,
    );
  }

  // Sin geocodificar todas las zonas pedidas no hay distancias fiables que
  // comprobar: el descarte por días ya basta.
  if (zonas.length > 1 && zonas.length === pedidas) {
    const saltos: Salto[][] = zonas.map((a, i) =>
      zonas.map((b, j) => ({ desde: i, hasta: j, km: i === j ? 0 : distanciaMinimaEntreCajas(a.caja, b.caja) })),
    );
    const traslado = (s: Salto) => estimarPorDistancia(s.km, modos, personas, true);

    let mejorCoste: number | null = null;
    for (const orden of permutaciones(zonas.length)) {
      let coste = 0;
      let ok = true;
      for (let k = 0; k < orden.length - 1 && ok; k++) {
        const t = traslado(saltos[orden[k]][orden[k + 1]]);
        if (t) coste += t.coste_eur;
        else ok = false;
      }
      if (ok && (mejorCoste === null || coste < mejorCoste)) mejorCoste = coste;
    }

    if (mejorCoste === null) {
      let peor: Salto | null = null;
      for (let i = 0; i < zonas.length; i++)
        for (let j = i + 1; j < zonas.length; j++)
          if (!traslado(saltos[i][j]) && (!peor || saltos[i][j].km < peor.km)) peor = saltos[i][j];
      // Sin ningún par imposible todos se pueden unir y habría orden: peor existe.
      const par = peor ?? saltos[0][1];
      const conAvion = modos.length === 0 || modos.includes("avion");
      const topeTexto = conAvion ? `${TOPE_TIERRA_MIN / 60} h por tierra o ${TOPE_AVION_MIN / 60} h en avión` : `${TOPE_TIERRA_MIN / 60} h`;
      const medios = modos.length > 0 ? modos.map((m) => NOMBRE_MODO[m]).join(", ") : "ningún medio";
      razones.push({
        codigo: "distancia",
        texto: `${zonas[par.desde].nombre} y ${zonas[par.hasta].nombre} están como mínimo a ${formatearMiles(par.km)} km, y con ${modos.length > 0 ? `lo que has marcado (${medios})` : "cualquier medio"} no se llega en ${topeTexto}.`,
      });
      sugerencias.push(conAvion ? "Elige países más cercanos." : "Marca «Avión» o elige países más cercanos.");
    } else if (!demasiadas) {
      const costeAlojamiento = nochesDe(criterios.dias) * personas * PISO_ALOJAMIENTO_EUR;
      if (costeAlojamiento + mejorCoste > criterios.presupuesto_eur) {
        razones.push(razonPresupuesto(criterios, personas, mejorCoste));
        sugerencias.push(sugerenciaPresupuesto(costeAlojamiento + mejorCoste));
      }
    }
  } else if (!demasiadas && zonas.length === 1) {
    const costeAlojamiento = nochesDe(criterios.dias) * personas * PISO_ALOJAMIENTO_EUR;
    if (costeAlojamiento > criterios.presupuesto_eur) {
      razones.push(razonPresupuesto(criterios, personas, 0));
      sugerencias.push(sugerenciaPresupuesto(costeAlojamiento));
    }
  }

  return razones.length === 0 ? { viable: true } : { viable: false, razones, sugerencias };
}

function razonPresupuesto(criterios: CriteriosViaje, personas: number, traslados: number): Razon {
  const noches = nochesDe(criterios.dias);
  const alojamiento = noches * personas * PISO_ALOJAMIENTO_EUR;
  const detalle = `${noches} ${noches === 1 ? "noche" : "noches"} × ${plural(personas, "persona", "personas")} × ${PISO_ALOJAMIENTO_EUR} € = ${formatearEuros(alojamiento)}`;
  const total = alojamiento + traslados;
  const texto =
    traslados > 0
      ? `Solo el alojamiento más barato posible (${detalle}) y los traslados mínimos (${formatearEuros(traslados)}) suman ${formatearEuros(total)}, más que tu presupuesto de ${formatearEuros(criterios.presupuesto_eur)}.`
      : `Solo el alojamiento más barato posible (${detalle}) ya supera tu presupuesto de ${formatearEuros(criterios.presupuesto_eur)}.`;
  return { codigo: "presupuesto", texto };
}

function sugerenciaPresupuesto(minimo: number): string {
  return `Sube el presupuesto a más de ${formatearEuros(minimo)} o reduce los días o las personas.`;
}
