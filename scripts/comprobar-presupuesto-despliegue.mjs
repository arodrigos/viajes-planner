// Guardarraíl del tamaño del despliegue: lee el informe de
// `medir-despliegue.mjs` y sale con código 1 si supera el presupuesto.
// Los límites dejan holgura sobre la medida actual (39 funciones, 100,55 MB)
// para que un cambio normal no lo dispare, pero sí uno que reintroduzca las
// variantes de sharp o duplique rutas.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRESUPUESTO = { funciones: 40, total_mb: 150 };

export function comprobarPresupuesto(informe, presupuesto = PRESUPUESTO) {
  const excesos = [];
  if (informe.funciones > presupuesto.funciones) {
    excesos.push(`funciones: ${informe.funciones} > ${presupuesto.funciones}`);
  }
  if (informe.total_mb > presupuesto.total_mb) {
    excesos.push(`total_mb: ${informe.total_mb} > ${presupuesto.total_mb}`);
  }
  return excesos;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fichero = process.argv[2];
  if (!fichero) {
    console.error("Uso: node scripts/comprobar-presupuesto-despliegue.mjs <informe.json>");
    process.exit(1);
  }
  try {
    const informe = JSON.parse(readFileSync(fichero, "utf8"));
    if (typeof informe.funciones !== "number" || typeof informe.total_mb !== "number") {
      throw new Error("el informe no trae funciones ni total_mb");
    }
    const excesos = comprobarPresupuesto(informe);
    if (excesos.length) {
      console.error(`Presupuesto de despliegue superado -- ${excesos.join("; ")}`);
      process.exit(1);
    }
    console.log(`Presupuesto OK: ${informe.funciones} funciones, ${informe.total_mb} MB`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
