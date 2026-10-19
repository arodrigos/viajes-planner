import type { FuenteCercanos } from "@/lib/alternativas/cercanos";
import { PresupuestoAgotado, type FuenteCiudad, type FuenteFotos, type FuenteLugares, type PresupuestoPeticiones } from "@/lib/lugares/tipos";

// Tope único de peticiones a servicios externos (Nominatim, Wikipedia/Commons,
// Overpass) para TODAS las fases del barrido de un tick. Antes cada fase
// aplicaba su propio tope de 120 por separado, así que un tick podía sumar
// varias veces ese número; ahora las fases se reparten este mismo cupo en
// orden de prioridad y lo que no cabe espera al siguiente tick.
export const PRESUPUESTO_PETICIONES_POR_TICK = 120;

export interface PresupuestoTick extends PresupuestoPeticiones {
  restantes(): number;
}

export function crearPresupuestoTick(maximo: number): PresupuestoTick {
  let gastadas = 0;
  return {
    consumir() {
      if (gastadas >= maximo) return false;
      gastadas++;
      return true;
    },
    consumidas: () => gastadas,
    restantes: () => Math.max(0, maximo - gastadas),
  };
}

// Un tope dentro de otro: lo que se gasta aquí sale también del padre, así
// que nunca se pasa ni de `maximo` ni de lo que le quede al padre. Sirve
// para el tope por plan de la deducción de ciudad y para la parte del cupo
// del tick que puede llevarse la fase de ciudades.
export function presupuestoAnidado(padre: PresupuestoTick, maximo: number): PresupuestoTick {
  let gastadas = 0;
  return {
    consumir() {
      if (gastadas >= maximo || !padre.consumir()) return false;
      gastadas++;
      return true;
    },
    consumidas: () => gastadas,
    restantes: () => Math.min(Math.max(0, maximo - gastadas), padre.restantes()),
  };
}

function reservar(presupuesto: PresupuestoPeticiones): void {
  if (!presupuesto.consumir()) throw new PresupuestoAgotado("presupuesto de peticiones del tick agotado");
}

// Se cuenta cada llamada a la fuente, también las que la caché resuelve sin
// salir a la red: es una cota superior de las peticiones reales, nunca una
// estimación a la baja.
export function fuenteLugaresConTope(fuente: FuenteLugares, presupuesto: PresupuestoPeticiones): FuenteLugares {
  return {
    geocodificarDestino: (destino) => {
      reservar(presupuesto);
      return fuente.geocodificarDestino(destino);
    },
    buscarNominatim: (nombre, cualificador, bbox) => {
      reservar(presupuesto);
      return fuente.buscarNominatim(nombre, cualificador, bbox);
    },
    buscarWikipedia: (nombre, cualificador, bbox) => {
      reservar(presupuesto);
      return fuente.buscarWikipedia(nombre, cualificador, bbox);
    },
  };
}

// Para la deducción de ciudad con una fuente que no sabe descontar
// presupuesto por sí misma (la real sí, y solo cuenta lo que sale a la red):
// así el tope por plan y el del tick rigen igual con cualquier fuente.
export function fuenteCiudadConTope(fuente: FuenteLugares & FuenteCiudad, presupuesto: PresupuestoPeticiones): FuenteLugares & FuenteCiudad {
  const geocodificarZona = fuente.geocodificarZona?.bind(fuente);
  return {
    ...fuenteLugaresConTope(fuente, presupuesto),
    buscarLibre: (nombre) => {
      reservar(presupuesto);
      return fuente.buscarLibre(nombre);
    },
    geocodificarCiudad: (nombre) => {
      reservar(presupuesto);
      return fuente.geocodificarCiudad(nombre);
    },
    ...(geocodificarZona
      ? {
          geocodificarZona: (texto: string) => {
            reservar(presupuesto);
            return geocodificarZona(texto);
          },
        }
      : {}),
  };
}

export function fuenteFotosConTope(fuente: FuenteFotos, presupuesto: PresupuestoPeticiones): FuenteFotos {
  return {
    resumenPagina: (lang, titulo) => {
      reservar(presupuesto);
      return fuente.resumenPagina(lang, titulo);
    },
    infoImagen: (fichero) => {
      reservar(presupuesto);
      return fuente.infoImagen(fichero);
    },
    geosearch: (lat, lon) => {
      reservar(presupuesto);
      return fuente.geosearch(lat, lon);
    },
  };
}

export function fuenteCercanosConTope(fuente: FuenteCercanos, presupuesto: PresupuestoPeticiones): FuenteCercanos {
  return {
    buscar: (categoria, lat, lon, radioM) => {
      reservar(presupuesto);
      return fuente.buscar(categoria, lat, lon, radioM);
    },
  };
}
