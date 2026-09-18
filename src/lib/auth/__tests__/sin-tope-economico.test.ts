import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// acceso-ac4 (parte que sí es responsabilidad de este bloque, no del tick
// del trabajador que construye trabajador-vps1/cuota-suscripcion más
// adelante): la respuesta de Adrián sustituyó el tope mensual en euros por
// pausa y retomada de cuota de suscripción. Este test demuestra que el
// mecanismo antiguo no ha sobrevivido en ninguna parte del código fuente.
//
// El patrón original prohibía también la palabra "euro" en prosa, sin
// distinguir mayúsculas, lo que colisiona con el bloque latido-y-cambio
// (desarrollado en paralelo, antes de que ninguno de los dos mereciera en
// dev): "respecto al euro" en un comentario sobre el feed del BCE no es el
// mecanismo de tope económico, es la divisa de las tasas de cambio, un
// dato de producto tan legítimo como presupuesto_eur. El identificador que
// de verdad delataría el mecanismo antiguo (una constante, una variable de
// entorno, un literal monetario) usaría el código ISO en mayúsculas, no
// prosa en minúsculas: por eso EUR queda sensible a mayúsculas y "euro(s)"
// en minúsculas deja de prohibirse.
const RAIZ_SRC = join(import.meta.dirname, "..", "..", "..");
const PATRON_TOPE_ECONOMICO = /\bEUR\b|tope_gasto|coste_mensual/;

function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return ficherosTs(ruta);
    return entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("sin identificadores de tope económico en src/", () => {
  it("no aparece EUR (mayúsculas), tope_gasto ni coste_mensual en ningún fichero de producto, ni en código ni en comentarios", () => {
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
