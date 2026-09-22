import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// maq-ac2(a): lee los valores literales REALES de globals.css -nunca una
// constante duplicada en este fichero, que sería exactamente la lectura
// circular que la verificación del diseño prohíbe- y calcula el ratio de
// contraste con la fórmula WCAG 2.1 sobre luminancia relativa, contra el
// umbral externo 4.5:1 (texto normal).
const RUTA_CSS = join(import.meta.dirname, "..", "..", "..", "app", "globals.css");

const FRANJAS = ["manana-temprano", "manana", "comida", "tarde", "cena", "noche"];

function extraerBloque(css: string, inicioMarca: RegExp): string {
  const inicio = css.search(inicioMarca);
  if (inicio === -1) throw new Error(`No se encontró el bloque que empieza por ${inicioMarca}`);
  // Cuenta llaves para capturar el bloque {: ...} completo desde la marca.
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

describe("contraste de los tokens de franja (maq-ac2)", () => {
  const css = readFileSync(RUTA_CSS, "utf8");
  const bloqueClaro = extraerBloque(css, /:root\s*\{/);
  const bloqueOscuro = extraerBloque(css, /prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{/);

  for (const franja of FRANJAS) {
    it(`${franja}: fondo/texto en modo claro cumple 4.5:1`, () => {
      const fondo = leerToken(bloqueClaro, `franja-${franja}-fondo`);
      const texto = leerToken(bloqueClaro, `franja-${franja}-texto`);
      expect(ratioDeContraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${franja}: fondo/texto en modo oscuro cumple 4.5:1`, () => {
      const fondo = leerToken(bloqueOscuro, `franja-${franja}-fondo`);
      const texto = leerToken(bloqueOscuro, `franja-${franja}-texto`);
      expect(ratioDeContraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
