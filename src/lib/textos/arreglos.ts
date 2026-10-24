import { t } from "./tipos";

export const TEXTOS_ARREGLOS = {
  arreglar: t("boton", "Arreglar"),
  tituloHoja: t("titulo", "Arreglar {parada}"),
  dejarla: t("boton", "Dejarla como está"),
  sinOpciones: t("vacio", "No hay otra franja ni otro día en que abra. Puedes dejarla o quitarla tú desde la tarjeta"),
  abre: t("ayuda", "abre de {abre} a {cierra}"),
  pasarA: t("boton", "Pasar a {franja}: {motivo}"),
  llevarAl: t("boton", "Llevar al {dia}: {motivo}"),
  llevarAlPor: t("boton", "Llevar al {dia} por {franja}: {motivo}"),
  cambiarPor: t("boton", "Cambiar por {nombre}: {motivo}"),
  movidaAl: t("estado", "Movida al {dia}"),
  movidaA: t("estado", "Movida a {franja}"),
  cambiada: t("estado", "Cambiada por {nombre}"),
  restaurada: t("estado", "Parada restaurada"),
  deshacer: t("boton", "Deshacer"),
  errorRed: t("error", "No se ha podido mover la parada. Comprueba la conexión y vuelve a intentarlo"),
  desfasada: t("error", "El plan ha cambiado desde que lo abriste. Recarga y vuelve a intentarlo."),
  demasiados: t("error", "Has cambiado el plan muchas veces en poco tiempo. Espera unos minutos y vuelve a intentarlo"),
} as const;
