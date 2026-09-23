import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// tok-ac1/tok-ac2: lee los valores literales REALES de globals.css -nunca
// una constante duplicada en este fichero- y comprueba (a) que el par
// fondo/texto de peligro cumple 4.5:1 en cada modo con la fórmula WCAG 2.1
// sobre luminancia relativa, y (b) que el color de peligro es de verdad
// cromático y distinto de los tokens neutros que ya existen, para que no
// se convierta en un gris renombrado sin que nadie lo note.
const RUTA_CSS = join(import.meta.dirname, "..", "..", "..", "app", "globals.css");

const NEUTROS = ["foreground", "borde", "superficie", "background", "foco"];

function extraerBloque(css: string, inicioMarca: RegExp): string {
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

function leerToken(bloqueCss: string, nombre: string): string {
  const patron = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`);
  const coincidencia = bloqueCss.match(patron);
  if (!coincidencia) throw new Error(`Token --${nombre} no encontrado en el bloque CSS leído`);
  return coincidencia[1];
}

function srgbALineal(canal: number): number {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanciaRelativa(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbALineal(r) + 0.7152 * srgbALineal(g) + 0.0722 * srgbALineal(b);
}

function ratioDeContraste(hexA: string, hexB: string): number {
  const lA = luminanciaRelativa(hexA);
  const lB = luminanciaRelativa(hexB);
  const claro = Math.max(lA, lB);
  const oscuro = Math.min(lA, lB);
  return (claro + 0.05) / (oscuro + 0.05);
}

function canales(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function diferenciaCromatica(hex: string): number {
  const [r, g, b] = canales(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

describe("tokens de peligro (tok-ac1, tok-ac2)", () => {
  const css = readFileSync(RUTA_CSS, "utf8");
  const bloqueClaro = extraerBloque(css, /:root\s*\{/);
  const bloqueOscuro = extraerBloque(css, /prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{/);

  for (const [modo, bloque] of [
    ["claro", bloqueClaro],
    ["oscuro", bloqueOscuro],
  ] as const) {
    it(`${modo}: fondo/texto de peligro cumple 4.5:1 (tok-ac1)`, () => {
      const fondo = leerToken(bloque, "peligro-fondo");
      const texto = leerToken(bloque, "peligro-texto");
      expect(ratioDeContraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${modo}: el color de peligro es cromático, no un gris renombrado (tok-ac2)`, () => {
      const borde = leerToken(bloque, "peligro-borde");
      expect(diferenciaCromatica(borde)).toBeGreaterThanOrEqual(40);

      for (const neutro of NEUTROS) {
        const valorNeutro = leerToken(bloque, neutro);
        expect(borde.toLowerCase()).not.toBe(valorNeutro.toLowerCase());
      }
    });

    it(`${modo}: el fondo y el texto de peligro también son cromáticos y distintos de los neutros (tok-ac2)`, () => {
      const fondo = leerToken(bloque, "peligro-fondo");
      const texto = leerToken(bloque, "peligro-texto");
      expect(diferenciaCromatica(fondo)).toBeGreaterThanOrEqual(40);
      expect(diferenciaCromatica(texto)).toBeGreaterThanOrEqual(40);

      for (const neutro of NEUTROS) {
        const valorNeutro = leerToken(bloque, neutro).toLowerCase();
        expect(fondo.toLowerCase()).not.toBe(valorNeutro);
        expect(texto.toLowerCase()).not.toBe(valorNeutro);
      }
    });
  }
});
