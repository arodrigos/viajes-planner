import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armarEstadoRelleno, type RecuentosRelleno } from "./referenciaRelleno";

const entero = fc.integer({ min: 0, max: 100_000 });

// Recuentos coherentes por construcción: los cuatro estados de resolución
// reparten paradas_total, y cada «con X» es una parte del total, como en
// una base de datos real.
const recuentos: fc.Arbitrary<RecuentosRelleno> = fc
  .tuple(fc.tuple(entero, entero, entero, entero), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 5, maxLength: 5 }), entero, entero, entero)
  .chain(([[resueltas, noResueltas, enError, sinIntentar], fracciones, planes, multiciudad, inviables]) => {
    const total = resueltas + noResueltas + enError + sinIntentar;
    const parte = (i: number) => Math.floor(fracciones[i] * total);
    return fc.record({
      planesConVersion: fc.integer({ min: 0, max: planes }),
      planesConTrabajoVivo: fc.integer({ min: 0, max: planes }),
    }).map(({ planesConVersion, planesConTrabajoVivo }) => ({
      paradasTotal: total,
      paradasResueltas: resueltas,
      paradasNoResueltas: noResueltas,
      paradasEnError: enError,
      paradasSinIntentar: sinIntentar,
      paradasConFoto: parte(0),
      paradasConAlternativas: parte(1),
      paradasConCategoria: parte(2),
      paradasConGuia: parte(3),
      paradasConMotivo: parte(4),
      curiosidadesFormatoAntiguo: parte(4),
      versionesConEventos: multiciudad,
      versionesMulticiudad: multiciudad,
      trabajosInviables: inviables,
      planesTotal: planes,
      planesConVersion,
      planesConTrabajoVivo,
      planesConCiudad: 0,
      planesSinCiudadIdentificable: 0,
      planesSelladosPocasParadas: 0,
      planesSelladosSinCaja: 0,
      planesSelladosZonaGrande: 0,
      planesSelladosSinContencion: 0,
      planesSelladosSinVentaja: 0,
      planesSelladosSinCandidatoClaro: 0,
      planesSelladosCiudadNoEncontrada: 0,
      // Las cuatro categorías conocidas reparten una parte de las no-resueltas.
      paradasNoResueltasSinCandidatos: Math.floor(noResueltas * fracciones[0] * 0.25),
      paradasNoResueltasFueraDeCaja: Math.floor(noResueltas * fracciones[1] * 0.25),
      paradasNoResueltasNombreDistinto: Math.floor(noResueltas * fracciones[2] * 0.25),
      paradasNoResueltasTipoIncompatible: Math.floor(noResueltas * fracciones[3] * 0.25),
      paradasSinIntentarUltimaVersion: Math.floor(sinIntentar * fracciones[4]),
    }));
  });

// sco-ac3: las invariantes valen para cualquier combinación, no solo para
// el ejemplo sembrado en el test de integración.
describe("armarEstadoRelleno (sco-ac3)", () => {
  it("siempre las 33 claves, todas enteros >= 0", () => {
    fc.assert(
      fc.property(recuentos, (r) => {
        const estado = armarEstadoRelleno(r);
        const valores = Object.values(estado);
        expect(valores).toHaveLength(33);
        expect(valores.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
      }),
    );
  });

  it("paradas_total es la suma de los cuatro estados y los «con X» no la superan", () => {
    fc.assert(
      fc.property(recuentos, (r) => {
        const e = armarEstadoRelleno(r);
        expect(e.paradas_total).toBe(e.paradas_resueltas + e.paradas_no_resueltas + e.paradas_en_error + e.paradas_sin_intentar);
        for (const c of [e.paradas_con_motivo, e.paradas_con_guia, e.paradas_con_alternativas, e.paradas_con_foto]) {
          expect(c).toBeLessThanOrEqual(e.paradas_total);
        }
      }),
    );
  });

  it("el desglose por motivo suma paradas_no_resueltas y paradas_con_toponimo no supera el total", () => {
    fc.assert(
      fc.property(recuentos, (r) => {
        const e = armarEstadoRelleno(r);
        const desglose = [
          e.paradas_no_resueltas_sin_candidatos!,
          e.paradas_no_resueltas_fuera_de_caja!,
          e.paradas_no_resueltas_nombre_distinto!,
          e.paradas_no_resueltas_tipo_incompatible!,
          e.paradas_no_resueltas_motivo_desconocido!,
        ];
        expect(desglose.reduce((a, b) => a + b, 0)).toBe(e.paradas_no_resueltas);
        expect(e.paradas_con_toponimo!).toBeLessThanOrEqual(e.paradas_total);
        expect(e.paradas_con_toponimo!).toBeGreaterThanOrEqual(e.paradas_resueltas);
        expect(e.paradas_sin_intentar_ultima_version!).toBeLessThanOrEqual(e.paradas_sin_intentar);
      }),
    );
  });

  it("los planes sin versión o sin trabajo vivo nunca son negativos ni superan el total", () => {
    fc.assert(
      fc.property(recuentos, (r) => {
        const e = armarEstadoRelleno(r);
        expect(e.planes_sin_version).toBeGreaterThanOrEqual(0);
        expect(e.planes_sin_trabajo_vivo).toBeLessThanOrEqual(e.planes_total);
      }),
    );
  });
});
