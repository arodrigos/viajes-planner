// lam-ac4: las fuentes se leen UNA vez al cargar el módulo y la ruta, el
// generador de ejemplos y el medidor renderizan con el mismo objeto: lo que se
// mide es lo que se sirve. En Vercel los ficheros viajan gracias a
// outputFileTracingIncludes (next.config.ts); si faltaran, el módulo
// fallaría al cargar y la ruta daría 500 en vez de dibujar con otra fuente.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALTO_LAMINA, ANCHO_LAMINA } from "./Lamina";

type Peso = 400 | 700;

export interface FuenteLamina {
  name: string;
  data: ArrayBuffer;
  weight: Peso;
  style: "normal";
}

function leer(fichero: string): ArrayBuffer {
  const b = readFileSync(join(process.cwd(), "assets", "fuentes", fichero));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// latin primero: satori prueba las fuentes en orden por grafema y latin-ext
// solo cubre lo que a latin le falta (ő, ł, ș...).
const FUENTES: FuenteLamina[] = ([400, 700] as const).flatMap((weight) =>
  (["latin", "latin-ext"] as const).map((subconjunto) => ({
    name: "Inter",
    data: leer(`inter-${subconjunto}-${weight}-normal.woff`),
    weight,
    style: "normal" as const,
  })),
);

export function opcionesLamina() {
  return { width: ANCHO_LAMINA, height: ALTO_LAMINA, fonts: FUENTES };
}
