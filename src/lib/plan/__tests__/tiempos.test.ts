import { afterEach, describe, expect, it, vi } from "vitest";
import { aPlanPublico } from "../publico";
import { calcularTiemposDia, horaDeMinutos, TRAMO_SIN_UBICACION_MIN } from "../tiempos";
import type { Dia, Franja, Parada, Plan } from "../tipos";
import type { ProveedorTramos } from "../tramos";

const MANANA: Franja = { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" };
const COMIDA: Franja = { id: "comida", etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:30" };
const NOCHE: Franja = { id: "noche", etiqueta: "Noche", hora_inicio: "21:30", hora_fin: "23:30" };

// 1 grado de latitud son ~111,195 km en el modelo geodésico del repo.
const enLat = (km: number) => ({ lat: 40 + km / 111.195, lon: 0 });
const A = { lat: 40, lon: 0 };

function parada(id: string, duracion_min: number, coordenadas: { lat: number; lon: number } | undefined, franja_id = "manana"): Parada {
  return { id, franja_id, nombre: id, descripcion: "", duracion_min, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas };
}

const hh = (m: number) => horaDeMinutos(m);
const rango = (h: { inicioMin: number; finMin: number }) => `${hh(h.inicioMin)}–${hh(h.finMin)}`;

const AMIGOS = { perfil: "amigos", transporte: ["transporte-publico"] };

describe("calcularTiemposDia: un solo modelo (tie-ac1)", () => {
  const dia = { franjas: [MANANA], paradas: [parada("a", 90, A), parada("b", 60, enLat(1))] };

  it("cp-tie-01-pie-1km: 1 km en línea recta, a pie, 20 min; el hueco es el tramo", () => {
    const { tramos, horarios } = calcularTiemposDia(dia, AMIGOS);
    expect(tramos).toHaveLength(1);
    expect(tramos[0]).toMatchObject({ desdeId: "a", hastaId: "b", km: 1.3, modo: "a-pie", minutos: 20, fuente: "estimacion" });
    expect(rango(horarios.a)).toBe("09:00–10:30");
    expect(rango(horarios.b)).toBe("10:50–11:50");
  });

  it("perfil familiar: 3,5 km/h → 25 min y B a las 10:55", () => {
    const { tramos, horarios } = calcularTiemposDia(dia, { perfil: "familiar" });
    expect(tramos[0].minutos).toBe(25);
    expect(rango(horarios.b)).toBe("10:55–11:55");
  });

  it("mismas coordenadas: 0 km y 5 min (el mínimo)", () => {
    const { tramos, horarios } = calcularTiemposDia({ franjas: [MANANA], paradas: [parada("a", 60, A), parada("b", 30, A)] }, AMIGOS);
    expect(tramos[0]).toMatchObject({ km: 0, minutos: 5 });
    expect(horarios.b.inicioMin - horarios.a.finMin).toBe(5);
  });

  it("aPlanPublico da el mismo rango y el mismo tramo que calcularTiemposDia", () => {
    const plan = planDe({ franjas: [MANANA], paradas: dia.paradas });
    const publico = aPlanPublico(plan, "amigos", null, ["transporte-publico"]);
    expect(publico.dias[0].paradas[1].horario).toMatchObject({ inicio: "10:50", fin: "11:50", recortada: false });
    expect(publico.dias[0].tramos?.[0].minutos).toBe(20);
  });
});

describe("calcularTiemposDia: modo del tramo (tie-ac2)", () => {
  const dia = { franjas: [MANANA], paradas: [parada("b", 60, A), parada("c", 30, enLat(3))] };

  it("cp-tie-02-transporte-3km: el horario cuenta el transporte, no andar", () => {
    const { tramos, horarios } = calcularTiemposDia({ franjas: [{ ...MANANA, hora_inicio: "10:50" }], paradas: dia.paradas }, AMIGOS);
    expect(tramos[0]).toMatchObject({ km: 3.9, modo: "transporte-publico", minutos: 25 });
    expect(rango(horarios.c)).toBe("12:15–12:45");
  });

  it("solo coche: modo coche y 15 min", () => {
    const { tramos } = calcularTiemposDia(dia, { perfil: "amigos", transporte: ["coche"] });
    expect(tramos[0]).toMatchObject({ modo: "coche", minutos: 15 });
  });

  it("1,5 km tras redondear con perfil familiar sigue siendo a pie", () => {
    const { tramos } = calcularTiemposDia({ franjas: [MANANA], paradas: [parada("a", 10, A), parada("b", 10, enLat(1.5 / 1.3))] }, { perfil: "familiar" });
    expect(tramos[0]).toMatchObject({ km: 1.5, modo: "a-pie" });
  });
});

describe("calcularTiemposDia: parada que no cabe (tie-ac5)", () => {
  it("cp-tie-05-recortada: conserva su duración y cuantifica el exceso", () => {
    const dia = { franjas: [MANANA], paradas: [parada("a", 180, A), parada("b", 90, enLat(1)), parada("c", 30, enLat(1))] };
    const { horarios } = calcularTiemposDia(dia, { perfil: "amigos" });
    expect(horarios.b).toMatchObject({ recortada: true, excesoMin: 50 });
    expect(rango(horarios.b)).toBe("12:20–13:50");
    expect(rango(horarios.c)).toBe("13:55–14:25");
    expect(horarios.c.excesoMin).toBe(85);
  });

  it("cruzando la medianoche los minutos internos pasan de 1440 y la hora sale módulo 24 h", () => {
    const dia = { franjas: [NOCHE], paradas: [parada("n1", 120, A, "noche"), parada("n2", 60, A, "noche")] };
    const { horarios } = calcularTiemposDia(dia, { perfil: "amigos" });
    expect(horarios.n2.finMin).toBeGreaterThan(1440);
    expect(rango(horarios.n2)).toBe("23:35–00:35");
    expect(horarios.n2.excesoMin).toBe(65);
  });
});

describe("calcularTiemposDia: entre franjas (tie-ac6)", () => {
  const base = [parada("a", 180, A), parada("b", 90, enLat(1))];

  it("cp-tie-06-frontera: la cadena continúa si la anterior acaba después de la hora de la franja", () => {
    const { tramos, horarios } = calcularTiemposDia({ franjas: [MANANA, COMIDA], paradas: [...base, parada("r", 60, enLat(1), "comida")] }, { perfil: "amigos" });
    expect(tramos[1].minutos).toBe(5);
    expect(rango(horarios.r)).toBe("13:55–14:55");
  });

  it("si B acabase a las 12:00, R empezaría a las 13:00", () => {
    const { horarios } = calcularTiemposDia({ franjas: [MANANA, COMIDA], paradas: [parada("a", 60, A), parada("r", 60, A, "comida")] }, { perfil: "amigos" });
    expect(hh(horarios.r.inicioMin)).toBe("13:00");
  });
});

describe("calcularTiemposDia: paradas sin ubicar (tie-ac7)", () => {
  it("15 min a cada lado, sin conector y sin tramo que la salte", () => {
    const dia = { franjas: [MANANA], paradas: [parada("a", 60, A), parada("b", 30, undefined), parada("c", 30, enLat(1))] };
    const { tramos, horarios } = calcularTiemposDia(dia, { perfil: "amigos" });
    expect(TRAMO_SIN_UBICACION_MIN).toBe(15);
    expect(tramos).toEqual([]);
    expect([rango(horarios.a), rango(horarios.b), rango(horarios.c)]).toEqual(["09:00–10:00", "10:15–10:45", "11:00–11:30"]);
    const publico = aPlanPublico(planDe(dia), "amigos");
    expect(publico.dias[0].tramos).toBeUndefined();
    expect(publico.dias[0].paseo).toBeUndefined();
  });
});

describe("calcularTiemposDia: rutas reales y sin red (tie-ac8)", () => {
  const dia = { franjas: [MANANA], paradas: [parada("a", 90, A), parada("b", 60, enLat(1))] };
  const sinProveedor = calcularTiemposDia(dia, AMIGOS);

  afterEach(() => vi.unstubAllGlobals());

  it("cp-tie-08-proveedor: con minutos del proveedor, fuente 'ruta' y mismo redondeo", () => {
    const proveedor: ProveedorTramos = () => ({ minutos: 7 });
    const { tramos, horarios } = calcularTiemposDia(dia, { ...AMIGOS, proveedor });
    expect(tramos[0]).toMatchObject({ minutos: 10, fuente: "ruta" });
    expect(hh(horarios.b.inicioMin)).toBe("10:40");
  });

  it("proveedor que devuelve null o lanza: idéntico a sin proveedor y sin excepción", () => {
    expect(calcularTiemposDia(dia, { ...AMIGOS, proveedor: () => null })).toEqual(sinProveedor);
    const lanza: ProveedorTramos = () => {
      throw new Error("sin conexión");
    };
    expect(calcularTiemposDia(dia, { ...AMIGOS, proveedor: lanza })).toEqual(sinProveedor);
  });

  it("cp-tie-08-sin-red: el cálculo no toca fetch", () => {
    const fetchQueLanza = vi.fn(() => {
      throw new Error("el cálculo de tiempos no puede hacer red");
    });
    vi.stubGlobal("fetch", fetchQueLanza);
    const tres = { franjas: [MANANA], paradas: [parada("a", 30, A), parada("b", 30, enLat(1)), parada("c", 30, enLat(2))] };
    expect(calcularTiemposDia(tres, AMIGOS)).toEqual(calcularTiemposDia(tres, AMIGOS));
    expect(aPlanPublico(planDe(tres), "amigos").dias[0].tramos).toHaveLength(2);
    expect(fetchQueLanza).not.toHaveBeenCalled();
  });
});

describe("PlanPublico no expone la cadena interna (tie-ac10)", () => {
  it("no contiene horas de franja ni minutos internos", () => {
    const dia = { franjas: [MANANA, COMIDA], paradas: [parada("a", 180, A), parada("b", 90, enLat(1)), parada("r", 60, enLat(1), "comida")] };
    const json = JSON.stringify(aPlanPublico(planDe(dia), "amigos"));
    for (const prohibido of ["hora_inicio", "hora_fin", "inicioMin", "finMin", "excesoMin"]) expect(json).not.toContain(prohibido);
  });
});

function planDe(dia: Pick<Dia, "franjas" | "paradas">): Plan {
  return { id: "plan-tiempos", version: 1, destino: "Lisboa", personas: 2, dias: [{ fecha: "2026-11-02", ...dia }] } as Plan;
}
