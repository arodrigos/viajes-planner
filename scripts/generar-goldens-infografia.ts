// ie2e-ac1/ie2e-ac2: escribe los goldens de infografia.movil.e2e.ts con el
// mismo Lamina, modelo y planes sembrados que usan los tests. Los PNG se
// comprometen: se regeneran con `npm run generar:goldens-infografia` en Linux
// cuando cambie la lámina, y el diff del PR los enseña.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { Lamina } from "../src/lib/infografia/Lamina";
import { construirModeloInfografia } from "../src/lib/infografia/modelo";
import { opcionesLamina } from "../src/lib/infografia/opciones";
import type { Plan } from "../src/lib/plan/tipos";
import { PRESUPUESTO_MULTICIUDAD, PRESUPUESTO_UNA_CIUDAD_LARGA, planMulticiudadInfografia, planUnaCiudadLargaInfografia } from "../src/app/plan/[id]/semillas-e2e";

const CARPETA = join("src", "app", "plan", "[id]", "infografia.movil.e2e.ts-snapshots");

async function escribir(nombre: string, plan: Plan, tuPresupuesto: number) {
  const respuesta = new ImageResponse(createElement(Lamina, { modelo: construirModeloInfografia(plan, tuPresupuesto) }), opcionesLamina());
  mkdirSync(CARPETA, { recursive: true });
  // Nombre que Playwright busca para el proyecto «movil» en Linux.
  const ruta = join(CARPETA, `${nombre}-movil-linux.png`);
  writeFileSync(ruta, Buffer.from(await respuesta.arrayBuffer()));
  console.log(`escrito ${ruta}`);
}

async function main() {
  await escribir("infografia-multiciudad", planMulticiudadInfografia("golden"), PRESUPUESTO_MULTICIUDAD);
  await escribir("infografia-una-ciudad-larga", planUnaCiudadLargaInfografia("golden"), PRESUPUESTO_UNA_CIUDAD_LARGA);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
