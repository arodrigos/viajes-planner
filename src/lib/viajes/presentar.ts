import { TEXTOS_VIAJES as T } from "@/lib/textos/viajes";

const PATRON_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_ISO_SUELTO = /\d{4}-\d{2}-\d{2}/g;
const MS_DIA = 86_400_000;
// «sept» y no «sep»: es la abreviatura que la RAE da para septiembre.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

type Fecha = string | null | undefined;

interface ConInicio {
  fecha_inicio?: Fecha;
}
interface ConFin extends ConInicio {
  fecha_fin?: Fecha;
}

// Se valida con una ida y vuelta por UTC en vez de Date.parse: «2026-02-31»
// no es una fecha y Date.parse la aceptaría corriéndola a marzo.
function aDiaUTC(iso: Fecha): number | null {
  if (!iso || !PATRON_ISO.test(iso)) return null;
  const [a, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(a, m - 1, d);
  const f = new Date(t);
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? t : null;
}

export function esFechaISO(valor: Fecha): valor is string {
  return aDiaUTC(valor) !== null;
}

// Ordenar es estable y los viajes sin fecha ISO van detrás, sin perderse.
function ordenarPor<T>(lista: T[], clave: (v: T) => number | null, sentido: 1 | -1): T[] {
  const con: Array<{ v: T; k: number }> = [];
  const sin: T[] = [];
  for (const v of lista) {
    const k = clave(v);
    if (k === null) sin.push(v);
    else con.push({ v, k });
  }
  con.sort((a, b) => sentido * (a.k - b.k));
  return [...con.map((x) => x.v), ...sin];
}

export function ordenarProximos<V extends ConInicio>(viajes: V[]): V[] {
  return ordenarPor(viajes, (v) => aDiaUTC(v.fecha_inicio), 1);
}

export function ordenarPasados<V extends ConFin>(viajes: V[]): V[] {
  return ordenarPor(viajes, (v) => aDiaUTC(v.fecha_fin) ?? aDiaUTC(v.fecha_inicio), -1);
}

// El texto libre (una época como «otoño») se devuelve tal cual, pero nunca con
// una fecha ISO dentro: se repite hasta que no quede ninguna porque quitar una
// puede juntar los restos de otra.
function sinISO(texto: string): string {
  let actual = texto;
  for (;;) {
    const siguiente = actual.replace(PATRON_ISO_SUELTO, "");
    if (siguiente === actual) return actual;
    actual = siguiente;
  }
}

function partes(t: number) {
  const f = new Date(t);
  return { dia: f.getUTCDate(), mes: MESES[f.getUTCMonth()], anio: f.getUTCFullYear() };
}

// Desviación declarada de Intl.DateTimeFormat.formatRange (diseño del pulido):
// 1) Motivo: el texto tiene que ser idéntico en servidor y navegador aunque sus
//    datos ICU difieran (evita avisos de hidratación), y formatRange escribe
//    «sep» donde la RAE da «sept».
// 2) Lo fija la tabla de salidas de src/lib/viajes/__tests__/presentar.test.ts.
// 3) Se vuelve a formatRange si ambos entornos comparten ICU y da «sept».
export function formatearRangoViaje(inicio: string, fin: string | null): string {
  const ti = aDiaUTC(inicio);
  if (ti === null) return sinISO(inicio);
  const i = partes(ti);
  const tf = aDiaUTC(fin);
  if (tf === null || tf === ti) return `${i.dia} ${i.mes} ${i.anio}`;
  const f = partes(tf);
  if (i.anio === f.anio && i.mes === f.mes) return `${i.dia}–${f.dia} ${f.mes} ${f.anio}`;
  if (i.anio === f.anio) return `${i.dia} ${i.mes} – ${f.dia} ${f.mes} ${f.anio}`;
  return `${i.dia} ${i.mes} ${i.anio} – ${f.dia} ${f.mes} ${f.anio}`;
}

export type SituacionViaje =
  | { tipo: "en-curso"; dia: number; total: number }
  | { tipo: "proximo"; dias: number }
  | { tipo: "pasado" }
  | { tipo: "sin-fechas" };

export function situacionViaje(inicio: Fecha, fin: Fecha, hoy: string): SituacionViaje {
  const ti = aDiaUTC(inicio);
  const th = aDiaUTC(hoy);
  if (ti === null || th === null) return { tipo: "sin-fechas" };
  if (th < ti) return { tipo: "proximo", dias: Math.round((ti - th) / MS_DIA) };
  const tf = aDiaUTC(fin);
  // Sin fin conocido no se afirma que el viaje esté en curso ni que acabara.
  if (tf === null || tf < ti) return { tipo: "sin-fechas" };
  if (th > tf) return { tipo: "pasado" };
  return { tipo: "en-curso", dia: Math.round((th - ti) / MS_DIA) + 1, total: Math.round((tf - ti) / MS_DIA) + 1 };
}

export function textoCuentaAtras(dias: number): string {
  return dias === 1 ? T.empiezaManana.texto : `${T.empiezaDentroDe.texto} ${dias} días`;
}

// Texto de la situación, o null cuando no hay nada fiable que decir (pasados,
// épocas): mejor callar que inventar una cuenta atrás.
export function textoSituacion(s: SituacionViaje): string | null {
  if (s.tipo === "en-curso") return `${T.enCursoDia.texto} ${s.dia} de ${s.total}`;
  if (s.tipo === "proximo") return textoCuentaAtras(s.dias);
  return null;
}

export function etiquetaEstado(estado: string): string {
  switch (estado) {
    case "completado":
      return T.estadoListo.texto;
    case "encolado":
    case "en-curso":
      return T.estadoPreparando.texto;
    case "pausado":
      return T.estadoPausado.texto;
    case "fallido":
      return T.estadoFallido.texto;
    case "caducado":
      return T.estadoCaducado.texto;
    default:
      return T.estadoDesconocido.texto;
  }
}
