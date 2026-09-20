import { entornoRestringido, type Entorno } from "./entorno";
import { HERRAMIENTAS_PERMITIDAS } from "./config";

export interface OpcionesInvocacion {
  directorio: string;
  modelo: string;
}

export interface Invocacion {
  comando: string;
  argumentos: string[];
  entorno: Entorno;
  cwd: string;
}

// trabajador-ac3: función pura y separada del spawn de verdad para que se
// pueda comprobar, sin ejecutar nada, que la invocación construida no
// lleva ninguna herramienta de ejecución, ningún --add-dir hacia fuera del
// directorio de trabajo, y ningún secreto en el entorno. `directorio` es
// siempre el cwd del proceso, nunca un argumento aparte que alguien
// pudiera usar para apuntar a otro sitio.
export function construirInvocacion(prompt: string, opciones: OpcionesInvocacion): Invocacion {
  return {
    comando: "claude",
    argumentos: [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      opciones.modelo,
      "--allowedTools",
      HERRAMIENTAS_PERMITIDAS.join(","),
    ],
    entorno: entornoRestringido(process.env),
    cwd: opciones.directorio,
  };
}
