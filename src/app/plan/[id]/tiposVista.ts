import type { EstadoGoogleParada } from "@/lib/google/estados";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { CosteParada, CuriosidadesParada, GuiaParada, EtapaPlan, TrasladoPlan } from "@/lib/plan/tipos";
import type { Tramo } from "@/lib/plan/tramos";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import type { EventosVersion } from "@/lib/eventos/tipos";

// Forma que el cliente recibe de /api/plan/[id]; sale de VistaPlan.tsx al
// trocearlo en componentes.

export interface FranjaPublica {
  id: string;
  etiqueta: string;
}

export interface ProcedenciaPublica {
  fuente: "propuesto-sin-verificar" | "osm" | "wikipedia";
  url?: string;
}

export interface FotoPublica {
  url: string;
  autor: string;
  licencia: string;
  licencia_url: string;
  pagina_url: string;
}

// bloque alternativas-equivalentes
export interface AlternativaPublica {
  id?: string;
  nombre: string;
  descripcion: string;
  motivo: string;
  origen?: "modelo" | "cercano";
  distancia_m?: number;
  foto?: FotoPublica;
  coordenadas?: { lat: number; lon: number };
  procedencia: ProcedenciaPublica;
  // encaje-y-paseo (enc-ac1): ya formateadas por el servidor
  // (formatearEtiquetasEncaje) -- este componente solo las pinta.
  etiquetasEncaje: string[];
}

// encaje-y-paseo (enc-ac2)
export interface AvisoPaseoPublico {
  texto: string;
  paradaId: string;
}

export interface PaseoPublico {
  km: number;
  kmTransporte?: number;
  aviso?: AvisoPaseoPublico;
}

export interface ParadaPublica {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  procedencia: ProcedenciaPublica;
  coordenadas?: { lat: number; lon: number };
  foto?: FotoPublica;
  alternativas?: AlternativaPublica[];
  // horario-local (hor-ac1/hor-ac2): ya resuelto por el servidor en hora
  // local del lugar.
  horario?: { inicio: string; fin: string; recortada: boolean; aviso?: string; apertura: string };
  // bloque uso-en-destino (dest-ac1/dest-ac4): ausente cuando no está
  // visitada, mismo patrón que el resto de este tipo.
  visitada?: boolean;
  // motivo-y-presupuesto (mot-ac1): ausentes en planes anteriores.
  motivo?: string;
  coste?: CosteParada;
  // guia-abierta: texto de fuentes abiertas que escribe el trabajador.
  guia?: GuiaParada;
  curiosidades?: CuriosidadesParada;
  guia_intentada_en?: string;
  // ficha-google: solo el estado; el place_id no llega nunca a la página.
  google?: { estado: EstadoGoogleParada };
}

export interface DiaPublico {
  fecha: string;
  // etapas-pais: índice de la etapa del día, solo en viajes de varias ciudades.
  etapa?: number;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
  paseo?: PaseoPublico;
  // tramos-dia: ya calculados por el servidor; aquí solo se pintan.
  tramos?: Tramo[];
}

export interface RecomendacionPublica {
  tipo: string;
  nombre: string;
  motivo: string;
}

export interface PlanPublico {
  id: string;
  version: number;
  destino: string;
  dias: DiaPublico[];
  avisos: string[];
  recomendaciones: RecomendacionPublica[];
  // reg-ac4: el aviso de "se está regenerando" y su enlace al progreso
  // necesitan saber si hay una regeneración en vuelo y a qué trabajo
  // enlazar -- route.ts los añade por encima de aPlanPublico.
  regenerando: boolean;
  trabajoId: string;
  // ciudad-a-mano (man-ac1): ausente cuando el relleno todavía no la ha
  // intentado -- mismo patrón que el resto de campos opcionales de este
  // tipo (ver aPlanPublico en publico.ts).
  ciudad?: CiudadEfectiva;
  // Opcional en el cliente: los dobles de test y una respuesta cacheada de
  // antes de este bloque no lo traen y la cabecera simplemente no aparece.
  presupuesto?: PresupuestoPublico;
  // etapas-vista: solo en viajes de varias ciudades.
  etapas?: EtapaPlan[];
  traslados?: TrasladoPlan[];
  // eventos: ausente mientras el trabajador no los haya consultado.
  eventos?: EventosVersion;
  personas?: number;
  // vista-por-dias: zona horaria del destino (la calcula el servidor).
  zona?: string;
}
