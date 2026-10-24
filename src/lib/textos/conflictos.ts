import { t } from "./tipos";

// Los conflictos afirman solo lo que el horario de OpenStreetMap dice; la
// fuente y su fecha van aparte, en la línea de procedencia de la tarjeta.
export const TEXTOS_CONFLICTOS = {
  cerradoElDia: t("estado", "Cerrado el {dia}"),
  cerradoEnFranja: t("estado", "No abre en {franja}: abre de {abre} a {cierra}"),
  cerradoEnFranjaSinHueco: t("estado", "Cerrado en {franja}"),
  cerradoAEsaHora: t("estado", "Cierra a las {cierra} y llegas a las {llegada}"),
  cerradoAlLlegar: t("estado", "Está cerrado cuando llegas, a las {llegada}"),
  horarioSinConfirmar: t("estado", "Horario sin confirmar"),
  fuente: t("ayuda", "Horario de OpenStreetMap, comprobado en {anio}"),
  fuenteSinFecha: t("ayuda", "Horario de OpenStreetMap, sin fecha de comprobación"),
  contadorUno: t("estado", "1 conflicto"),
  contadorVarios: t("estado", "{n} conflictos"),
  chocaConEntrada: t("estado", "Choca con tu entrada de las {hora}"),
  antesDeLlegada: t("estado", "Antes de tu llegada a las {hora}"),
  despuesDeSalida: t("estado", "Después de tu salida a las {hora}"),
  ordenDejariaCerrado: t("ayuda", "El orden más corto dejaría {parada} cerrado; dejamos el orden como está"),
} as const;
