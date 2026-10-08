import { TEXTOS_HORARIO } from "@/lib/textos/horario";

// dif-ac1: de dónde sale el horario de una parada y si merece que se compruebe
// en vivo. Función pura de sus entradas (nada de leer el reloj aquí) para que
// el servidor, el navegador y los tests den siempre el mismo texto.
const DIAS_MAXIMOS_SIN_COMPROBAR = 730;
const MS_POR_DIA = 86_400_000;

export interface EntradaProcedenciaHorario {
  // check_date:opening_hours de OSM, ISO parcial; ausente si nadie lo anotó.
  fechaComprobacion?: string;
  // Hay etiqueta opening_hours: sin ella no hay horario del que hablar.
  tieneHorario: boolean;
  // Día de hoy en el destino, YYYY-MM-DD.
  hoy: string;
  // La parada tiene place_id de Google: sin él no hay ficha que abrir.
  casada: boolean;
  // El horario de OSM dice que ese día a esa hora estará cerrado.
  posibleCierre: boolean;
}

export interface ProcedenciaHorario {
  rotulo: string | null;
  aviso: string | null;
  ofrecerGoogle: boolean;
}

function parsearFecha(texto: string | undefined): number | null {
  const m = texto ? /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(texto) : null;
  if (!m) return null;
  // Con la fecha incompleta se toma el principio del periodo: ante la duda,
  // el dato se considera más viejo y no más fresco.
  const tiempo = Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1));
  return Number.isNaN(tiempo) ? null : tiempo;
}

export function procedenciaHorario(entrada: EntradaProcedenciaHorario): ProcedenciaHorario {
  const comprobado = parsearFecha(entrada.fechaComprobacion);
  const hoy = parsearFecha(entrada.hoy);
  const antiguo = comprobado !== null && hoy !== null && (hoy - comprobado) / MS_POR_DIA > DIAS_MAXIMOS_SIN_COMPROBAR;
  const sinFecha = comprobado === null;
  const ofrecerGoogle = entrada.casada && (sinFecha || antiguo || entrada.posibleCierre);

  if (!entrada.tieneHorario) return { rotulo: null, aviso: null, ofrecerGoogle };

  const rotulo =
    comprobado === null
      ? TEXTOS_HORARIO.rotuloSinFecha.texto
      : TEXTOS_HORARIO.rotuloComprobado.texto.replace("{anio}", String(new Date(comprobado).getUTCFullYear()));
  // El cierre es lo más concreto para quien va ese día, así que manda sobre el aviso de antigüedad.
  const aviso = entrada.posibleCierre
    ? TEXTOS_HORARIO.avisoCierre.texto
    : sinFecha
      ? TEXTOS_HORARIO.avisoSinFecha.texto
      : antiguo
        ? TEXTOS_HORARIO.avisoAntiguo.texto
        : null;
  return { rotulo, aviso, ofrecerGoogle };
}
