// Modelo del plan: viaje -> días -> franjas -> paradas, más el ancla de
// alojamiento por día. hora_inicio/hora_fin son INTERNAS a propósito (ver
// tipos-publicos.ts): son la traducción directa a ventana temporal de VROOM
// (costura con la fase 2) y no deben llegar nunca al cliente.

// Hasta el bloque lugares-resolucion, "propuesto-sin-verificar" era el
// único valor posible (no había ficha contra la que resolver). Ahora una
// parada resuelta contra las fuentes abiertas (Nominatim/OSM o Wikipedia)
// tiene procedencia "osm" o "wikipedia" con `url` hacia la fuente; la
// pública se DERIVA en repositorio.ts a partir de `lugar`, nunca se
// guarda en la tabla `procedencias` (su CHECK solo admite
// 'propuesto-sin-verificar': ver migración 005 y el diseño de este
// bloque sobre por qué no se amplía).
export type FuenteProcedencia = "propuesto-sin-verificar" | "osm" | "wikipedia";

export interface Procedencia {
  fuente: FuenteProcedencia;
  url?: string;
}

// Enum cerrado que el modelo puede proponer por parada (bloque
// lugares-resolucion): condiciona la regla de aceptación (aceptacion.ts)
// y, más adelante, el filtro de equivalencia de alternativas.
export const CATEGORIAS_PARADA = [
  "monumento",
  "museo",
  "parque",
  "mirador",
  "barrio",
  "plaza",
  "mercado",
  "playa",
  "naturaleza",
  "ocio-infantil",
  "espectaculo",
  "comida",
  "compras",
  "otro",
] as const;

export type CategoriaParada = (typeof CATEGORIAS_PARADA)[number];

export interface EtiquetasLugar {
  opening_hours?: string;
  wikipedia?: string;
  wikidata?: string;
  website?: string;
}

// Resultado de resolver una parada contra una fuente abierta real: de
// dónde sale el pin, con qué identificador estable y cuándo se resolvió.
export interface Lugar {
  fuente: "osm" | "wikipedia";
  id: string;
  url: string;
  nombre_fuente: string;
  etiquetas: EtiquetasLugar;
  resuelto_en: string;
}

export type EstadoResolucion = "resuelta" | "no-resuelta" | "error";

export interface InfoResolucion {
  estado: EstadoResolucion;
  intentado_en: string;
  motivo?: string;
}

// Foto de la parada (bloque fotos-paradas, se deja el tipo preparado aquí
// porque Parada ya referencia el campo opcional).
export interface Foto {
  url: string;
  fichero: string;
  autor: string;
  licencia: string;
  licencia_url: string;
  pagina_url: string;
  fuente: "commons";
}

// Las seis franjas de un día. Los límites horarios son configuración por
// destino (ver config-franjas.ts), nunca constantes aquí.
export interface Franja {
  id: string;
  etiqueta: string;
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
}

// nombre y descripcion son lo único que la fase 1 escribe de verdad.
// coordenadas, ficha, apertura y presupuesto se declaran opcionales desde
// ahora para que las fases siguientes (resolución contra fichas, F2-02 en
// adelante) no obliguen a migrar los planes ya guardados: guardar un campo
// opcional sin usar cuesta la columna; añadirlo después cuesta reescribir
// cada plan existente.
export interface Parada {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  duracion_min: number;
  prioridad: number; // 0-100
  procedencia: Procedencia;
  coordenadas?: { lat: number; lon: number };
  // Lo único nuevo que el modelo aporta en este bloque (tipos.ts, lug-ac4):
  // todo lo demás de aquí abajo lo rellena resolverPlan, nunca el modelo.
  categoria?: CategoriaParada;
  lugar?: Lugar;
  resolucion?: InfoResolucion;
  foto?: Foto;
  // bloque fotos-paradas (fot-ac4): se guarda SIEMPRE que se intenta
  // buscar foto, con éxito o sin él -- es lo que permite al barrido
  // distinguir "todavía no se ha intentado" ('foto' y esto ambos null) de
  // "se intentó y no había foto aceptable" ('foto' null, esto con fecha).
  foto_intentada_en?: string;
  // bloque alternativas-equivalentes: solo en planes generados a partir de
  // este bloque (decisión de Adrián) -- ausente o vacío en los anteriores,
  // nunca un array a medias.
  alternativas?: Alternativa[];
}

// bloque alternativas-equivalentes: de dónde sale una alternativa -- el
// modelo la propuso en la misma invocación (origen "modelo") o la
// completó Overpass sin modelo porque faltaban (origen "cercano"). El
// motivo de "cercano" es siempre determinista (distancia + categoría);
// el de "modelo" es el que el propio modelo escribió.
export type OrigenAlternativa = "modelo" | "cercano";

// Alternativa equivalente a una parada (bloque alternativas-equivalentes).
// nombre/descripcion/motivo/duracion_min los origina el modelo (el
// ensamblador los copia tal cual, sin más campos: alt-ac2). categoria y
// origen los pone resolverAlternativasPlan (categoria = la de la parada,
// nunca la propone el modelo por alternativa; origen distingue "modelo"
// de "cercano") y por eso son opcionales en el tipo -- ausentes en la
// propuesta cruda recién ensamblada, siempre presentes en una alternativa
// ya resuelta y guardada. coordenadas/lugar/foto, igual que en Parada, los
// rellena la resolución, nunca el modelo.
export interface Alternativa {
  nombre: string;
  descripcion: string;
  motivo: string;
  duracion_min: number;
  categoria?: CategoriaParada;
  origen?: OrigenAlternativa;
  coordenadas?: { lat: number; lon: number };
  lugar?: Lugar;
  foto?: Foto;
}

export type AnclaAlojamiento =
  | { tipo: "zona-propuesta"; centroide: { lat: number; lon: number }; radio_m: number }
  | { tipo: "usuario"; direccion: string };

export interface Dia {
  fecha: string; // "YYYY-MM-DD"
  // Opcional en fase 1: el modelo no propone alojamiento todavía (F2-06).
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: Franja[];
  paradas: Parada[];
}

// bloque recomendaciones-de-sitios: lo único que el modelo puede originar
// de verdad sobre un sitio de comida o un recinto -tipo, nombre y motivo-,
// nunca una dirección (ver urlBusquedaSitio.ts, que la construye aparte y
// de forma determinista). El propio tipo no admite un campo "url": es la
// misma defensa que ya usa Procedencia, ahora aplicada aquí.
export type TipoRecomendacion = "comida" | "recinto";

export interface Recomendacion {
  tipo: TipoRecomendacion;
  nombre: string;
  motivo: string;
}

export interface Plan {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: Dia[];
  // bloque generacion (ac2): explica en vez de callar cuando se excluyen
  // paradas por categoría de riesgo. Vacío o ausente cuando no hubo nada
  // que excluir.
  avisos?: string[];
  // bloque recomendaciones-de-sitios: vacío o ausente cuando el modelo no
  // propuso ninguna -el plan se guarda igual, nunca a medias por esto.
  recomendaciones?: Recomendacion[];
}
