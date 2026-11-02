import { entornoRestringido, type Entorno } from "./entorno";

// Mitigación #1 del modelo de amenazas del trabajador: el prompt lleva texto
// del usuario y de terceros, y la respuesta va entera en `result`, así que el
// modelo no necesita ninguna herramienta. Sin herramientas, sin MCP, sin
// ajustes, hooks, plugins ni CLAUDE.md de la cuenta que ejecuta el trabajador:
// nada de lo que diga el prompt puede leer ni escribir fuera de la respuesta.
export const ARGUMENTOS_AISLAMIENTO = [
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--safe-mode",
  "--disable-slash-commands",
  "--no-session-persistence",
] as const;

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
// lleva ninguna herramienta, ningún --add-dir hacia fuera del
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
      ...ARGUMENTOS_AISLAMIENTO,
    ],
    entorno: entornoRestringido(process.env),
    cwd: opciones.directorio,
  };
}
