// Lista blanca, no lista negra: el trabajador ejecuta un agente con
// herramientas alimentado con texto de terceros (modelo_amenazas,
// trabajador-vps1). El entorno que recibe esa invocación lleva solo lo
// imprescindible para que el binario arranque y encuentre la sesión de
// Adrián (HOME); ninguna clave de Supabase, openrouteservice ni MapTiler
// pasa nunca por aquí, sean cuales sean sus nombres futuros.
const VARIABLES_PERMITIDAS = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "USER", "SHELL"] as const;

export type Entorno = Record<string, string | undefined>;

export function entornoRestringido(base: Entorno): Entorno {
  const restringido: Entorno = {};
  for (const clave of VARIABLES_PERMITIDAS) {
    const valor = base[clave];
    if (valor !== undefined) restringido[clave] = valor;
  }
  return restringido;
}
