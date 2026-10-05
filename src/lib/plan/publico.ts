import { calcularApertura, calcularEtiquetasEncaje, formatearEtiquetasEncaje, vecinosResueltos } from "@/lib/alternativas/encaje";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { avisoRecortada, calcularHorarioDia, horaDeMinutos, minutosDeHora, type HorarioParada } from "./horario";
import { zonaDeParada } from "./zona";
import { calcularPaseoDia, ordenarParadasResueltas, type AvisoPaseo } from "./paseo";
import type { AnclaAlojamiento, Dia, EtapaPlan, Foto, TrasladoPlan, OrigenAlternativa, Parada, Plan, Procedencia, Recomendacion } from "./tipos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { EventosVersion } from "@/lib/eventos/tipos";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import { fotoSegura } from "@/lib/lugares/urlFoto";

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

// hor-ac1/hor-ac2: el rango ya viene resuelto en hora local del lugar (el
// cliente no recibe las horas de franja ni la zona) y la apertura ya
// redactada, para que la tarjeta no calcule nada.
export interface HorarioPublico extends HorarioParada {
  aviso?: string;
  apertura: string;
}

export interface ParadaPublica extends Omit<Parada, "alternativas"> {
  alternativas?: AlternativaPublica[];
  horario?: HorarioPublico;
}

export interface DiaPublico {
  fecha: string;
  // etapas-pais: índice de la etapa del día, solo en viajes de varias ciudades.
  etapa?: number;
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
  // ciu-ac5: la ciudad efectiva, para que el mapa pueda centrarse en ella y
  // para que el script de verificación del modelo real pueda comprobarla
  // sin depender de un acceso directo a la base de datos.
  ciudad?: CiudadEfectiva;
  // etapas-pais: solo en viajes de varias ciudades.
  etapas?: EtapaPlan[];
  traslados?: TrasladoPlan[];
  // eventos: ausente hasta que el trabajador los consulta.
  eventos?: EventosVersion;
  // mot-ac1: suma de las visitas con coste, calculada aquí y no en el
  // cliente.
  presupuesto: PresupuestoPublico;
}

function textoApertura(resultado: ReturnType<typeof calcularApertura>): string {
  if (resultado.estado === "abierta") return "Abierto durante la visita";
  if (resultado.estado === "desconocida") return "Horario no disponible";
  return resultado.cierre ? `Cierra a las ${resultado.cierre}, antes de que acabe la visita` : "Cerrado a esa hora";
}

function aAlternativaPublica(
  dia: Dia,
  parada: Parada,
  alternativa: NonNullable<Parada["alternativas"]>[number],
  horario: HorarioParada | undefined,
  zona: string | null,
): AlternativaPublica {
  const procedencia: Procedencia = alternativa.lugar
    ? { fuente: alternativa.lugar.fuente, url: alternativa.lugar.url }
    : { fuente: "propuesto-sin-verificar" };

  // enc-ac1: sin horario de la parada (su franja_id siempre referencia una
  // franja del día, así que no debería faltar) no hay intervalo con el que
  // evaluar la apertura -- la alternativa se sirve igual, sin esa etiqueta.
  // La alternativa ocupa el hueco de la parada, con su propia duración.
  const vecinos = vecinosResueltos(dia, parada.id);
  const etiquetasEncaje = horario
    ? formatearEtiquetasEncaje(
        calcularEtiquetasEncaje({
          parada,
          alternativa,
          coordenadasAnterior: vecinos.anterior,
          coordenadasSiguiente: vecinos.siguiente,
          intervalo: {
            fecha: dia.fecha,
            inicio: horario.inicio,
            fin: horaDeMinutos(Math.min(minutosDeHora(horario.inicio) + alternativa.duracion_min, 24 * 60 - 1)),
          },
          zona,
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
    foto: fotoSegura(alternativa.foto),
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
function aParadaPublica(dia: Dia, parada: Parada, horarios: Record<string, HorarioParada>, caja?: CajaDelimitadora): ParadaPublica {
  const procedencia: Procedencia = parada.lugar
    ? { fuente: parada.lugar.fuente, url: parada.lugar.url }
    : { fuente: "propuesto-sin-verificar" };
  const horario = horarios[parada.id];
  const zona = zonaDeParada(parada, caja);
  const etiquetaFranja = dia.franjas.find((f) => f.id === parada.franja_id)?.etiqueta ?? "";
  return {
    ...parada,
    foto: fotoSegura(parada.foto),
    procedencia,
    alternativas: parada.alternativas?.map((alternativa) => aAlternativaPublica(dia, parada, alternativa, horario, zona)),
    ...(horario
      ? {
          horario: {
            ...horario,
            ...(horario.recortada ? { aviso: avisoRecortada(etiquetaFranja) } : {}),
            apertura: textoApertura(calcularApertura(parada.lugar?.etiquetas.opening_hours, { fecha: dia.fecha, inicio: horario.inicio, fin: horario.fin }, zona)),
          },
        }
      : {}),
  };
}

// perfil: `criterios.perfil` del trabajo propietario (propiedad.ts) --
// ausente en una llamada que no lo conoce (p. ej. un script sin trabajo
// detrás), en cuyo caso el paseo usa el umbral no familiar, el más
// permisivo.
export function aPlanPublico(plan: Plan, perfil: string | null = null, presupuestoEur: number | null = null): PlanPublico {
  const { total_eur, total_estimado_eur, total_de_fuente_eur, alojamiento_eur, traslados_eur, actividades_eur } = calcularPresupuesto(plan);
  return {
    id: plan.id,
    version: plan.version,
    destino: plan.destino,
    personas: plan.personas,
    dias: plan.dias.map((dia) => {
      const horarios = calcularHorarioDia(dia);
      return {
        fecha: dia.fecha,
        ...(dia.etapa !== undefined ? { etapa: dia.etapa } : {}),
        ancla_alojamiento: dia.ancla_alojamiento,
        franjas: dia.franjas.map((f) => ({ id: f.id, etiqueta: f.etiqueta })),
        paradas: dia.paradas.map((parada) => aParadaPublica(dia, parada, horarios, plan.ciudad?.caja ?? (dia.etapa !== undefined ? plan.etapas?.[dia.etapa]?.ciudad.caja : undefined))),
        paseo: calcularPaseoDia(ordenarParadasResueltas(dia.franjas, dia.paradas), perfil) ?? undefined,
      };
    }),
    avisos: plan.avisos ?? [],
    recomendaciones: plan.recomendaciones ?? [],
    ...(plan.ciudad ? { ciudad: plan.ciudad } : {}),
    ...(plan.etapas ? { etapas: plan.etapas } : {}),
    ...(plan.traslados ? { traslados: plan.traslados } : {}),
    ...(plan.eventos ? { eventos: plan.eventos } : {}),
    presupuesto: { total_eur, total_estimado_eur, total_de_fuente_eur, alojamiento_eur, traslados_eur, actividades_eur, ...(presupuestoEur !== null ? { tu_presupuesto_eur: presupuestoEur } : {}) },
  };
}
