// Los iconos de la PWA se versionan (son binarios pequeños), pero salen de
// este script para que su forma no dependa de un editor gráfico: una «V»
// blanca sobre el azul de foco de globals.css. El maskable deja la V dentro
// del 60 % central, la zona que Android nunca recorta.
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const FONDO = [0x1d, 0x4e, 0xd8, 0xff] as const;
const TRAZO = [0xff, 0xff, 0xff, 0xff] as const;

function distanciaASegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function dibujarIcono(lado: number, escala: number): Buffer {
  const png = new PNG({ width: lado, height: lado });
  const margen = (1 - escala) / 2;
  const izq = lado * (margen + escala * 0.12);
  const der = lado * (margen + escala * 0.88);
  const arriba = lado * (margen + escala * 0.2);
  const abajo = lado * (margen + escala * 0.82);
  const centro = lado / 2;
  const grosor = lado * escala * 0.075;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const d = Math.min(
        distanciaASegmento(x, y, izq, arriba, centro, abajo),
        distanciaASegmento(x, y, der, arriba, centro, abajo),
      );
      const color = d <= grosor ? TRAZO : FONDO;
      png.data.set(color, (y * lado + x) * 4);
    }
  }
  return PNG.sync.write(png);
}

if (process.argv[1]?.endsWith("generar-iconos-pwa.ts")) {
  mkdirSync("public/iconos", { recursive: true });
  writeFileSync("public/iconos/icono-192.png", dibujarIcono(192, 1));
  writeFileSync("public/iconos/icono-512.png", dibujarIcono(512, 1));
  writeFileSync("public/iconos/icono-maskable-512.png", dibujarIcono(512, 0.6));
  writeFileSync("src/app/apple-icon.png", dibujarIcono(180, 1));
}
