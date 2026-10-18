// Lee una variable del bloque `env:` de nivel superior de un workflow. No usa
// un parser YAML completo: el bloque es plano (`  NOMBRE: "valor"`) y así el
// test no añade dependencias.
export function leerEnvSuperior(yaml: string, nombre: string): string | undefined {
  const lineas = yaml.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === "env:");
  if (inicio === -1) return undefined;
  for (const linea of lineas.slice(inicio + 1)) {
    // El bloque acaba en la primera línea no vacía sin sangría.
    if (linea !== "" && !linea.startsWith(" ")) return undefined;
    const m = /^ {2}([A-Z0-9_]+):\s*(.*)$/.exec(linea);
    if (!m || m[1] !== nombre) continue;
    const crudo = m[2].trim();
    const comillas = /^"((?:[^"\\]|\\.)*)"$/.exec(crudo);
    return comillas ? comillas[1] : crudo;
  }
  return undefined;
}

// Idénticos carácter a carácter: no se recortan espacios ni se reordenan correos
// porque cualquier diferencia es justo la divergencia que se quiere detectar.
export function sonIguales(a: string, b: string): boolean {
  return a === b;
}
