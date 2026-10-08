import { t } from "./tipos";

// Los avisos (clave «aviso…») nunca afirman: dicen «puede» y nombran la
// fuente, porque un horario de OpenStreetMap es lo que alguien anotó, no lo
// que hoy hay en la puerta.
export const TEXTOS_HORARIO = {
  rotuloComprobado: t("ayuda", "Horario según OpenStreetMap · comprobado en {anio}"),
  rotuloSinFecha: t("ayuda", "Horario según OpenStreetMap · sin fecha de comprobación"),
  avisoAntiguo: t("ayuda", "El horario de OpenStreetMap puede haber cambiado desde entonces."),
  avisoSinFecha: t("ayuda", "Según OpenStreetMap, puede estar desactualizado."),
  avisoCierre: t("ayuda", "Según OpenStreetMap, puede estar cerrado a esa hora."),
  comprobarEnGoogle: t("enlace", "Compruébalo en Google"),
} as const;
