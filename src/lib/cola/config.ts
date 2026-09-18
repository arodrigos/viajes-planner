// Único parámetro numérico de acceso que no depende de la suscripción del
// modelo (esa vive en cuota-suscripcion): cuántos trabajos por hora puede
// encolar un usuario, cuánto dura el arrendamiento de un trabajador sobre
// un trabajo, y cuándo un trabajo que nadie recoge se da por caducado.
export const LIMITE_TRABAJOS_POR_HORA = Number(process.env.TRABAJOS_LIMITE_POR_HORA ?? 5);
export const ARRENDAMIENTO_MIN = Number(process.env.TRABAJOS_ARRENDAMIENTO_MIN ?? 10);
export const CADUCIDAD_HORAS = Number(process.env.TRABAJOS_CADUCIDAD_HORAS ?? 6);
