import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// acceso-ac4 (parte que sí es responsabilidad de este bloque, no del tick
// del trabajador que construye trabajador-vps1/cuota-suscripcion más
// adelante): la respuesta de Adrián sustituyó el tope mensual en euros por
// pausa y retomada de cuota de suscripción. Este test demuestra que el
// mecanismo antiguo no ha sobrevivido en ninguna parte del código fuente.
const RAIZ_SRC = join(import.meta.dirname, "..", "..", "..");
const PATRON_TOPE_ECONOMICO = /\b(EUR|euros?|tope_gasto|coste_mensual)\b/i;

function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return ficherosTs(ruta);
    return entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("sin identificadores de tope económico en src/", () => {
  it("no aparece EUR, euro(s), tope_gasto ni coste_mensual en ningún fichero de producto, ni en código ni en comentarios", () => {
    // "presupuesto_eur" (nombre de campo del formulario, no del mecanismo de
    // cuota) es la única excepción legítima: el presupuesto del VIAJE en
    // euros es un dato de producto, no el tope de gasto en tokens que se
    // descartó. Se excluye por nombre exacto de propiedad, no por fichero.
    const infractores = ficherosTs(RAIZ_SRC)
      .filter((ruta) => !relative(RAIZ_SRC, ruta).includes("__tests__"))
      .map((ruta) => ({ ruta, contenido: readFileSync(ruta, "utf8") }))
      .filter(({ contenido }) => {
        const sinPresupuestoEur = contenido.replace(/presupuesto_eur/gi, "");
        return PATRON_TOPE_ECONOMICO.test(sinPresupuestoEur);
      })
      .map(({ ruta }) => ruta);

    expect(infractores).toEqual([]);
  });
});
