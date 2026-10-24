import { ERRORES_RESERVA as E } from "@/lib/textos/reservas";
import type { ReservaEntrada, TipoReserva } from "./tipos";
import { TIPOS_RESERVA } from "./tipos";

// Mismas reglas en el formulario, en la ruta y en los CHECK de la migración 037:
// aquí se aplican antes para dar un mensaje claro en su campo, allí para que
// ninguna otra vía pueda saltárselas.
export const LIMITES = { zona: 64, origen: 80, destino: 80, nombre: 80, direccion: 160, localizador: 20, notas: 200 } as const;
type CampoTexto = Exclude<keyof typeof LIMITES, "zona">;

// Caracteres de control (saltos de línea incluidos): nada raro llega al .ics.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})(?::\d{2})?$/;

export function limpiarTexto(texto: string): string {
  return texto.replace(CONTROL, "").trim();
}

// Postgres cuenta caracteres, no unidades UTF-16: un emoji es uno.
export function longitud(texto: string): number {
  return Array.from(texto).length;
}

export type ErroresReserva = Partial<Record<keyof ReservaEntrada | "ubicacion" | "general", string>>;
export type ResultadoReserva = { ok: true; reserva: ReservaEntrada } | { ok: false; errores: ErroresReserva };

export interface ContextoReserva {
  // Primer y último día del viaje (YYYY-MM-DD). Sin él no se comprueba el rango.
  viaje?: { desde: string; hasta: string };
}

function fechaValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = FECHA.exec(valor);
  if (!m) return null;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return f.getUTCFullYear() === +m[1] && f.getUTCMonth() === +m[2] - 1 && f.getUTCDate() === +m[3] ? valor : null;
}

// Devuelve "HH:MM" normalizado (la base devuelve HH:MM:SS).
function horaValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = HORA.exec(valor);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1]}:${m[2]}`;
}

function sumarDias(fecha: string, dias: number): string {
  const f = new Date(`${fecha}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

const vacio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function validarReserva(entrada: unknown, contexto: ContextoReserva = {}): ResultadoReserva {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) return { ok: false, errores: { general: E.cuerpo } };
  const e = entrada as Record<string, unknown>;
  const errores: ErroresReserva = {};
  const r: Record<string, unknown> = {};

  if (typeof e.tipo !== "string" || !(TIPOS_RESERVA as readonly string[]).includes(e.tipo)) return { ok: false, errores: { tipo: E.tipo } };
  const tipo = e.tipo as TipoReserva;
  r.tipo = tipo;
  const transporte = tipo === "vuelo" || tipo === "tren";

  if (transporte) {
    if (e.sentido === "ida" || e.sentido === "vuelta") r.sentido = e.sentido;
    else errores.sentido = E.sentido;
  } else if (!vacio(e.sentido)) errores.sentido = E.cuerpo;

  const texto = (campo: CampoTexto, obligatorio: boolean, permitido = true) => {
    const valor = e[campo];
    if (vacio(valor) || !permitido) {
      if (obligatorio) errores[campo] = E.falta[campo as keyof typeof E.falta] ?? E.cuerpo;
      return;
    }
    if (typeof valor !== "string") {
      errores[campo] = E.cuerpo;
      return;
    }
    const limpio = limpiarTexto(valor);
    if (longitud(limpio) > LIMITES[campo]) errores[campo] = E.demasiado(LIMITES[campo]);
    else if (limpio === "") {
      if (obligatorio) errores[campo] = E.falta[campo as keyof typeof E.falta] ?? E.cuerpo;
    } else r[campo] = limpio;
  };

  texto("origen", transporte, transporte);
  texto("destino", transporte, transporte);
  texto("nombre", tipo === "hotel" || tipo === "entrada", !transporte);
  texto("direccion", false, tipo === "hotel");
  texto("localizador", false);
  texto("notas", false);

  for (const campo of ["zona_inicio", "zona_fin"] as const) {
    const valor = e[campo];
    if (vacio(valor) || !transporte) continue;
    const limpia = typeof valor === "string" ? limpiarTexto(valor) : "";
    if (limpia === "" || longitud(limpia) > LIMITES.zona || !zonaValida(limpia)) errores[campo] = E.zona;
    else r[campo] = limpia;
  }

  const fechaInicio = fechaValida(e.fecha_inicio);
  if (!fechaInicio) errores.fecha_inicio = E.fecha;
  else r.fecha_inicio = fechaInicio;

  let fechaFin: string | null = null;
  if (!vacio(e.fecha_fin)) {
    fechaFin = fechaValida(e.fecha_fin);
    if (!fechaFin) errores.fecha_fin = E.fecha;
    else if (tipo === "entrada" && fechaFin !== fechaInicio) errores.fecha_fin = E.cuerpo;
    else r.fecha_fin = fechaFin;
  } else if (transporte || tipo === "hotel") errores.fecha_fin = E.falta.fecha_fin;

  const hora = (campo: "hora_inicio" | "hora_fin", obligatoria: boolean) => {
    if (vacio(e[campo])) {
      if (obligatoria) errores[campo] = E.falta[campo];
      return null;
    }
    const h = horaValida(e[campo]);
    if (!h) errores[campo] = E.hora;
    else r[campo] = h;
    return h;
  };
  const horaInicio = hora("hora_inicio", transporte || tipo === "entrada");
  const horaFin = tipo === "hotel" ? null : hora("hora_fin", transporte);

  // Orden cronológico: la llegada no puede ser anterior a la salida, ni la
  // salida del hotel a la entrada.
  if (fechaInicio && fechaFin && !errores.fecha_fin) {
    if (fechaFin < fechaInicio) errores.fecha_fin = tipo === "hotel" ? E.salidaHotelAntesDeEntrada : E.llegadaAntesDeSalida;
    else if (transporte && fechaFin === fechaInicio && horaInicio && horaFin && horaFin <= horaInicio) errores.hora_fin = E.llegadaAntesDeSalida;
  }
  if (tipo === "entrada" && horaInicio && horaFin && horaFin <= horaInicio) errores.hora_fin = E.horaFinAntesDeInicio;

  // La ubicación solo existe en el hotel; lat y lon van siempre juntas.
  const u = e.ubicacion;
  if (!vacio(u)) {
    const { lat, lon } = (typeof u === "object" && u !== null ? u : {}) as Record<string, unknown>;
    if (tipo !== "hotel" || typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      errores.ubicacion = E.ubicacion;
    } else r.ubicacion = { lat, lon };
  }

  // Rango del viaje: ±1 día para transportes (el vuelo puede salir la víspera).
  if (contexto.viaje) {
    const margen = transporte ? 1 : 0;
    const desde = sumarDias(contexto.viaje.desde, -margen);
    const hasta = sumarDias(contexto.viaje.hasta, margen);
    for (const campo of ["fecha_inicio", "fecha_fin"] as const) {
      const f = r[campo];
      if (typeof f === "string" && !errores[campo] && (f < desde || f > hasta)) errores[campo] = E.fueraDelViaje;
    }
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, reserva: r as unknown as ReservaEntrada };
}

// Una zona IANA que Intl no conozca lanza RangeError.
function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat("es", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}
