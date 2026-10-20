import type { CategoriaParada } from "@/lib/plan/tipos";

// Listas cerradas: son también la lista blanca del esquema, así que nada de
// texto libre llega al prompt. Un valor nuevo se añade aquí y se propaga solo.
export const RITMOS = ["tranquilo", "normal", "intenso"] as const;
export type Ritmo = (typeof RITMOS)[number];

export const INTERESES = ["museos", "naturaleza", "gastronomia", "parques-ninos", "monumentos", "compras"] as const;
export type Interes = (typeof INTERESES)[number];

export const MAX_INTERESES = 3;

export const ETIQUETA_INTERES: Record<Interes, string> = {
  museos: "Museos",
  naturaleza: "Naturaleza",
  gastronomia: "Gastronomía",
  "parques-ninos": "Parques y juegos para niños",
  monumentos: "Monumentos",
  compras: "Compras",
};

// El interés se deriva de la categoría que la parada ya trae, para no tocar
// el contrato con el modelo (su esquema de salida y los goldens).
export const CATEGORIAS_DE_INTERES: Record<Interes, readonly CategoriaParada[]> = {
  museos: ["museo"],
  naturaleza: ["naturaleza", "parque", "mirador", "playa"],
  gastronomia: ["comida", "mercado"],
  "parques-ninos": ["ocio-infantil", "parque"],
  monumentos: ["monumento", "plaza", "barrio"],
  compras: ["compras", "mercado"],
};

// Manda el orden del usuario: con intereses ['parques-ninos','naturaleza'] un
// parque cita el primero.
export function interesDeParada(categoria: CategoriaParada | undefined | null, intereses: readonly Interes[] | null | undefined): Interes | undefined {
  if (!categoria || !intereses) return undefined;
  return intereses.find((i) => CATEGORIAS_DE_INTERES[i].includes(categoria));
}
