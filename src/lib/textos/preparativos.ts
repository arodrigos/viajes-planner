// preparativos-datos: errores de las rutas de marcas. Cada uno dice qué hacer.
export const ERRORES_PREPARATIVOS = {
  elemento: "Ese elemento no está en la lista de preparativos. Recarga la página e inténtalo de nuevo",
  estado: "El estado de la marca no es válido: tiene que ser pendiente, hecho o no_hace_falta",
  fecha: "La fecha de la marca no es válida. Recarga la página e inténtalo de nuevo",
  cuerpo: "No se ha entendido la marca. Recarga la página e inténtalo de nuevo",
  noJson: "La petición tiene que enviarse como JSON",
} as const;

// preparativos-lista: textos de la sección del dueño. Cada error dice qué hacer.
export const TEXTOS_PREPARATIVOS = {
  titulo: "Preparativos y equipaje",
  progreso: (hechos: number, total: number) => `${hechos} de ${total} listos`,
  categorias: {
    documentos: "Documentos",
    ninos: "Niños",
    salud: "Salud",
    ropa: "Ropa",
    electronica: "Electrónica",
    "antes-de-salir": "Antes de salir",
  },
  porque: "Por qué:",
  fuente: (titulo: string, revisado: string) => `${titulo} (revisado el ${revisado})`,
  noMeHaceFalta: "No me hace falta",
  quitada: (texto: string) => `${texto} quitada de la lista`,
  deshacer: "Deshacer",
  quitadas: (n: number) => `No me hacen falta (${n})`,
  recuperar: "Recuperar",
  pendiente: "Pendiente de subir",
  sinSubir: (n: number) => (n === 1 ? "1 cambio pendiente de subir" : `${n} cambios pendientes de subir`),
  sinSesion: "Entra de nuevo para subir tus marcas",
  enlaceAcceso: "Iniciar sesión",
  descartar: "Descartar",
  rechazada: "No se ha podido guardar: vuelve a marcarlo",
  errorMarcas: "No se han podido cargar tus marcas. Puedes seguir marcando; se suben cuando haya conexión",
  reintentar: "Reintentar",
  sinRed: (cuando: string) => `Sin conexión: tus marcas de ${cuando}`,
  generando: "La lista aparece cuando el viaje esté listo",
  errorEncolar: "No se ha podido guardar la marca en este dispositivo. Inténtalo de nuevo",
  vacia: "Con los datos de este viaje no hay nada que preparar",
} as const;
