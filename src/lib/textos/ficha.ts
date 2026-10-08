import { t } from "./tipos";

export const TEXTOS_FICHA = {
  panel: t("titulo", "Opiniones y horario · Google Maps"),
  privacidad: t("ayuda", "Al abrirlo, tu navegador pide estos datos a Google."),
  privacidadEnlace: t("enlace", "Qué datos salen"),
  cargando: t("estado", "Buscando la ficha en Google Maps…"),
  sinClave: t("vacio", "Las fichas de Google aún no están disponibles; mientras tanto, ábrelo en Google Maps."),
  sinUbicacion: t("vacio", "Este sitio no tiene la ubicación comprobada; sin ella no buscamos opiniones, para no confundirlo con otro."),
  pendiente: t("vacio", "Todavía lo estamos buscando en Google Maps; vuelve a mirar en unas horas."),
  sinCoincidencia: t("vacio", "No lo hemos encontrado en Google Maps con seguridad, así que no enseñamos opiniones de otro sitio."),
  cupoAgotado: t("vacio", "Hoy ya se ha consultado Google todas las veces previstas para no pagar; vuelve mañana."),
  errorGoogle: t("error", "No se ha podido cargar la ficha de Google. Vuelve a intentarlo o ábrelo en Google Maps."),
  reintentar: t("boton", "Reintentar"),
  abrirEnMaps: t("enlace", "Abrir en Google Maps"),
} as const;
