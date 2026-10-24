import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generarIcsPlan } from "../calendario";
import { horaDeSalida } from "../horaDeSalida";
import { ordenarParadasPorFranja } from "../paseo";
import { aPlanPublico } from "../publico";
import { calcularTiemposDia, horaDeMinutos, minutosDeHora, TRAMO_SIN_UBICACION_MIN } from "../tiempos";
import type { Franja, Parada, Plan } from "../tipos";
import { umbralAPieKm, type OpcionesTramos } from "../tramos";

// Franjas fijas en su orden declarado; las paradas se reparten entre ellas.
const FRANJAS: Franja[] = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "comida", etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:30" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" },
  { id: "noche", etiqueta: "Noche", hora_inicio: "21:30", hora_fin: "23:30" },
];

const arbCoord = fc.option(fc.record({ lat: fc.double({ min: 38.6, max: 38.8, noNaN: true }), lon: fc.double({ min: -9.3, max: -9.1, noNaN: true }) }), { nil: undefined, freq: 4 });
const arbParadas = fc
  .array(fc.record({ franja: fc.integer({ min: 0, max: FRANJAS.length - 1 }), duracion: fc.integer({ min: 1, max: 300 }), coord: arbCoord }), { minLength: 1, maxLength: 9 })
  .map((ps): Parada[] =>
    ps.map((p, i) => ({
      id: `p${i}`,
      franja_id: FRANJAS[p.franja].id,
      nombre: `p${i}`,
      descripcion: "",
      duracion_min: p.duracion,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" },
      coordenadas: p.coord,
    })),
  );
const arbOpciones = fc.record({
  perfil: fc.constantFrom<string | null>("familiar", "amigos", "pareja", "solo", null),
  transporte: fc.constantFrom<readonly string[] | null>(null, ["coche"], ["coche", "tren"], ["transporte-publico"]),
});

const dia = (paradas: Parada[]) => ({ franjas: FRANJAS, paradas });
const planDe = (paradas: Parada[]): Plan => ({ id: "p", version: 1, destino: "Lisboa", personas: 2, dias: [{ fecha: "2026-11-02", ...dia(paradas) }] }) as Plan;

describe("calcularTiemposDia: invariantes (tiempos-unicos)", () => {
  it("tramos entre paradas adyacentes del orden del día, ambas con coordenadas", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const orden = ordenarParadasPorFranja(FRANJAS, paradas);
        const { tramos } = calcularTiemposDia(dia(paradas), op);
        for (const t of tramos) {
          const i = orden.findIndex((p) => p.id === t.desdeId);
          expect(orden[i + 1]?.id).toBe(t.hastaId);
          expect(orden[i].coordenadas && orden[i + 1].coordenadas).toBeTruthy();
        }
        const esperados = orden.slice(1).filter((p, i) => orden[i].coordenadas && p.coordenadas).length;
        expect(tramos).toHaveLength(esperados);
      }),
    );
  });

  it("cadena: fin(i) + tramo = inicio(i+1) en la misma franja; >= entre franjas; duración real", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const orden = ordenarParadasPorFranja(FRANJAS, paradas);
        const { tramos, horarios } = calcularTiemposDia(dia(paradas), op);
        orden.forEach((p, i) => {
          const h = horarios[p.id];
          expect(h.finMin - h.inicioMin).toBe(p.duracion_min);
          if (i === 0) return;
          const previa = orden[i - 1];
          const tramo = tramos.find((t) => t.desdeId === previa.id && t.hastaId === p.id);
          const entre = tramo ? tramo.minutos : TRAMO_SIN_UBICACION_MIN;
          const llegada = horarios[previa.id].finMin + entre;
          if (previa.franja_id === p.franja_id) expect(h.inicioMin).toBe(llegada);
          else expect(h.inicioMin).toBeGreaterThanOrEqual(llegada);
        });
      }),
    );
  });

  it("cada tramo: múltiplo de 5, >= 5, a pie si y solo si km <= umbral, y monótono en km dentro del mismo modo", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const { tramos } = calcularTiemposDia(dia(paradas), op);
        for (const t of tramos) {
          expect(t.minutos % 5).toBe(0);
          expect(t.minutos).toBeGreaterThanOrEqual(5);
          expect(t.modo === "a-pie").toBe(t.km <= umbralAPieKm(op.perfil));
        }
        for (const a of tramos) for (const b of tramos) if (a.modo === b.modo && a.km <= b.km) expect(a.minutos).toBeLessThanOrEqual(b.minutos);
      }),
    );
  });

  it("recortada y exceso respecto a la hora de fin de su franja; si una lo está, las siguientes de la franja también", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const { horarios } = calcularTiemposDia(dia(paradas), op);
        for (const franja of FRANJAS) {
          const delTramo = ordenarParadasPorFranja([franja], paradas).map((p) => horarios[p.id]);
          delTramo.forEach((h) => {
            const exceso = Math.max(0, h.finMin - minutosDeHora(franja.hora_fin));
            expect(h.excesoMin).toBe(exceso);
            expect(h.recortada).toBe(h.finMin > minutosDeHora(franja.hora_fin));
          });
          const primera = delTramo.findIndex((h) => h.recortada);
          if (primera !== -1) expect(delTramo.slice(primera).every((h) => h.recortada)).toBe(true);
        }
      }),
    );
  });

  it("proveedor nulo o que lanza = sin proveedor; determinista y sin mutar la entrada", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const copia = structuredClone(paradas);
        const base = calcularTiemposDia(dia(paradas), op);
        expect(calcularTiemposDia(dia(paradas), op)).toEqual(base);
        expect(calcularTiemposDia(dia(paradas), { ...op, proveedor: () => null })).toEqual(base);
        expect(
          calcularTiemposDia(dia(paradas), {
            ...op,
            proveedor: () => {
              throw new Error("falla");
            },
          }),
        ).toEqual(base);
        expect(paradas).toEqual(copia);
      }),
    );
  });
});

describe("coherencia entre superficies (tiempos-unicos)", () => {
  it("conector, tarjeta, salida y .ics dan los mismos minutos", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op: OpcionesTramos) => {
        const plan = planDe(paradas);
        const publico = aPlanPublico(plan, op.perfil, null, op.transporte ?? null);
        const { tramos, horarios } = calcularTiemposDia(dia(paradas), op);
        expect(publico.dias[0].tramos ?? []).toEqual(tramos);
        const { contenido } = generarIcsPlan(plan, op);
        // Eventos en el orden de dia.paradas: se leen DTSTART/DTEND de cada uno.
        const bloques = contenido.split("BEGIN:VEVENT").slice(1);
        const lectura = (b: string, etiqueta: string) => b.match(new RegExp(`^${etiqueta}[^:]*:(\\d{8})T(\\d{2})(\\d{2})`, "m"))!;
        paradas.forEach((p, i) => {
          const h = horarios[p.id];
          const ini = lectura(bloques[i], "DTSTART");
          const fin = lectura(bloques[i], "DTEND");
          const tarjeta = publico.dias[0].paradas[i].horario!;
          expect(`${ini[2]}:${ini[3]}`).toBe(tarjeta.inicio);
          expect(`${fin[2]}:${fin[3]}`).toBe(tarjeta.fin);
          expect(tarjeta.inicio).toBe(horaDeMinutos(h.inicioMin));
          // DTEND > DTSTART siempre (la fecha compara primero, luego la hora).
          expect(`${fin[1]}${fin[2]}${fin[3]}` > `${ini[1]}${ini[2]}${ini[3]}`).toBe(true);
        });
      }),
    );
  });

  it("«a tiempo»: salida = inicio − tramo y nunca antes del fin de la parada anterior", () => {
    fc.assert(
      fc.property(arbParadas, arbOpciones, (paradas, op) => {
        const orden = ordenarParadasPorFranja(FRANJAS, paradas);
        const { tramos, horarios } = calcularTiemposDia(dia(paradas), op);
        for (const t of tramos) {
          const destino = horarios[t.hastaId];
          // Las que cruzan la medianoche no tienen «HH:MM» comparable con el reloj del día.
          if (destino.inicioMin >= 1440) continue;
          const salida = horaDeSalida(horaDeMinutos(destino.inicioMin), t.minutos, 0);
          expect(salida?.estado).toBe("a-tiempo");
          if (salida?.estado !== "a-tiempo") continue;
          expect(minutosDeHora(salida.salida)).toBe(destino.inicioMin - t.minutos);
          const previa = orden[orden.findIndex((p) => p.id === t.hastaId) - 1];
          expect(minutosDeHora(salida.salida)).toBeGreaterThanOrEqual(horarios[previa.id].finMin);
        }
      }),
    );
  });
});
