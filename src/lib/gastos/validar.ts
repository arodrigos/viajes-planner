import { ERRORES_GASTO as E } from "@/lib/textos/gastos";
import { limpiarTexto, longitud } from "@/lib/reservas/validar";
import { CATEGORIAS_GASTO, IMPORTE_MAX_CENTIMOS, LONGITUD_CONCEPTO, type CategoriaGasto, type GastoEntrada } from "./tipos";

// Mismas reglas en el formulario, en la ruta y en los CHECK de la migración 038.
export type ErroresGasto = Partial<Record<keyof GastoEntrada | "general", string>>;
export type ResultadoGasto = { ok: true; gasto: GastoEntrada } | { ok: false; errores: ErroresGasto };

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (valor: string) => UUID.test(valor);

function fechaValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = FECHA.exec(valor);
  if (!m) return null;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return f.getUTCFullYear() === +m[1] && f.getUTCMonth() === +m[2] - 1 && f.getUTCDate() === +m[3] ? valor : null;
}

// «25,5», «25.50», «25,50 €» y «1.234,56» valen. Devuelve céntimos enteros o
// null si no es un importe: nunca se pasa por coma flotante.
const ENTERO = /^\d+$/;
const CON_MILES = /^\d{1,3}([.,]\d{3})+$/;

export function importeACentimos(texto: string): number | null {
  const t = texto.replace(/€/g, "").replace(/\s/g, "");
  if (ENTERO.test(t)) return Number(t) * 100;
  // «1.234» es mil doscientos treinta y cuatro: tres cifras tras el separador son de miles.
  if (CON_MILES.test(t)) return Number(t.replace(/[.,]/g, "")) * 100;
  const sep = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (sep < 0) return null;
  const entero = t.slice(0, sep);
  const decimales = t.slice(sep + 1);
  if (!ENTERO.test(decimales) || decimales.length > 2) return null;
  if (!ENTERO.test(entero) && !CON_MILES.test(entero)) return null;
  // El separador de miles y el decimal no pueden ser el mismo carácter («12,345,6»).
  if (entero.includes(t[sep])) return null;
  const centimos = Number(entero.replace(/[.,]/g, "")) * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centimos) ? centimos : null;
}

export function validarGasto(entrada: unknown): ResultadoGasto {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) return { ok: false, errores: { general: E.cuerpo } };
  const e = entrada as Record<string, unknown>;
  const errores: ErroresGasto = {};

  const importe = e.importe_centimos;
  if (typeof importe !== "number" || !Number.isInteger(importe) || importe < 1 || importe > IMPORTE_MAX_CENTIMOS) errores.importe_centimos = E.importe;

  const categoria = CATEGORIAS_GASTO.includes(e.categoria as CategoriaGasto) ? (e.categoria as CategoriaGasto) : null;
  if (!categoria) errores.categoria = E.categoria;

  const sinFecha = e.fecha === undefined || e.fecha === null || e.fecha === "";
  const fecha = sinFecha ? null : fechaValida(e.fecha);
  if (!sinFecha && fecha === null) errores.fecha = E.fecha;
  else if (categoria === "alojamiento" && fecha !== null) errores.fecha = E.alojamientoSinDia;
  else if ((categoria === "comida" || categoria === "entradas") && fecha === null) errores.fecha = E.elegirDia;

  let concepto: string | undefined;
  if (e.concepto !== undefined && e.concepto !== null) {
    if (typeof e.concepto !== "string") errores.concepto = E.concepto;
    else {
      const limpio = limpiarTexto(e.concepto);
      if (longitud(limpio) > LONGITUD_CONCEPTO) errores.concepto = E.conceptoLargo;
      else if (limpio !== "") concepto = limpio;
    }
  }

  const actualizado = typeof e.actualizado_cliente === "string" && !Number.isNaN(Date.parse(e.actualizado_cliente)) ? new Date(e.actualizado_cliente).toISOString() : null;
  if (!actualizado) errores.actualizado_cliente = E.cuerpo;

  if (Object.keys(errores).length > 0 || !categoria || !actualizado) return { ok: false, errores };
  return { ok: true, gasto: { importe_centimos: importe as number, fecha, categoria, ...(concepto ? { concepto } : {}), actualizado_cliente: actualizado } };
}
