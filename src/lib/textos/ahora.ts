import { t } from "./tipos";

export const TEXTOS_AHORA = {
  titulo: t("titulo", "Ahora"),
  siguiente: t("ayuda", "Siguiente parada"),
  marcar: t("boton", "Marcar como visitada"),
  comoLlegar: t("enlace", "Cómo llegar"),
  todoVisitado: t("vacio", "Has visitado todas las paradas de hoy."),
  verRecomendados: t("boton", "Ver más sitios recomendados"),
  sinUbicacion: t("vacio", "Ninguna parada de hoy tiene ubicación comprobada, así que no podemos calcular cómo llegar."),
  salida: t("ayuda", "Sal antes de las {salida} para llegar a las {inicio} ({tramo})."),
  salidaYa: t("ayuda", "Si sales ya, llegas a las {llegada} ({tramo})."),
  salidaYaTarde: t("ayuda", "Si sales ya, llegas a las {llegada} ({retraso} min tarde)."),
  medioAPie: t("ayuda", "≈ {minutos} a pie"),
  medioTransporte: t("ayuda", "≈ {minutos} en transporte"),
  medioCoche: t("ayuda", "≈ {minutos} en coche"),
  marcando: t("estado", "Marcando…"),
} as const;
