// preparativos-datos: errores de las rutas de marcas. Cada uno dice qué hacer.
export const ERRORES_PREPARATIVOS = {
  elemento: "Ese elemento no está en la lista de preparativos. Recarga la página e inténtalo de nuevo",
  estado: "El estado de la marca no es válido: tiene que ser pendiente, hecho o no_hace_falta",
  fecha: "La fecha de la marca no es válida. Recarga la página e inténtalo de nuevo",
  cuerpo: "No se ha entendido la marca. Recarga la página e inténtalo de nuevo",
  noJson: "La petición tiene que enviarse como JSON",
} as const;
