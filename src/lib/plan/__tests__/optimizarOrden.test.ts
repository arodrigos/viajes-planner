import { describe, expect, it } from "vitest";
import { calcularTramosDia } from "../tramos";
import { MAX_UBICADAS_OPTIMIZAR, optimizarOrdenDia, ubicadasDelDia, type ParadaOptimizable } from "../optimizarOrden";

const FRANJAS = [{ id: "manana" }, { id: "comida" }, { id: "tarde" }];
const ALOJAMIENTO = { lat: 37.17, lon: -3.59 };
// Sobre un meridiano, a ~0,55 km una de otra.
const sitio = (id: string, franja: string, n: number | null): ParadaOptimizable => ({
  id,
  franja_id: franja,
  ...(n === null ? {} : { coordenadas: { lat: 37.17 + n * 0.005, lon: -3.59 } }),
});
const ids = (r: { orden: { id: string }[] }) => r.orden.map((e) => e.id);

describe("optimizarOrdenDia", () => {
  it("ordena un zigzag 1,5,2,4,3 a 1,2,3,4,5 desde el alojamiento", () => {
    const zigzag = [1, 5, 2, 4, 3].map((n) => sitio(`s${n}`, "manana", n));
    const r = optimizarOrdenDia(zigzag, FRANJAS, ALOJAMIENTO);
    expect(ids(r)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(r.mejora).toBe(true);
    expect(r.kmAntes).toBeGreaterThan(r.kmDespues);
  });

  it("kmAntes es la suma de los tramos de calcularTramosDia más el del alojamiento, sin redondear", () => {
    const dia = [1, 5, 2, 4, 3].map((n) => sitio(`s${n}`, "manana", n));
    const puntos = dia.map((p) => ({ id: p.id, ...p.coordenadas! }));
    const tramos = calcularTramosDia(puntos, { perfil: null });
    const desdeAlojamiento = calcularTramosDia([{ id: "alojamiento", ...ALOJAMIENTO }, puntos[0]], { perfil: null });
    const redondeada = [...tramos, ...desdeAlojamiento].reduce((suma, t) => suma + t.km, 0);
    const { kmAntes } = optimizarOrdenDia(dia, FRANJAS, ALOJAMIENTO);
    // Cada tramo mostrado va redondeado a 0,1: la diferencia máxima son 0,05 por tramo.
    expect(Math.abs(kmAntes - redondeada)).toBeLessThanOrEqual(0.05 * (tramos.length + 1));
  });

  it("sin coordenadas en el alojamiento, la primera ubicada no se mueve", () => {
    const dia = [3, 1, 2].map((n) => sitio(`s${n}`, "manana", n));
    expect(ids(optimizarOrdenDia(dia, FRANJAS, null))).toEqual(["s3", "s2", "s1"]);
  });

  it("deja la comida en la comida y encadena cada franja con la siguiente (opción A)", () => {
    const dia = [sitio("m1", "manana", 3), sitio("m2", "manana", 1), sitio("m3", "manana", 2), sitio("r1", "comida", 3.5), sitio("t1", "tarde", 6), sitio("t2", "tarde", 4), sitio("t3", "tarde", 5)];
    const r = optimizarOrdenDia(dia, FRANJAS, ALOJAMIENTO);
    expect(ids(r)).toEqual(["m2", "m3", "m1", "r1", "t2", "t3", "t1"]);
    expect(r.orden.map((e) => e.franja_id)).toEqual(dia.map((p) => p.franja_id));
  });

  it("las no ubicadas conservan su puesto", () => {
    const dia = [sitio("a", "manana", 3), sitio("x", "manana", null), sitio("b", "manana", 1), sitio("c", "tarde", 2), sitio("y", "tarde", null)];
    const r = optimizarOrdenDia(dia, FRANJAS, ALOJAMIENTO);
    expect(r.orden[1].id).toBe("x");
    expect(r.orden[4].id).toBe("y");
    expect(ids(r)).toEqual(["b", "x", "a", "c", "y"]);
  });

  it("un día ya óptimo no cambia y no mejora", () => {
    const dia = [1, 2, 3, 4].map((n) => sitio(`s${n}`, "manana", n));
    const r = optimizarOrdenDia(dia, FRANJAS, ALOJAMIENTO);
    expect(ids(r)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(r.mejora).toBe(false);
  });

  it("con más de 9 ubicadas no intenta nada", () => {
    const dia = Array.from({ length: MAX_UBICADAS_OPTIMIZAR + 1 }, (_, i) => sitio(`s${(i * 3) % 10}`, "manana", (i * 3) % 10));
    const r = optimizarOrdenDia(dia, FRANJAS, ALOJAMIENTO);
    expect(ids(r)).toEqual(dia.map((p) => p.id));
    expect(r.mejora).toBe(false);
  });

  it("ubicadasDelDia cuenta solo las que tienen coordenadas", () => {
    expect(ubicadasDelDia([sitio("a", "manana", 1), sitio("b", "manana", null)])).toBe(1);
  });
});
