import "server-only";
import { spawn } from "node:child_process";
import { construirInvocacion, type OpcionesInvocacion } from "./invocacion";
import type { EjecutorModelo, ResultadoInvocacion } from "./ejecutorModelo";

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
