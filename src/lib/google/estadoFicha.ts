import { TEXTOS_FICHA } from "@/lib/textos/ficha";
import type { EstadoGoogleParada } from "./estados";

export type ClaveMensajeFicha = "sinClave" | "sinUbicacion" | "pendiente" | "sinCoincidencia" | "cupoAgotado" | "errorGoogle";

export const TEXTO_MENSAJE_FICHA: Record<ClaveMensajeFicha, string> = {
  sinClave: TEXTOS_FICHA.sinClave.texto,
  sinUbicacion: TEXTOS_FICHA.sinUbicacion.texto,
  pendiente: TEXTOS_FICHA.pendiente.texto,
  sinCoincidencia: TEXTOS_FICHA.sinCoincidencia.texto,
  cupoAgotado: TEXTOS_FICHA.cupoAgotado.texto,
  errorGoogle: TEXTOS_FICHA.errorGoogle.texto,
};

// Qué mensaje corresponde ANTES de pedir nada: null significa que la parada
// está casada y se puede intentar la carga. Sin clave de navegador nunca se
// pide nada, pero «sinClave» solo es verdad para la parada casada: a las demás
// la clave no les cambia nada (no tendrán ficha aunque exista), y decirles que
// «aún no está disponible» prometería una ficha que no va a llegar.
export function mensajeSinPeticion(tieneClave: boolean, estado: EstadoGoogleParada | undefined): ClaveMensajeFicha | null {
  switch (estado) {
    case "casado":
      return tieneClave ? null : "sinClave";
    case "sin-ubicacion":
      return "sinUbicacion";
    case "sin-coincidencia":
      return "sinCoincidencia";
    // Un plan sin estado (lectura fallida o versión antigua) se trata como
    // pendiente: nunca afirma que no existe.
    default:
      return "pendiente";
  }
}

// Respuesta de /api/google/ficha traducida a lo que el panel hace.
export type ResultadoFicha = { tipo: "ficha"; placeId: string } | { tipo: "mensaje"; mensaje: ClaveMensajeFicha };

export function interpretarRespuesta(status: number, cuerpo: unknown): ResultadoFicha {
  if (status === 200) {
    const placeId = (cuerpo as { placeId?: unknown } | null)?.placeId;
    if (typeof placeId === "string" && placeId.length > 0) return { tipo: "ficha", placeId };
    return { tipo: "mensaje", mensaje: "errorGoogle" };
  }
  if (status === 429) return { tipo: "mensaje", mensaje: "cupoAgotado" };
  if (status === 404 && (cuerpo as { motivo?: unknown } | null)?.motivo === "sin-ficha") return { tipo: "mensaje", mensaje: "sinCoincidencia" };
  return { tipo: "mensaje", mensaje: "errorGoogle" };
}
