import Ajv from "ajv";
import { esquemaCriterios } from "./esquema";
import type { CriteriosViaje } from "./tipos";

const ajv = new Ajv({ allErrors: true, strict: true });
const validarEstructura = ajv.compile(esquemaCriterios);

const MENSAJE_TRANSPORTE = "Medio de transporte no válido";

export interface ResultadoValidacionCriterios {
  valido: boolean;
  errores: string[];
}

export function validarCriterios(data: unknown): ResultadoValidacionCriterios {
  const valido = validarEstructura(data);
  // Todo fallo bajo /transporte (valor desconocido, repetido, no-array) se
  // dice igual y una sola vez: el mensaje técnico de Ajv no ayuda a quien
  // marca casillas, y allErrors devuelve uno por elemento.
  const errores = (validarEstructura.errors ?? []).map((e) =>
    e.instancePath.startsWith("/transporte") ? MENSAJE_TRANSPORTE : `${e.instancePath || "(raíz)"} ${e.message}`,
  );
  return { valido, errores: [...new Set(errores)] };
}

export function esCriteriosViaje(data: unknown): data is CriteriosViaje {
  return validarEstructura(data) as boolean;
}
