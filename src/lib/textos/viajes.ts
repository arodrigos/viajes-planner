import { t } from "./tipos";

export const TEXTOS_VIAJES = {
  titulo: t("titulo", "Mis viajes"),
  cargando: t("estado", "Cargando tus viajes…"),
  proximos: t("titulo", "Próximos"),
  pasados: t("titulo", "Pasados"),
  sinProximos: t("vacio", "No tienes viajes próximos. Cuéntanos el siguiente y te preparamos el plan."),
  sinPasados: t("vacio", "Aquí aparecerán los viajes que ya hayas hecho."),
  errorCarga: t("error", "No se ha podido cargar tu lista de viajes. Vuelve a intentarlo en un momento."),
  reintentar: t("boton", "Reintentar"),
  errorEliminar: t("error", "No se ha podido eliminar el viaje. Vuelve a intentarlo en un momento."),
  cerrarSesion: t("boton", "Cerrar sesión"),
  cerrandoSesion: t("estado", "Cerrando…"),
  pedirOtro: t("boton", "Pedir otro viaje"),
  empezar: t("boton", "Cuéntanos tu viaje"),
  sinViajes: t("vacio", "Todavía no has pedido ningún viaje."),
  verItinerario: t("enlace", "Ver el itinerario"),
  verProgreso: t("enlace", "Ver el progreso"),
  eliminar: t("boton", "Eliminar"),
  cancelar: t("boton", "Cancelar"),
  eliminarDeVerdad: t("boton", "Eliminar de verdad"),
  eliminando: t("estado", "Eliminando…"),
} as const;
