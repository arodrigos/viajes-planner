// Lo justo para saber por qué falló sin volcar cuerpos de respuesta enteros
// en la fila de salud o en el log; las claves nunca viajan en el mensaje
// porque van en cabeceras, no en la URL.
export function mensajeAcotado(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}
