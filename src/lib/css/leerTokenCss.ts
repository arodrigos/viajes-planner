// Método no circular para leer literales REALES de src/app/globals.css,
// compartido por contraste-peligro.test.ts y peso-visual.movil.e2e.ts:
// nunca una constante duplicada en el test, siempre el valor que de verdad
// aplica el navegador.

export function extraerBloque(css: string, inicioMarca: RegExp): string {
  const inicio = css.search(inicioMarca);
  if (inicio === -1) throw new Error(`No se encontró el bloque que empieza por ${inicioMarca}`);
  let profundidad = 0;
  let fin = inicio;
  for (let i = inicio; i < css.length; i++) {
    if (css[i] === "{") profundidad++;
    if (css[i] === "}") {
      profundidad--;
      if (profundidad === 0) {
        fin = i;
        break;
      }
    }
  }
  return css.slice(inicio, fin + 1);
}

export function leerToken(bloqueCss: string, nombre: string): string {
  const patron = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`);
  const coincidencia = bloqueCss.match(patron);
  if (!coincidencia) throw new Error(`Token --${nombre} no encontrado en el bloque CSS leído`);
  return coincidencia[1];
}
