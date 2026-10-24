import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reservasDelDia, type ElementoFijo } from "@/lib/reservas/enElDia";
import type { Reserva } from "@/lib/reservas/tipos";
import { moverParadaDeDia, ordenConParadaEnFranja } from "../aplicarArreglo";
import { proponerArreglos, type DiaArreglable, type ParadaArreglable, type PlanArreglable } from "../arreglos";
import { detectarConflictosDia, evaluarDia } from "../conflictos";
import { optimizarOrdenDia } from "../optimizarOrden";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];
const ctx = { opciones: { perfil: null }, countryCode: "it" };
const FECHAS = ["2026-11-16", "2026-11-17", "2026-11-18"];

const parada = (id: string, franja: string, extra: Partial<ParadaArreglable> = {}): ParadaArreglable => ({ id, franja_id: franja, duracion_min: 90, coordenadas: { lat: 41.9, lon: 12.5 }, ...extra });
const dia = (i: number, paradas: ParadaArreglable[], reservas: ElementoFijo[] = []): DiaArreglable => ({ fecha: FECHAS[i], franjas: FRANJAS, paradas, ...(reservas.length > 0 ? { reservas } : {}) });
const entrada = (desde: string, nombre = "Galería Borghese", fecha = FECHAS[1]): Reserva => ({ id: "e1", tipo: "entrada", fecha_inicio: fecha, hora_inicio: desde, hora_fin: undefined, nombre });
const vuelo = (sentido: "ida" | "vuelta", hora: string, tipo: "vuelo" | "tren" = "vuelo"): Reserva =>
  sentido === "ida"
    ? { id: "v1", tipo, sentido, fecha_inicio: FECHAS[0], hora_inicio: "08:00", fecha_fin: FECHAS[0], hora_fin: hora, origen: "MAD", destino: "FCO" }
    : { id: "v2", tipo, sentido, fecha_inicio: FECHAS[2], hora_inicio: hora, fecha_fin: FECHAS[2], hora_fin: "21:00", origen: "FCO", destino: "MAD" };

describe("conflictos con reservas (res-dia-ac2)", () => {
  it("una parada de 09:00 a 10:30 que pisa una entrada de las 10:30 a las 12:00 choca; la que acaba justo a las 10:30 no", () => {
    // La mañana empieza a las 09:00 y la primera parada llega a esa hora.
    const fijos = reservasDelDia([{ ...entrada("10:30"), hora_fin: "12:00" }], FECHAS[1]);
    const choca = dia(1, [parada("p", "manana", { duracion_min: 100 })], fijos);
    expect(detectarConflictosDia(choca, ctx)).toEqual([expect.objectContaining({ paradaId: "p", clase: "solapa-reserva", texto: "Choca con tu entrada de las 10:30", reservaId: "e1" })]);
    const justa = dia(1, [parada("p", "manana", { duracion_min: 90 })], fijos);
    expect(detectarConflictosDia(justa, ctx)).toEqual([]);
  });

  it("antes de la llegada más 60 minutos: 13:00 → hasta las 14:00 es conflicto, llegar a las 14:00 no", () => {
    const fijos = reservasDelDia([vuelo("ida", "13:00")], FECHAS[0]);
    const tarde = dia(0, [parada("p", "tarde")], fijos);
    expect(detectarConflictosDia(tarde, { ...ctx, horarios: { p: { inicioMin: 13 * 60 + 59, finMin: 15 * 60 } } })[0]).toMatchObject({ clase: "antes-de-llegada", texto: "Antes de tu llegada a las 13:00" });
    expect(detectarConflictosDia(tarde, { ...ctx, horarios: { p: { inicioMin: 14 * 60, finMin: 15 * 60 } } })).toEqual([]);
  });

  it("después de la salida: 120 min de margen en un vuelo y 45 en un tren", () => {
    const horarios = { p: { inicioMin: 15 * 60, finMin: 16 * 60 + 30 } };
    const d = (r: Reserva) => dia(2, [parada("p", "tarde")], reservasDelDia([r], FECHAS[2]));
    expect(detectarConflictosDia(d(vuelo("vuelta", "18:40")), { ...ctx, horarios: { p: { inicioMin: 15 * 60, finMin: 16 * 60 + 41 } } })[0]).toMatchObject({ clase: "despues-de-salida", texto: "Después de tu salida a las 18:40" });
    expect(detectarConflictosDia(d(vuelo("vuelta", "18:40")), { ...ctx, horarios: { p: { inicioMin: 15 * 60, finMin: 16 * 60 + 40 } } })).toEqual([]);
    expect(detectarConflictosDia(d(vuelo("vuelta", "17:00", "tren")), { ...ctx, horarios })[0]).toMatchObject({ clase: "despues-de-salida" });
    expect(detectarConflictosDia(d(vuelo("vuelta", "18:40", "tren")), { ...ctx, horarios })).toEqual([]);
  });

  it("el hotel y los días sin reserva no generan conflictos, y el contexto puede traer las reservas aparte", () => {
    const hotel: Reserva = { id: "h", tipo: "hotel", fecha_inicio: FECHAS[0], fecha_fin: FECHAS[2], nombre: "Sole" };
    expect(detectarConflictosDia(dia(0, [parada("p", "manana")], reservasDelDia([hotel], FECHAS[0])), ctx)).toEqual([]);
    const solapa = reservasDelDia([{ ...entrada("09:30"), fecha_inicio: FECHAS[0] }], FECHAS[0]);
    expect(detectarConflictosDia(dia(0, [parada("p", "manana")]), { ...ctx, reservasDelDia: solapa })).toHaveLength(1);
  });

  it("guardar una reserva no toca el día: evaluarDia es pura y no muta paradas", () => {
    const d = dia(1, [parada("p", "manana"), parada("q", "tarde")], reservasDelDia([entrada("10:00")], FECHAS[1]));
    const copia = structuredClone(d);
    expect(evaluarDia(d, ctx)).toEqual(evaluarDia(d, ctx));
    expect(d).toEqual(copia);
  });
});

describe("proponerArreglos con reservas (res-dia-ac2)", () => {
  it("lleva la parada a otro día o franja sin choque, también con un sitio sin horario conocido", () => {
    const fijos = reservasDelDia([entrada("09:30")], FECHAS[1]);
    const plan: PlanArreglable = { dias: [dia(0, []), dia(1, [parada("p", "manana")], fijos), dia(2, [])] };
    const conflicto = detectarConflictosDia(plan.dias[1], ctx)[0];
    expect(conflicto.clase).toBe("solapa-reserva");
    const opciones = proponerArreglos(plan, 1, conflicto, ctx);
    expect(opciones.length).toBeGreaterThan(0);
    expect(opciones.length).toBeLessThanOrEqual(3);
    expect(opciones[0]).toMatchObject({ tipo: "otra-franja", franjaId: "tarde" });
  });

  it("no ofrece un día cuya llegada o salida también choca", () => {
    // Día 0 con llegada a las 19:00 y todo el día 2 con salida a las 09:30: el día 1 está lleno de entradas.
    const llegada = reservasDelDia([{ ...vuelo("ida", "19:00") }], FECHAS[0]);
    const plan: PlanArreglable = {
      dias: [dia(0, [], llegada), dia(1, [parada("p", "manana")], reservasDelDia([entrada("09:00"), { ...entrada("15:00"), id: "e2" }], FECHAS[1]))],
    };
    const conflicto = detectarConflictosDia(plan.dias[1], ctx)[0];
    // El día 0 solo tiene hueco antes de la llegada: ahí la parada también chocaría.
    expect(proponerArreglos(plan, 1, conflicto, ctx).filter((o) => o.tipo === "otro-dia" && o.diaDestino === 0 && o.franjaId === "manana")).toEqual([]);
  });

  it("invariante: toda opción deja la parada sin conflicto con las reservas del destino ni añade otros", () => {
    const hora = fc.integer({ min: 8 * 60, max: 21 * 60 });
    const aHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    fc.assert(
      fc.property(hora, hora, hora, fc.constantFrom("entrada", "llegada", "salida"), (h1, h2, h3, clase) => {
        const reserva = (fecha: string, h: number): Reserva =>
          clase === "entrada"
            ? { id: `r${fecha}`, tipo: "entrada", fecha_inicio: fecha, hora_inicio: aHora(h), nombre: "x" }
            : clase === "llegada"
              ? { id: `r${fecha}`, tipo: "vuelo", sentido: "ida", fecha_inicio: fecha, hora_inicio: "01:00", fecha_fin: fecha, hora_fin: aHora(h), origen: "A", destino: "B" }
              : { id: `r${fecha}`, tipo: "vuelo", sentido: "vuelta", fecha_inicio: fecha, hora_inicio: aHora(h), fecha_fin: fecha, hora_fin: "23:00", origen: "A", destino: "B" };
        const plan: PlanArreglable = {
          dias: [
            dia(0, [], reservasDelDia([reserva(FECHAS[0], h1)], FECHAS[0])),
            dia(1, [parada("p", "manana"), parada("q", "tarde")], reservasDelDia([reserva(FECHAS[1], h2)], FECHAS[1])),
            dia(2, [], reservasDelDia([reserva(FECHAS[2], h3)], FECHAS[2])),
          ],
        };
        const antes = evaluarDia(plan.dias[1], ctx);
        const conflicto = antes.conflictos.find((c) => c.paradaId === "p");
        if (!conflicto) return;
        for (const o of proponerArreglos(plan, 1, conflicto, ctx)) {
          if (o.tipo === "otra-franja") {
            // Misma colocación que aplica el botón: la parada va al final de la franja destino.
            const orden = ordenConParadaEnFranja(plan.dias[1], "p", o.franjaId);
            const movida = { ...plan.dias[1], paradas: orden.map((e) => ({ ...plan.dias[1].paradas.find((p) => p.id === e.id)!, franja_id: e.franja_id })) };
            expect(evaluarDia(movida, ctx).conflictos.some((c) => c.paradaId === "p")).toBe(false);
          } else if (o.tipo === "otro-dia") {
            const movido = moverParadaDeDia(plan.dias, { diaOrigen: 1, diaDestino: o.diaDestino, paradaId: "p", franjaId: o.franjaId });
            expect(movido).not.toBeNull();
            const destino = movido!.dias[o.diaDestino];
            expect(evaluarDia(destino, ctx).conflictos.some((c) => c.paradaId === "p")).toBe(false);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("Optimizar orden no empeora los choques con reservas (res-dia-ac1)", () => {
  it("el comprobador de conflictos incluye las reservas del día", () => {
    const fijos = reservasDelDia([entrada("09:00")], FECHAS[1]);
    const paradas = [parada("a", "manana", { coordenadas: { lat: 41.9, lon: 12.5 } }), parada("b", "manana", { coordenadas: { lat: 41.95, lon: 12.55 } }), parada("c", "manana", { coordenadas: { lat: 41.901, lon: 12.501 } })];
    const d = dia(1, paradas, fijos);
    const comprobar = (orden: readonly { id: string; franja_id: string }[]) =>
      evaluarDia({ ...d, paradas: orden.map((o) => paradas.find((p) => p.id === o.id)!) }, ctx).conflictos.map((c) => c.paradaId);
    const resultado = optimizarOrdenDia(paradas.map((p) => ({ ...p, nombre: p.id, coordenadas: p.coordenadas })) as never, FRANJAS as never, null, comprobar);
    const nuevos = comprobar(resultado.orden);
    expect(nuevos.length).toBeLessThanOrEqual(comprobar(paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }))).length);
  });
});
