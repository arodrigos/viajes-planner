import Ajv, { type ErrorObject } from "ajv";
import { esquemaPlan } from "./esquema";
import type { Plan } from "./tipos";

export interface ErrorValidacion {
  ruta: string;
  mensaje: string;
}

export interface ResultadoValidacion {
  valido: boolean;
  errores: ErrorValidacion[];
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validarEstructura = ajv.compile(esquemaPlan);

function errorEstructuralAErrorValidacion(e: ErrorObject): ErrorValidacion {
  const ruta = e.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(raíz)";
  return { ruta, mensaje: e.message ?? "valor inválido" };
}

// La validación estructural (ajv) no puede comprobar relaciones entre
// elementos de un mismo array -franja_id que exista de verdad entre las
// franjas del día, hora_fin posterior a hora_inicio-, así que van aparte.
function validarRelaciones(plan: Plan): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];

  plan.dias.forEach((dia, iDia) => {
    dia.franjas.forEach((franja, iFranja) => {
      if (franja.hora_fin <= franja.hora_inicio) {
        errores.push({
          ruta: `dias.${iDia}.franjas.${iFranja}.hora_fin`,
          mensaje: "hora_fin debe ser posterior a hora_inicio",
        });
      }
    });

    const idsFranja = new Set(dia.franjas.map((f) => f.id));
    dia.paradas.forEach((parada, iParada) => {
      if (!idsFranja.has(parada.franja_id)) {
        errores.push({
          ruta: `dias.${iDia}.paradas.${iParada}.franja_id`,
          mensaje: `franja_id '${parada.franja_id}' no corresponde a ninguna franja de ese día`,
        });
      }
    });
  });

  return errores;
}

export function validarPlan(data: unknown): ResultadoValidacion {
  const estructuralOk = validarEstructura(data);
  const erroresEstructurales = (validarEstructura.errors ?? []).map(errorEstructuralAErrorValidacion);

  // Las relaciones solo tienen sentido sobre datos ya bien formados: si la
  // estructura falla, no merece la pena arriesgarse a leer campos que igual
  // ni siquiera existen.
  const erroresRelacion = estructuralOk ? validarRelaciones(data as Plan) : [];

  const errores = [...erroresEstructurales, ...erroresRelacion];
  return { valido: errores.length === 0, errores };
}
