// Las paradas generadas antes de lug-ac4 no traen `categoria`, y sin ella la
// pasada de alternativas ni consulta Overpass. Esta deducción es sin red: usa
// la clasificación OSM guardada con el lugar cuando existe y, si no, el
// nombre. Prefiere dejar la parada sin categoría a adivinar mal: una
// categoría equivocada traería alternativas de otro tipo.
import type { CategoriaParada } from "@/lib/plan/tipos";
import type { EtiquetasLugar } from "@/lib/lugares/tipos";

const POR_CLASIFICACION_OSM: Record<string, CategoriaParada> = {
  "tourism=museum": "museo",
  "tourism=gallery": "museo",
  "tourism=viewpoint": "mirador",
  "leisure=park": "parque",
  "leisure=garden": "parque",
  "leisure=nature_reserve": "naturaleza",
  "leisure=playground": "ocio-infantil",
  "natural=beach": "playa",
  "place=suburb": "barrio",
  "place=neighbourhood": "barrio",
  "place=square": "plaza",
  "amenity=marketplace": "mercado",
  "amenity=theatre": "espectaculo",
  "amenity=cinema": "espectaculo",
  "amenity=restaurant": "comida",
  "amenity=cafe": "comida",
};
const POR_CLASE_OSM: Record<string, CategoriaParada> = { historic: "monumento", shop: "compras" };

// Orden significativo: la primera que case gana («Museo del Parque» es museo).
const POR_NOMBRE: Array<[RegExp, CategoriaParada]> = [
  [/\b(museum|museo|museu|gallery|galer[ií]a)\b/i, "museo"],
  [/\b(market|mercado|mercat|mercato)\b/i, "mercado"],
  [/\b(park|parque|parc|garden|gardens|jard[ií]n|jardines)\b/i, "parque"],
  [/\b(beach|playa|platja|praia)\b/i, "playa"],
  [/\b(viewpoint|mirador|lookout)\b/i, "mirador"],
  [/\b(square|plaza|piazza|place)\b/i, "plaza"],
  [/\b(restaurant|restaurante|tapas|bistro|caf[eé])\b/i, "comida"],
  [/\b(theatre|theater|teatro|opera|[óo]pera)\b/i, "espectaculo"],
  [/\b(cathedral|catedral|castle|castillo|palace|palacio|abbey|abad[ií]a|tower|torre|bridge|puente|monastery|monasterio|basilica|bas[ií]lica)\b/i, "monumento"],
];

export function inferirCategoria(nombre: string, etiquetas?: EtiquetasLugar): CategoriaParada | null {
  const clasificacion = etiquetas?.clasificacion_osm;
  if (clasificacion) {
    // hasOwn y no `??` sobre el objeto: una clasificación como «constructor» o
    // «__proto__» resolvería a una propiedad heredada, no a una categoría.
    const clase = clasificacion.split("=")[0] ?? "";
    if (Object.hasOwn(POR_CLASIFICACION_OSM, clasificacion)) return POR_CLASIFICACION_OSM[clasificacion] ?? null;
    if (Object.hasOwn(POR_CLASE_OSM, clase)) return POR_CLASE_OSM[clase] ?? null;
  }
  for (const [patron, categoria] of POR_NOMBRE) {
    if (patron.test(nombre)) return categoria;
  }
  return null;
}
