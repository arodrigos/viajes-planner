// inf-ac2: escribe dos láminas de ejemplo (multiciudad y una ciudad) con el
// mismo Lamina y modelo que la ruta, sin base de datos. El CI las publica con
// las capturas para que se juzguen a ojo.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { Lamina } from "../src/lib/infografia/Lamina";
import { construirModeloInfografia } from "../src/lib/infografia/modelo";
import { opcionesLamina } from "../src/lib/infografia/opciones";
import type { Plan } from "../src/lib/plan/tipos";
import { multiciudad, unaCiudad, unaCiudadLarga } from "./ejemplos-infografia";

async function escribir(nombre: string, plan: Plan, tuPresupuesto: number) {
  const respuesta = new ImageResponse(createElement(Lamina, { modelo: construirModeloInfografia(plan, tuPresupuesto) }), opcionesLamina());
  const carpeta = join("artefactos", "capturas");
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, `infografia-ejemplo-${nombre}.png`);
  writeFileSync(ruta, Buffer.from(await respuesta.arrayBuffer()));
  console.log(`escrito ${ruta}`);
}

async function main() {
  await escribir("multiciudad", multiciudad, 3000);
  await escribir("una-ciudad", unaCiudad, 800);
  await escribir("una-ciudad-larga", unaCiudadLarga, 1500);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
