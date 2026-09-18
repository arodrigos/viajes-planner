import type { OpcionesInvocacion } from "./invocacion";

export interface ResultadoInvocacion {
  texto: string;
}

// Punto de inyección de dependencia: trabajador-ac2 (validación/reintento)
// y trabajador-ac4 (cerrojo, cola vacía) se prueban con un doble que
// implementa esto mismo, tal como el propio diseño pide ("con la
// invocación del modelo sustituida por un doble"). trabajador-ac1 (una
// generación real de punta a punta) queda fuera de CI a propósito: el
// diseño la marca "ejecutable bajo demanda en VPS1", y este agente no
// tiene ni el binario `claude` ni permiso para tocar la flota viva de
// VPS1 (regla de la propia etapa de desarrollo).
export interface EjecutorModelo {
  invocar(prompt: string, opciones: OpcionesInvocacion): Promise<ResultadoInvocacion>;
}
