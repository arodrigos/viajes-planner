// apertura-conflictos: qué paradas de un día caen en una franja o a una hora
// en que, según OSM, el sitio está cerrado. Solo un «cerrado» claro es
// conflicto: lo desconocido se rotula aparte y nunca bloquea. Puro: se calcula
// al leer, no se guarda en el plan.
import { evaluarApertura, type ResultadoApertura } from "./apertura";
import { calcularTiemposDia, horaDeMinutos, minutosDeHora } from "./tiempos";
import type { OpcionesTramos } from "./tramos";
import type { Franja } from "./tipos";
import type { ElementoFijo } from "@/lib/reservas/enElDia";
import { TEXTOS_CONFLICTOS } from "@/lib/textos/conflictos";

// arreglos.ts la pide aquí para que la librería siga entrando por un solo módulo.
export { evaluarApertura };

export type ClaseConflicto = "cerrado-en-franja" | "cerrado-a-esa-hora" | "solapa-reserva" | "antes-de-llegada" | "despues-de-salida";

export interface ConflictoDia {
  paradaId: string;
  clase: ClaseConflicto;
  texto: string;
  procedencia?: { fuente: "osm"; comprobado?: string };
  reservaId?: string;
}

// Forma mínima que necesita el cálculo: la misma sirve a la Parada completa
// del servidor y a la vista que recibe el navegador.
export interface ParadaConflictable {
  id: string;
  franja_id: string;
  duracion_min: number;
  coordenadas?: { lat: number; lon: number };
  lugar?: { etiquetas: { opening_hours?: string; check_date_opening_hours?: string } };
}

export interface DiaConflictable {
  fecha: string;
  franjas: Pick<Franja, "id" | "etiqueta" | "hora_inicio" | "hora_fin">[];
  paradas: ParadaConflictable[];
  // Reservas con hora de ese día. Guardar una no mueve nada: solo cambia lo que sale aquí.
  reservas?: ElementoFijo[];
}

// Margen de seguridad alrededor de una llegada o una salida.
export const MARGEN_LLEGADA_MIN = 60;
export const MARGEN_SALIDA_MIN = { vuelo: 120, tren: 45 } as const;

export interface ContextoConflictos {
  opciones: OpcionesTramos;
  countryCode?: string;
  // El navegador ya conoce las horas que calculó el servidor; si las pasa,
  // no se recalculan con otras opciones de trayecto.
  horarios?: Record<string, { inicioMin: number; finMin: number }>;
  // Sustituye a dia.reservas cuando quien llama ya las tiene por separado.
  reservasDelDia?: ElementoFijo[];
}

export interface EvaluacionDia {
  conflictos: ConflictoDia[];
  // Paradas con etiqueta de horario que no se pudo interpretar o que trae un
  // tramo «unknown»: se rotulan, no cuentan.
  sinConfirmar: string[];
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function nombreDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

// «la mañana»: la etiqueta pública va en minúsculas con artículo.
function conArticulo(etiqueta: string): string {
  return `la ${etiqueta.toLowerCase()}`;
}

function rellenar(plantilla: string, valores: Record<string, string>): string {
  return Object.entries(valores).reduce((texto, [clave, valor]) => texto.replace(`{${clave}}`, valor), plantilla);
}

// Un conflicto con una reserva depende solo de la hora de la parada y de la
// reserva: no necesita horario OSM ni coordenadas.
function conflictoConReserva(paradaId: string, horario: { inicioMin: number; finMin: number }, fijos: readonly ElementoFijo[]): ConflictoDia | null {
  for (const f of fijos) {
    if (f.sinHora) continue;
    const base = { paradaId, reservaId: f.reservaId };
    if (f.clase === "entrada" && horario.inicioMin < f.hastaMin && horario.finMin > f.desdeMin) {
      return { ...base, clase: "solapa-reserva", texto: rellenar(TEXTOS_CONFLICTOS.chocaConEntrada.texto, { hora: horaDeMinutos(f.desdeMin) }) };
    }
    if (f.clase === "llegada" && horario.inicioMin < f.desdeMin + MARGEN_LLEGADA_MIN) {
      return { ...base, clase: "antes-de-llegada", texto: rellenar(TEXTOS_CONFLICTOS.antesDeLlegada.texto, { hora: horaDeMinutos(f.desdeMin) }) };
    }
    if (f.clase === "salida" && horario.finMin > f.desdeMin - (f.tipo === "tren" ? MARGEN_SALIDA_MIN.tren : MARGEN_SALIDA_MIN.vuelo)) {
      return { ...base, clase: "despues-de-salida", texto: rellenar(TEXTOS_CONFLICTOS.despuesDeSalida.texto, { hora: horaDeMinutos(f.desdeMin) }) };
    }
  }
  return null;
}

export function evaluarDia(dia: DiaConflictable, contexto: ContextoConflictos): EvaluacionDia {
  const horarios = contexto.horarios ?? calcularTiemposDia(dia as unknown as Parameters<typeof calcularTiemposDia>[0], contexto.opciones).horarios;
  const franjaPorId = new Map(dia.franjas.map((f) => [f.id, f]));
  const conflictos: ConflictoDia[] = [];
  const sinConfirmar: string[] = [];

  const fijos = contexto.reservasDelDia ?? dia.reservas ?? [];

  for (const parada of dia.paradas) {
    const antes = conflictos.length;
    evaluarHorario(parada);
    // Un solo conflicto por parada: el de horario va primero, y arreglarlo exige arreglar los dos.
    if (conflictos.length === antes && horarios[parada.id]) {
      const deReserva = conflictoConReserva(parada.id, horarios[parada.id], fijos);
      if (deReserva) conflictos.push(deReserva);
    }
  }
  return { conflictos, sinConfirmar };

  function evaluarHorario(parada: ParadaConflictable) {
    const reglaOsm = parada.lugar?.etiquetas.opening_hours;
    const franja = franjaPorId.get(parada.franja_id);
    const horario = horarios[parada.id];
    // Sin horario OSM, sin coordenadas o sin hora calculada no hay nada que comprobar.
    if (!reglaOsm || !parada.coordenadas || !franja || !horario) return;

    const lugar = { lat: parada.coordenadas.lat, lon: parada.coordenadas.lon, ...(contexto.countryCode ? { country_code: contexto.countryCode } : {}) };
    const comun = { opening_hours: reglaOsm, check_date: parada.lugar?.etiquetas.check_date_opening_hours, fecha: dia.fecha, duracionMin: parada.duracion_min, lugar };
    const procedencia = { fuente: "osm" as const, ...(parada.lugar?.etiquetas.check_date_opening_hours ? { comprobado: parada.lugar.etiquetas.check_date_opening_hours } : {}) };
    const franjaDesde = minutosDeHora(franja.hora_inicio);
    const franjaHasta = minutosDeHora(franja.hora_fin);

    const enFranja: ResultadoApertura = evaluarApertura({ ...comun, desdeMin: franjaDesde, hastaMin: franjaHasta });
    if (enFranja.estado === "desconocido") {
      sinConfirmar.push(parada.id);
      return;
    }
    if (enFranja.estado === "cerrado") {
      const primero = enFranja.intervalos[0];
      const ultimo = enFranja.intervalos[enFranja.intervalos.length - 1];
      // Sin ningún tramo abierto en la franja, lo que importa al usuario es el día.
      const diaEntero = evaluarApertura({ ...comun, desdeMin: 0, hastaMin: 1440, duracionMin: 1 });
      const texto = !primero
        ? diaEntero.estado === "cerrado"
          ? rellenar(TEXTOS_CONFLICTOS.cerradoElDia.texto, { dia: nombreDia(dia.fecha) })
          : rellenar(TEXTOS_CONFLICTOS.cerradoEnFranjaSinHueco.texto, { franja: conArticulo(franja.etiqueta) })
        : rellenar(TEXTOS_CONFLICTOS.cerradoEnFranja.texto, { franja: conArticulo(franja.etiqueta), abre: horaDeMinutos(primero.desdeMin), cierra: horaDeMinutos(ultimo.hastaMin) });
      conflictos.push({ paradaId: parada.id, clase: "cerrado-en-franja", texto, procedencia });
      return;
    }

    // Cabe en la franja: ahora, desde la hora a la que se llega. Esperar a que
    // abra no es conflicto, así que la ventana llega hasta el final de la
    // franja (o hasta el fin de la visita si se pasa de ella).
    const desde = horario.inicioMin;
    const hasta = Math.max(franjaHasta, horario.finMin);
    const alLlegar = evaluarApertura({ ...comun, desdeMin: desde, hastaMin: hasta });
    if (alLlegar.estado === "desconocido") {
      sinConfirmar.push(parada.id);
      return;
    }
    if (alLlegar.estado === "cerrado") {
      // El cierre que importa es el del último tramo abierto que ya había
      // empezado cuando llegas.
      const ventana = evaluarApertura({ ...comun, desdeMin: franjaDesde, hastaMin: hasta });
      const previos = ventana.intervalos.filter((i) => i.desdeMin <= desde);
      const cierre = previos.length > 0 ? Math.max(...previos.map((i) => i.hastaMin)) : undefined;
      const texto =
        cierre !== undefined
          ? rellenar(TEXTOS_CONFLICTOS.cerradoAEsaHora.texto, { cierra: horaDeMinutos(cierre), llegada: horaDeMinutos(desde) })
          : rellenar(TEXTOS_CONFLICTOS.cerradoAlLlegar.texto, { llegada: horaDeMinutos(desde) });
      conflictos.push({ paradaId: parada.id, clase: "cerrado-a-esa-hora", texto, procedencia });
    }
  }
}

export function detectarConflictosDia(dia: DiaConflictable, contexto: ContextoConflictos): ConflictoDia[] {
  return evaluarDia(dia, contexto).conflictos;
}
