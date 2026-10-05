// Constantes de los viajes de varias ciudades. Todas son estimaciones
// deliberadamente redondas y sin fuente de datos detrás: los traslados se
// marcan siempre `procedencia: "estimado"` y la interfaz nunca los presenta
// como un horario o una tarifa real.

// La línea recta subestima cualquier trayecto real; el factor lo compensa a
// grosso modo (carreteras y vías serpentean más que el aire).
export const FACTOR_RUTA_TIERRA = 1.2;
export const FACTOR_RUTA_AVION = 1.1;

// Un traslado de más de 4 h por tierra (7 h en avión, con embarque) deja de
// ser «moverse a otra ciudad» y se come el día de llegada entero.
export const TOPE_TIERRA_MIN = 240;
export const TOPE_AVION_MIN = 420;

// Por debajo de esta distancia en línea recta un vuelo nunca compensa.
export const DISTANCIA_MIN_AVION_KM = 400;

export interface PerfilDeModo {
  velocidad_kmh: number;
  // Esperas, aparcar, facturar: tiempo que no depende de la distancia.
  fijo_min: number;
}

export const PERFIL_COCHE: PerfilDeModo = { velocidad_kmh: 95, fijo_min: 10 };
export const PERFIL_TREN: PerfilDeModo = { velocidad_kmh: 120, fijo_min: 20 };
export const PERFIL_AUTOBUS: PerfilDeModo = { velocidad_kmh: 90, fijo_min: 10 };
export const PERFIL_AVION: PerfilDeModo = { velocidad_kmh: 800, fijo_min: 150 };

// Coche: por vehículo (la gasolina no depende de cuántos vayan dentro).
export const PLAZAS_COCHE = 5;
export const COSTE_COCHE_EUR_KM = 0.12;
// Tren, autobús y avión: por persona.
export const COSTE_TREN_EUR_KM = 0.1;
export const COSTE_AUTOBUS_EUR_KM = 0.06;
export const COSTE_AVION_FIJO_EUR = 50;
export const COSTE_AVION_EUR_KM = 0.06;

// Suelo de alojamiento por persona y noche: por debajo de esto el plan no
// puede cumplirse ni durmiendo en el sitio más barato, así que sirve de cota
// inferior segura para descartar sin llamar al modelo.
export const PISO_ALOJAMIENTO_EUR = 20;
