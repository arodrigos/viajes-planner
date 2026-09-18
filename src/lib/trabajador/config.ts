// Familia Sonnet por defecto (cuota-suscripcion explica por qué: no gastar
// la asignación de Opus, que es la que consume el pipeline horizontal).
// Herramientas recortadas a lectura/escritura, nunca ejecución: es la
// mitigación #1 del modelo de amenazas de trabajador-vps1.
export const MODELO_GENERACION = process.env.TRABAJADOR_MODELO ?? "claude-sonnet-5";
export const HERRAMIENTAS_PERMITIDAS = ["Read", "Write"] as const;

export const CERROJO_TTL_MIN = Number(process.env.TRABAJADOR_CERROJO_TTL_MIN ?? 10);
// trabajador-ac4: reserva de flota. Con la ventana semanal por encima de
// este porcentaje, el trabajador no arranca trabajos nuevos aunque la cola
// no esté vacía — deja margen para el resto del pipeline horizontal, que
// comparte la misma suscripción.
export const UMBRAL_CUOTA_SEMANAL = Number(process.env.TRABAJADOR_UMBRAL_CUOTA ?? 80);
// Tiempo que el trabajador se queda despierto tras vaciar la cola antes de
// morir (arquitectura: "se queda un rato antes de morir" para que la guía
// responda en caliente). En tests se sobreescribe a un valor minúsculo.
export const ESPERA_OCIOSA_MS = Number(process.env.TRABAJADOR_ESPERA_OCIOSA_MS ?? 120_000);
export const INTERVALO_REINTENTO_OCIOSO_MS = Number(process.env.TRABAJADOR_INTERVALO_OCIOSO_MS ?? 3_000);
