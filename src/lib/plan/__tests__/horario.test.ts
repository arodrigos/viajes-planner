import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { avisoRecortada, calcularHorarioDia, minutosDeHora, textoRango } from "../horario";
import { horaDeMinutos } from "../tiempos";
import type { Franja, Parada } from "../tipos";

const MANANA: Franja = { id: "manana", etiqueta: "Mañana", hora_inicio: "09:30", hora_fin: "13:30" };
const AMIGOS = { perfil: "amigos" };

function parada(id: string, duracion_min: number, coordenadas?: { lat: number; lon: number }, franja_id = "manana"): Parada {
  return { id, franja_id, nombre: id, descripcion: "", duracion_min, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas };
}

const kmEnLat = (km: number) => ({ lat: 40 + km / 111.195, lon: 0 });
const ORIGEN = { lat: 40, lon: 0 };

describe("calcularHorarioDia (hor-ac1, tiempos-unicos)", () => {
  it("encadena inicio + duración + el tramo que pinta el conector", () => {
    const dia = { franjas: [MANANA], paradas: [parada("a", 90, ORIGEN), parada("b", 60, kmEnLat(1))] };
    const h = calcularHorarioDia(dia, AMIGOS);
    expect(textoRango(h.a)).toBe("09:30 – 11:00");
    // 1 km en línea recta = 1,3 km de calle: 19,5 min a 4 km/h, 20 min redondeados.
    expect(textoRango(h.b)).toBe("11:20 – 12:20");
  });

  it("con perfil familiar se anda más despacio (3,5 km/h)", () => {
    const dia = { franjas: [MANANA], paradas: [parada("a", 60, ORIGEN), parada("b", 30, kmEnLat(1))] };
    expect(calcularHorarioDia(dia, { perfil: "familiar" }).b.inicio).toBe("10:55");
  });

  it("sin coordenadas en alguno de los dos extremos el desplazamiento son 15 min", () => {
    const h = calcularHorarioDia({ franjas: [MANANA], paradas: [parada("a", 60), parada("b", 30)] }, AMIGOS);
    expect(h.a).toEqual({ inicio: "09:30", fin: "10:30", recortada: false });
    expect(h.b.inicio).toBe("10:45");
  });

  it("#295: una parada que no cabe conserva su duración real y se marca recortada", () => {
    const h = calcularHorarioDia({ franjas: [MANANA], paradas: [parada("a", 120), parada("b", 120), parada("c", 30)] }, AMIGOS);
    expect(h.a.recortada).toBe(false);
    expect(h.b).toEqual({ inicio: "11:45", fin: "13:45", recortada: true });
    // Nunca un rango de duración cero: «13:30 – 13:30» ya no existe.
    expect(h.c).toEqual({ inicio: "14:00", fin: "14:30", recortada: true });
  });

  it("al cruzar la medianoche la hora sale módulo 24 h", () => {
    const noche: Franja = { id: "noche", etiqueta: "Noche", hora_inicio: "21:30", hora_fin: "23:30" };
    const h = calcularHorarioDia({ franjas: [noche], paradas: [parada("n1", 120, ORIGEN, "noche"), parada("n2", 60, ORIGEN, "noche")] }, AMIGOS);
    expect(textoRango(h.n2)).toBe("23:35 – 00:35");
  });

  it("la cadena continúa entre franjas si la anterior acaba después de la hora de inicio", () => {
    const comida: Franja = { id: "comida", etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:30" };
    const dia = { franjas: [MANANA, comida], paradas: [parada("a", 240, ORIGEN), parada("r", 60, ORIGEN, "comida")] };
    // a acaba a las 13:30; mismo punto: 5 min de tramo.
    expect(calcularHorarioDia(dia, AMIGOS).r.inicio).toBe("13:35");
    const corta = { franjas: [MANANA, comida], paradas: [parada("a", 30, ORIGEN), parada("r", 60, ORIGEN, "comida")] };
    expect(calcularHorarioDia(corta, AMIGOS).r.inicio).toBe("13:00");
  });

  it("avisoRecortada cuantifica el exceso", () => {
    expect(avisoRecortada("Mañana", 50)).toBe("Se pasa 50 min del final de la mañana");
  });
});

describe("calcularHorarioDia: invariantes de formato", () => {
  it("las horas son siempre HH:MM válidas módulo 24 h", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), (m) => {
        expect(horaDeMinutos(m)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(minutosDeHora(horaDeMinutos(m))).toBe(m % 1440);
      }),
    );
  });
});
