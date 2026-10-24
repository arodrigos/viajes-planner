import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moverParadaDeDia, ordenConParadaEnFranja, type MovimientoDia } from "../aplicarArreglo";
import { proponerArreglos, type DiaArreglable, type ParadaArreglable, type PlanArreglable } from "../arreglos";
import { detectarConflictosDia, evaluarDia } from "../conflictos";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];
const ctx = { opciones: { perfil: null }, countryCode: "it" };
// 2026-11-16 es lunes.
const FECHAS = ["2026-11-16", "2026-11-17", "2026-11-18"];

function parada(id: string, franja: string, regla: string | undefined, extra: Partial<ParadaArreglable> = {}): ParadaArreglable {
  return { id, franja_id: franja, duracion_min: 60, coordenadas: { lat: 41.9, lon: 12.5 }, lugar: regla ? { etiquetas: { opening_hours: regla } } : undefined, ...extra };
}
const dia = (i: number, paradas: ParadaArreglable[]): DiaArreglable => ({ fecha: FECHAS[i], franjas: FRANJAS, paradas });
const conflictoDe = (plan: PlanArreglable, i: number, id: string) => {
  const c = detectarConflictosDia(plan.dias[i], ctx).find((x) => x.paradaId === id);
  if (!c) throw new Error("la parada no tiene conflicto");
  return c;
};

describe("proponerArreglos (arr-ac2)", () => {
  const CIERRA_LUNES = "Mo off; Tu-Su 10:00-18:00";

  it("ofrece el martes y la alternativa abierta, y no otra franja del lunes porque cierra todo el día", () => {
    const alternativa = { id: "alt-1", nombre: "Galería abierta", duracion_min: 60, coordenadas: { lat: 41.91, lon: 12.51 }, opening_hours: "Mo-Su 09:00-19:00" };
    const plan: PlanArreglable = { dias: [dia(0, [parada("p", "manana", CIERRA_LUNES, { alternativas: [alternativa] })]), dia(1, []), dia(2, [])] };
    const opciones = proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx);
    expect(opciones.map((o) => o.tipo)).toEqual(["otro-dia", "alternativa"]);
    expect(opciones[0]).toMatchObject({ tipo: "otro-dia", diaDestino: 1, franjaId: "manana", etiqueta: "Llevar al martes: abre de 10:00 a 18:00" });
    expect(opciones[1]).toMatchObject({ tipo: "alternativa", alternativaId: "alt-1" });
  });

  it("ofrece pasar a la tarde si esa tarde abre", () => {
    const plan: PlanArreglable = { dias: [dia(0, [parada("p", "manana", "Mo 15:00-19:00")]), dia(1, [])] };
    const [primera] = proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx);
    expect(primera).toMatchObject({ tipo: "otra-franja", franjaId: "tarde" });
    expect(primera.etiqueta).toBe("Pasar a la tarde: abre de 15:00 a 19:00");
  });

  it("un viaje de un día sin alternativas devuelve []", () => {
    const plan: PlanArreglable = { dias: [dia(0, [parada("p", "manana", CIERRA_LUNES)])] };
    expect(proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx)).toEqual([]);
  });

  it("una alternativa con horario desconocido no se ofrece como abierta", () => {
    const alternativa = { id: "alt-1", nombre: "Por cita", duracion_min: 60, coordenadas: { lat: 41.91, lon: 12.51 }, opening_hours: 'Mo-Su 09:00-19:00 "por cita"' };
    const plan: PlanArreglable = { dias: [dia(0, [parada("p", "manana", CIERRA_LUNES, { alternativas: [alternativa] })])] };
    expect(proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx)).toEqual([]);
  });

  it("no cruza de etapa en un viaje de varias ciudades", () => {
    const plan: PlanArreglable = { dias: [{ ...dia(0, [parada("p", "manana", CIERRA_LUNES)]), etapa: 0 }, { ...dia(1, []), etapa: 1 }] };
    expect(proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx)).toEqual([]);
  });

  it("tiene en cuenta que llegará después de lo que ya hay en la franja", () => {
    // El martes la mañana ya tiene una visita larga: P llegaría pasadas las 11:30 y su sitio cierra a las 11:00.
    const ocupado = parada("q", "manana", undefined, { duracion_min: 150 });
    const plan: PlanArreglable = { dias: [dia(0, [parada("p", "manana", "Mo off; Tu 10:00-11:00")]), dia(1, [ocupado])] };
    expect(proponerArreglos(plan, 0, conflictoDe(plan, 0, "p"), ctx)).toEqual([]);
  });
});

// Invariantes (P19): para cualquier plan generado, cada opción deja a la
// parada sin conflicto y no añade ninguno a las demás; son como mucho 3 y
// nunca la franja y el día en que ya está.
const reglas = ["Mo off; Tu-Su 10:00-18:00", "Mo-Fr 09:00-14:00", "Tu,Th 15:00-19:00", "Mo-Su 08:00-22:00", "We-Su 10:00-13:00; Mo 16:00-19:00"];
const paradasArb = (prefijo: string) =>
  fc.array(fc.record({ franja: fc.constantFrom("manana", "tarde"), regla: fc.constantFrom(...reglas), dur: fc.constantFrom(30, 60, 120) }), { maxLength: 3 }).map((xs) => xs.map((x, i) => parada(`${prefijo}${i}`, x.franja, x.regla, { duracion_min: x.dur })).sort((a, b) => (a.franja_id === b.franja_id ? 0 : a.franja_id === "manana" ? -1 : 1)));
const planArb = fc
  .tuple(paradasArb("a"), paradasArb("b"), paradasArb("c"), fc.array(fc.constantFrom(...reglas), { maxLength: 2 }))
  .map(([a, b, c, alts]): PlanArreglable => ({
    dias: [dia(0, a.map((p, i) => (i === 0 ? { ...p, alternativas: alts.map((r, k) => ({ id: `alt${k}`, nombre: `Alt ${k}`, duracion_min: 60, coordenadas: { lat: 41.9, lon: 12.5 }, opening_hours: r })) } : p))), dia(1, b), dia(2, c)],
  }));

describe("proponerArreglos: invariantes", () => {
  it("toda opción deja la parada sin conflicto, no añade otros y no pasa de 3", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        for (let d = 0; d < plan.dias.length; d++) {
          for (const c of detectarConflictosDia(plan.dias[d], ctx)) {
            const opciones = proponerArreglos(plan, d, c, ctx);
            expect(opciones.length).toBeLessThanOrEqual(3);
            const origen = plan.dias[d].paradas.find((p) => p.id === c.paradaId)!;
            for (const o of opciones) {
              let resultante: DiaArreglable;
              if (o.tipo === "otra-franja") {
                expect(o.franjaId).not.toBe(origen.franja_id);
                const orden = ordenConParadaEnFranja(plan.dias[d], c.paradaId, o.franjaId);
                resultante = { ...plan.dias[d], paradas: orden.map((e) => ({ ...plan.dias[d].paradas.find((p) => p.id === e.id)!, franja_id: e.franja_id })) };
              } else if (o.tipo === "otro-dia") {
                expect(o.diaDestino).not.toBe(d);
                const movido = moverParadaDeDia(plan.dias, { diaOrigen: d, diaDestino: o.diaDestino, paradaId: c.paradaId, franjaId: o.franjaId })!;
                resultante = movido.dias[o.diaDestino];
              } else {
                const alt = origen.alternativas!.find((a) => a.id === o.alternativaId)!;
                resultante = { ...plan.dias[d], paradas: plan.dias[d].paradas.map((p) => (p.id === c.paradaId ? { ...p, duracion_min: alt.duracion_min, lugar: { etiquetas: { opening_hours: alt.opening_hours } } } : p)) };
              }
              const antes = o.tipo === "otro-dia" ? evaluarDia(plan.dias[o.diaDestino], ctx) : evaluarDia(plan.dias[d], ctx);
              const despues = evaluarDia(resultante, ctx);
              expect(despues.conflictos.some((x) => x.paradaId === c.paradaId)).toBe(false);
              const previos = new Set(antes.conflictos.map((x) => x.paradaId));
              expect(despues.conflictos.every((x) => previos.has(x.paradaId))).toBe(true);
            }
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("moverParadaDeDia", () => {
  const diasArb = fc
    .tuple(paradasArb("a"), paradasArb("b"))
    .filter(([a]) => a.length > 0)
    .map(([a, b]) => [dia(0, a), dia(1, b)]);

  it("conserva el total de paradas y cambia solo los dos días implicados", () => {
    fc.assert(
      fc.property(diasArb, fc.constantFrom("manana", "tarde"), (dias, franja) => {
        const m: MovimientoDia = { diaOrigen: 0, diaDestino: 1, paradaId: dias[0].paradas[0].id, franjaId: franja };
        const r = moverParadaDeDia(dias, m)!;
        expect(r.dias.flatMap((d) => d.paradas)).toHaveLength(dias.flatMap((d) => d.paradas).length);
        expect(r.dias[1].paradas.find((p) => p.id === m.paradaId)?.franja_id).toBe(franja);
      }),
    );
  });

  it("aplicar y deshacer deja origen y destino con las mismas paradas, franjas y orden", () => {
    fc.assert(
      fc.property(diasArb, fc.constantFrom("manana", "tarde"), fc.nat(2), (dias, franja, k) => {
        const m: MovimientoDia = { diaOrigen: 0, diaDestino: 1, paradaId: dias[0].paradas[Math.min(k, dias[0].paradas.length - 1)].id, franjaId: franja };
        const ida = moverParadaDeDia(dias, m)!;
        const vuelta = moverParadaDeDia(ida.dias, ida.inverso)!;
        const forma = (ds: DiaArreglable[]) => ds.map((d) => d.paradas.map((p) => `${p.id}@${p.franja_id}`));
        expect(forma(vuelta.dias)).toEqual(forma(dias));
      }),
    );
  });
});
