// lam-ac3: mide el PNG real de la Lamina, con las fuentes de la ruta, en vez de
// fiarse del recorte por grafemas del modelo: lo que satori dibuja es lo que
// se ve. Imprime un JSON de métricas y sale con 1 si alguna falla.
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { PNG } from "pngjs";
import { ALTO_LAMINA, ANCHO_LAMINA, COLOR, Lamina, TAM_TITULO } from "../src/lib/infografia/Lamina";
import { construirModeloInfografia } from "../src/lib/infografia/modelo";
import { opcionesLamina } from "../src/lib/infografia/opciones";
import type { Plan } from "../src/lib/plan/tipos";
import { franjas, multiciudad, parada } from "./ejemplos-infografia";

const NOMBRE_80 = "Monasterio de Santo Estevo de Ribas de Sil y paseo por los cañones del río Sil";
const TITULO_80 = "Escapada de otoño por la Ribeira Sacra con abuelos, primos, perro y un largo etcétera";

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

async function pintar(elemento: React.ReactElement, ancho: number, alto: number): Promise<PNG> {
  const respuesta = new ImageResponse(elemento, { ...opcionesLamina(), width: ancho, height: alto });
  return PNG.sync.read(Buffer.from(await respuesta.arrayBuffer()));
}

function cerca(png: PNG, x: number, y: number, objetivo: [number, number, number], tol: number): boolean {
  const i = (png.width * y + x) << 2;
  return [0, 1, 2].every((c) => Math.abs(png.data[i + c] - objetivo[c]) <= tol);
}

// Hueco horizontal máximo sin tinta entre la primera y la última columna con
// tinta del color dado, dentro de la banda [y0, y1).
function huecoMaximo(png: PNG, y0: number, y1: number, color: string, tol = 40): number {
  const objetivo = rgb(color);
  let ultima = -1;
  let primera = -1;
  let hueco = 0;
  for (let x = 0; x < png.width; x++) {
    let tinta = false;
    for (let y = y0; y < y1 && !tinta; y++) tinta = cerca(png, x, y, objetivo, tol);
    if (!tinta) continue;
    if (primera < 0) primera = x;
    else hueco = Math.max(hueco, x - ultima - 1);
    ultima = x;
  }
  return primera < 0 ? Number.NaN : hueco;
}

function pixelesFueraDeFondo(png: PNG, y0: number, y1: number): number {
  const fondo = rgb(COLOR.fondo);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < png.width; x++) if (!cerca(png, x, y, fondo, 6)) n++;
  return n;
}

const laminaDe = (plan: Plan, tuPresupuesto: number) => createElement(Lamina, { modelo: construirModeloInfografia(plan, tuPresupuesto) });

const planA: Plan = {
  ...multiciudad, id: "medir-a", destino: TITULO_80,
  dias: multiciudad.dias.map((d) => ({ ...d, paradas: d.paradas.map((p, i) => ({ ...p, nombre: i === 0 ? NOMBRE_80 : p.nombre })) })),
  eventos: { estado: "consultado", consultado_en: "2027-01-01T00:00:00Z", eventos: ["Día de Portugal", "Fiesta de San Antonio con procesión por todo el barrio antiguo y verbena", "Mercado", "Concierto"].map((nombre, i) => ({ fecha: `2027-06-${10 + i}`, nombre, tipo: "fiesta" as const, fuente: "wikidata" as const, url: "https://www.wikidata.org", etapa: 0, pais: "PT" })) },
};
const planB: Plan = {
  id: "medir-b", version: 1, destino: TITULO_80, personas: 4,
  dias: Array.from({ length: 14 }, (_, i) => ({ fecha: `2027-03-${String(5 + i).padStart(2, "0")}`, franjas, paradas: [parada(`b${i}a`, NOMBRE_80, 90, 10), parada(`b${i}b`, NOMBRE_80, 60, 5)] })),
  eventos: planA.eventos,
};

async function main() {
  const [a, b, c] = await Promise.all([
    pintar(laminaDe(planA, 3000), ANCHO_LAMINA, ALTO_LAMINA),
    pintar(laminaDe(planB, 3000), ANCHO_LAMINA, ALTO_LAMINA),
    pintar(laminaDe({ ...multiciudad, destino: "Portugal en familia" }, 3000), ANCHO_LAMINA, ALTO_LAMINA),
  ]);

  // Pie: 160 px por encima del margen inferior de 60. Título: banda superior,
  // una línea de alto (el de «Portugal en familia» no pasa de una).
  const huecoPresupuesto = huecoMaximo(c, ALTO_LAMINA - 60 - 160, ALTO_LAMINA - 60, COLOR.acento);
  const huecoTitulo = huecoMaximo(c, 60, 60 + Math.ceil(TAM_TITULO * 1.1), COLOR.tinta);

  // Control: el mismo texto con doble espacio visible tiene que dar hueco
  // grande, o esta medida no detectaría el defecto que dice vigilar.
  const control = await pintar(
    createElement("div", { style: { display: "flex", whiteSpace: "pre", fontFamily: "Inter", fontWeight: 700, fontSize: 40, color: COLOR.acento, background: COLOR.fondo, width: 1080, height: 200, padding: 20 } }, "Presupuesto  estimado"),
    1080, 200,
  );
  const huecoControl = huecoMaximo(control, 0, 200, COLOR.acento);

  const metricas = {
    hueco_max_presupuesto_px: huecoPresupuesto,
    hueco_max_titulo_px: huecoTitulo,
    hueco_control_px: huecoControl,
    pixeles_margen_inferior_a: pixelesFueraDeFondo(a, 1300, 1350),
    pixeles_margen_inferior_b: pixelesFueraDeFondo(b, 1300, 1350),
  };
  console.log(JSON.stringify(metricas, null, 2));

  const fallos: string[] = [];
  if (!(metricas.hueco_max_presupuesto_px <= 20)) fallos.push("hueco del presupuesto > 20 px");
  if (!(metricas.hueco_max_titulo_px <= TAM_TITULO / 2)) fallos.push("hueco del título > 0,5 × su tamaño");
  if (!(metricas.hueco_control_px > 20)) fallos.push("el control con doble espacio no supera 20 px: la medida no detecta el defecto");
  if (metricas.pixeles_margen_inferior_a !== 0) fallos.push("(a) pinta en el margen inferior");
  if (metricas.pixeles_margen_inferior_b !== 0) fallos.push("(b) pinta en el margen inferior");
  if (fallos.length > 0) {
    console.error(fallos.join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
