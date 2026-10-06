// Modelo del plan: viaje -> días -> franjas -> paradas, más el ancla de
// alojamiento por día. hora_inicio/hora_fin son INTERNAS a propósito (ver
// tipos-publicos.ts): son la traducción directa a ventana temporal de VROOM
// (costura con la fase 2) y no deben llegar nunca al cliente.
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { Modo } from "@/lib/criterios/tipos";
import type { EventosVersion } from "@/lib/eventos/tipos";

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

// motivo-y-presupuesto: precio orientativo de una parada. `por` decide cómo
// se multiplica (persona x personas, grupo tal cual, gratis = 0);
// `procedencia` separa lo que el modelo estima de lo que viene de una fuente
// (Wikivoyage, en bloques posteriores) para que el presupuesto no presente
// una estimación como un dato.
export type PorCoste = "persona" | "grupo" | "gratis";
export type ProcedenciaCoste = "estimado" | "wikivoyage";

export interface CosteParada {
  importe_eur: number;
  por: PorCoste;
  procedencia: ProcedenciaCoste;
  fecha: string;
}

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
  // bloque uso-en-destino (dest-ac4): se deriva en repositorio.ts a partir
  // de `visitas`, leída por (plan_id, id_externo) a través de CUALQUIER
  // versión -- nunca se guarda en esta fila, así que sobrevive a una
  // sustitución de otra parada del mismo día. Ausente (nunca `false`
  // explícito) cuando no está visitada, mismo patrón que el resto de
  // campos derivados de este fichero.
  visitada?: boolean;
  // motivo-y-presupuesto: ausentes en planes anteriores y cuando el modelo
  // no los dio o los dio mal formados (el ensamblador los descarta sin
  // invalidar el plan).
  motivo?: string;
  coste?: CosteParada;
  // guia-abierta: texto de fuentes abiertas que el trabajador escribe en la
  // base de datos, nunca el modelo ni la vista. `guia_intentada_en` separa
  // «aún no se ha mirado» de «se miró y no había nada».
  guia?: GuiaParada;
  curiosidades?: CuriosidadesParada;
  guia_intentada_en?: string;
  // Versión del formato con que se guardó la guía (FORMATO_GUIA al escribirla).
  guia_formato?: number;
}

// guia-abierta: la ficha de Wikivoyage asignada a la parada. `precio_eur`
// solo existe si el precio de la ficha es un importe claro; si no, la vista
// enseña `precio_texto` literal y nada se suma al presupuesto.
export interface GuiaParada {
  consejo: string;
  precio_texto?: string;
  precio_eur?: number;
  url: string;
  licencia: "CC BY-SA";
}

export interface CuriosidadesParada {
  frases: string[];
  url: string;
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
  // Id de fila (paradas_alternativas.id) -- ausente en una alternativa
  // recién propuesta por el modelo o por Overpass, antes de guardarse;
  // siempre presente en una ya leída de la base de datos, que es lo que
  // el endpoint de sustitución necesita para identificarla sin ambigüedad.
  id?: string;
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
  // etapas-pais: índice de la etapa a la que pertenece el día. Ausente en
  // los planes de una sola ciudad.
  etapa?: number;
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

// etapas-pais: una ciudad de un viaje de varias. `ciudad` es la ciudad
// efectiva de la etapa (con su caja de como mucho 2 grados) y `ajustes`
// cada corrección que el planificador hizo a lo que propuso el modelo.
export interface EtapaPlan {
  ciudad: CiudadEfectiva;
  pais: string;
  dias: number;
  dia_inicio: number;
  motivo?: string;
  // Para el grupo entero, no por persona.
  alojamiento_noche_eur: number;
  zona: number;
  ajustes: string[];
}

// Tramo entre dos etapas consecutivas; siempre estimado por distancia.
export interface TrasladoPlan {
  desde: string;
  hasta: string;
  modo: Modo;
  distancia_km: number;
  duracion_min: number;
  coste_eur: number;
  procedencia: "estimado";
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
  // ciu-ac1: la ciudad efectiva del plan (destino -> paradas ->
  // sin-ciudad-identificable), persistida en planes.ciudad. Ausente en un
  // plan que todavía no pasó por resolverCiudadEfectiva ni por la
  // resolución manual.
  ciudad?: CiudadEfectiva;
  // etapas-pais: solo en viajes de varias ciudades. Siempre hay un traslado
  // menos que etapas.
  etapas?: EtapaPlan[];
  traslados?: TrasladoPlan[];
  // eventos: ausente hasta que el trabajador los consulta.
  eventos?: EventosVersion;
  eventos_intentados_en?: string;
}
