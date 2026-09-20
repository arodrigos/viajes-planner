import Ajv from "ajv";
import { esquemaCriterios } from "./esquema";
import type { CriteriosViaje } from "./tipos";

const ajv = new Ajv({ allErrors: true, strict: true });
const validarEstructura = ajv.compile(esquemaCriterios);

export interface ResultadoValidacionCriterios {
  valido: boolean;
  errores: string[];
}

export function validarCriterios(data: unknown): ResultadoValidacionCriterios {
  const valido = validarEstructura(data);
  return {
    valido,
    errores: (validarEstructura.errors ?? []).map((e) => `${e.instancePath || "(raíz)"} ${e.message}`),
  };
}

export function esCriteriosViaje(data: unknown): data is CriteriosViaje {
  return validarEstructura(data) as boolean;
}
