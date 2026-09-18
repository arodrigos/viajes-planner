import "server-only";
import { spawn } from "node:child_process";
import { construirInvocacion, type OpcionesInvocacion } from "./invocacion";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "./ejecutorModelo";

// trabajador-ac4 (b), incertidumbre declarada (ver entregable,
// desviaciones): la documentación de Claude Code confirma el tipo
// SessionRateLimit (kind, percentUsed, resetsAt) para sesiones
// interactivas, pero no un formato estable para esta señal en modo no
// interactivo ('-p --output-format json'). Sin esa confirmación, reconoce
// el límite por el texto del mensaje Y por una hora de reinicio ISO-8601
// explícita en él; si falta cualquiera de las dos, no arriesga a inventar
// una hora de reinicio y cae al camino de error genérico de abajo — el
// trabajo queda 'fallido' con motivo, no perdido en silencio.
const PATRON_LIMITE_DE_USO = /usage limit|rate limit|límite de uso/i;
const PATRON_HORA_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

function limiteDeUsoDesde(texto: string): LimiteDeUsoAlcanzado | null {
  if (!PATRON_LIMITE_DE_USO.test(texto)) return null;
  const horaReinicio = texto.match(PATRON_HORA_ISO)?.[0];
  // trabajador-ac5: null explícito, no un porcentaje inventado — este
  // camino (parseo de la salida de `claude -p`) nunca ha tenido de dónde
  // sacar el consumido real.
  return horaReinicio ? new LimiteDeUsoAlcanzado(horaReinicio, null) : null;
}

// Implementación real, para VPS1: ejecuta `claude -p` en modo no
// interactivo bajo la sesión de Adrián (Claude Code — Non-interactive
// mode, verificado por Diseño). '--output-format json' devuelve un único
// objeto con el campo 'result' cuando la ejecución termina con éxito.
export const ejecutorClaudeCode: EjecutorModelo = {
  invocar(prompt, opciones: OpcionesInvocacion): Promise<ResultadoInvocacion> {
    const invocacion = construirInvocacion(prompt, opciones);

    return new Promise((resolve, reject) => {
      const proceso = spawn(invocacion.comando, invocacion.argumentos, {
        cwd: invocacion.cwd,
        // El entorno restringido es deliberadamente más estrecho que
        // NodeJS.ProcessEnv (nada de NODE_ENV ni demás ruido); en runtime
        // es un objeto de strings válido para spawn.
        env: invocacion.entorno as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let salida = "";
      let salidaError = "";
      proceso.stdout?.on("data", (fragmento: Buffer) => (salida += fragmento));
      proceso.stderr?.on("data", (fragmento: Buffer) => (salidaError += fragmento));

      proceso.on("error", reject);
      proceso.on("close", (codigo) => {
        const limite = limiteDeUsoDesde(`${salida}\n${salidaError}`);
        if (limite) {
          reject(limite);
          return;
        }
        if (codigo !== 0) {
          reject(new Error(`claude terminó con código ${codigo}: ${salidaError || salida}`));
          return;
        }
        try {
          const objeto = JSON.parse(salida) as { result?: string };
          if (typeof objeto.result !== "string") {
            reject(new Error("La respuesta de claude no trae el campo 'result'"));
            return;
          }
          resolve({ texto: objeto.result });
        } catch {
          reject(new Error("La salida de claude no es JSON válido"));
        }
      });
    });
  },
};
