import { t } from "./tipos";

export const TEXTOS_AHORA = {
  titulo: t("titulo", "Ahora"),
  siguiente: t("ayuda", "Siguiente parada"),
  marcar: t("boton", "Marcar como visitada"),
  comoLlegar: t("enlace", "Cómo llegar"),
  todoVisitado: t("vacio", "Has visitado todas las paradas de hoy."),
  verRecomendados: t("boton", "Ver más sitios recomendados"),
  sinUbicacion: t("vacio", "Ninguna parada de hoy tiene ubicación comprobada, así que no podemos calcular cómo llegar."),
  marcando: t("estado", "Marcando…"),
} as const;
