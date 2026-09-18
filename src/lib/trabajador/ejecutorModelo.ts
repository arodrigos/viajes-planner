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

// trabajador-ac4 (b): señal de límite de uso alcanzado a media invocación.
// resetsAt es obligatoria (a diferencia de EstadoCuota.resetsAt, donde
// "no sé" es una respuesta legítima): sin una hora de reinicio no hay con
// qué fijar reintento_no_antes_de, así que un ejecutor que la lance sin
// ella incumple el contrato de este error, no el de invocar().
export class LimiteDeUsoAlcanzado extends Error {
  constructor(
    public readonly resetsAt: string,
    public readonly usedPercentage: number = 100,
  ) {
    super("límite de uso del modelo alcanzado");
    this.name = "LimiteDeUsoAlcanzado";
  }
}
