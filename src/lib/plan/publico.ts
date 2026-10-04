import { calcularEtiquetasEncaje, formatearEtiquetasEncaje, vecinosResueltos } from "@/lib/alternativas/encaje";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { calcularPaseoDia, ordenarParadasResueltas, type AvisoPaseo } from "./paseo";
import type { AnclaAlojamiento, Dia, Foto, OrigenAlternativa, Parada, Plan, Procedencia, Recomendacion } from "./tipos";

// Serialización hacia el cliente. hora_inicio/hora_fin son internas (costura
// con VROOM en fase 2) y no se envían nunca: que no se envíen es lo que
// comprueba esquema-plan-ac2, no una convención de nombres.
export interface FranjaPublica {
  id: string;
  etiqueta: string;
}

// alt-ac5: la procedencia y la distancia de una alternativa se derivan al
// serializar, igual que la procedencia de una parada (repositorio.ts) --
// nunca se guardan por duplicado.
export interface AlternativaPublica {
  id?: string;
  nombre: string;
  descripcion: string;
  motivo: string;
  duracion_min: number;
  origen?: OrigenAlternativa;
  distancia_m?: number;
  foto?: Foto;
  coordenadas?: { lat: number; lon: number };
  procedencia: Procedencia;
  // encaje-y-paseo (enc-ac1): hechos deterministas ya formateados como
  // texto ("A 350 m de la parada anterior", "Abre a esa hora"...) --
  // nunca las horas de franja en sí (esquema-plan-ac2), de las que se
  // derivan sin enviarlas.
  etiquetasEncaje: string[];
}

export interface ParadaPublica extends Omit<Parada, "alternativas"> {
  alternativas?: AlternativaPublica[];
}

export interface DiaPublico {
  fecha: string;
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
  // encaje-y-paseo (enc-ac2): ausente cuando el día tiene menos de dos
  // paradas resueltas -- nunca un paseo a medias.
  paseo?: { km: number; aviso?: AvisoPaseo };
}

export interface PlanPublico {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: DiaPublico[];
  avisos: string[];
  recomendaciones: Recomendacion[];
}

function aAlternativaPublica(
  dia: Dia,
  parada: Parada,
  alternativa: NonNullable<Parada["alternativas"]>[number],
): AlternativaPublica {
  const procedencia: Procedencia = alternativa.lugar
    ? { fuente: alternativa.lugar.fuente, url: alternativa.lugar.url }
    : { fuente: "propuesto-sin-verificar" };

  // enc-ac1: sin la franja de la parada (no debería faltar: franja_id
  // siempre referencia una de las franjas del propio día) no hay ventana
  // horaria con la que evaluar la apertura -- la alternativa se sirve
  // igual, solo sin esa etiqueta concreta.
  const franja = dia.franjas.find((f) => f.id === parada.franja_id);
  const vecinos = vecinosResueltos(dia, parada.id);
  const etiquetasEncaje = franja
    ? formatearEtiquetasEncaje(
        calcularEtiquetasEncaje({
          parada,
          alternativa,
          coordenadasAnterior: vecinos.anterior,
          coordenadasSiguiente: vecinos.siguiente,
          fecha: dia.fecha,
          horaInicioFranja: franja.hora_inicio,
        }),
      )
    : [];

  return {
    id: alternativa.id,
    nombre: alternativa.nombre,
    descripcion: alternativa.descripcion,
    motivo: alternativa.motivo,
    duracion_min: alternativa.duracion_min,
    origen: alternativa.origen,
    ...(parada.coordenadas && alternativa.coordenadas
      ? { distancia_m: Math.round(distanciaMetros(parada.coordenadas, alternativa.coordenadas)) }
      : {}),
    foto: alternativa.foto,
    coordenadas: alternativa.coordenadas,
    procedencia,
    etiquetasEncaje,
  };
}

// alt-ac1 (verificacion_modelo_real): la procedencia pública de una parada
// se deriva aquí, a partir de `lugar`, el mismo único sitio que ya usa
// `aAlternativaPublica` -- antes solo se derivaba al leer con
// `repositorio.recuperarPlan`, así que un `Plan` que nunca pasó por la base
// de datos (como el de `scripts/generar-plan-real.ts --resolver`) se
// serializaba siempre con `propuesto-sin-verificar` aunque `lugar` ya
// tuviera coordenadas reales.
function aParadaPublica(dia: Dia, parada: Parada): ParadaPublica {
  const procedencia: Procedencia = parada.lugar
    ? { fuente: parada.lugar.fuente, url: parada.lugar.url }
    : { fuente: "propuesto-sin-verificar" };
  return {
    ...parada,
    procedencia,
    alternativas: parada.alternativas?.map((alternativa) => aAlternativaPublica(dia, parada, alternativa)),
  };
}

// perfil: `criterios.perfil` del trabajo propietario (propiedad.ts) --
// ausente en una llamada que no lo conoce (p. ej. un script sin trabajo
// detrás), en cuyo caso el paseo usa el umbral no familiar, el más
// permisivo.
export function aPlanPublico(plan: Plan, perfil: string | null = null): PlanPublico {
  return {
    id: plan.id,
    version: plan.version,
    destino: plan.destino,
    personas: plan.personas,
    dias: plan.dias.map((dia) => ({
      fecha: dia.fecha,
      ancla_alojamiento: dia.ancla_alojamiento,
      franjas: dia.franjas.map((f) => ({ id: f.id, etiqueta: f.etiqueta })),
      paradas: dia.paradas.map((parada) => aParadaPublica(dia, parada)),
      paseo: calcularPaseoDia(ordenarParadasResueltas(dia.franjas, dia.paradas), perfil) ?? undefined,
    })),
    avisos: plan.avisos ?? [],
    recomendaciones: plan.recomendaciones ?? [],
  };
}
