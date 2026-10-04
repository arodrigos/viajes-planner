import { describe, expect, it } from "vitest";
import { calcularPaseoDia, formatearKm, ordenarParadasPorFranja, ordenarParadasResueltas, type PuntoPaseo } from "../paseo";

// enc-ac2
describe("calcularPaseoDia (enc-ac2)", () => {
  it("3 paradas en línea con 2 km de recorrido real -> 2,6 km (factor 1,3)", () => {
    // 1 grado de latitud son ~111,32 km en cualquier longitud: dos tramos
    // de exactamente 1 km cada uno, moviendo solo la latitud.
    const UN_KM_EN_GRADOS = 1 / 111.32;
    const puntos: PuntoPaseo[] = [
      { id: "a", nombre: "A", lat: 40, lon: -3.6921 },
      { id: "b", nombre: "B", lat: 40 + UN_KM_EN_GRADOS, lon: -3.6921 },
      { id: "c", nombre: "C", lat: 40 + 2 * UN_KM_EN_GRADOS, lon: -3.6921 },
    ];
    const resultado = calcularPaseoDia(puntos, "familiar");
    expect(resultado).not.toBeNull();
    expect(resultado!.km).toBeCloseTo(2.6, 1);
  });

  it("menos de 2 paradas resueltas -> sin paseo (null)", () => {
    expect(calcularPaseoDia([], "familiar")).toBeNull();
    expect(calcularPaseoDia([{ id: "a", nombre: "A", lat: 0, lon: 0 }], "familiar")).toBeNull();
  });

  it("perfil familiar: por debajo de 8 km no hay aviso", () => {
    const puntos: PuntoPaseo[] = [
      { id: "a", nombre: "A", lat: 40.4138, lon: -3.6921 },
      { id: "b", nombre: "B", lat: 40.42, lon: -3.69 },
    ];
    const resultado = calcularPaseoDia(puntos, "familiar")!;
    expect(resultado.km).toBeLessThan(8);
    expect(resultado.aviso).toBeUndefined();
  });

  it("perfil familiar: por encima de 8 km, aviso con la parada más alejada", () => {
    // a-b: ~1 km; b-c: ~10 km -- c es la que más distancia aporta.
    const puntos: PuntoPaseo[] = [
      { id: "a", nombre: "Parada A", lat: 40.4, lon: -3.6 },
      { id: "b", nombre: "Parada B", lat: 40.41, lon: -3.6 },
      { id: "c", nombre: "Parada C", lat: 40.5, lon: -3.6 },
    ];
    const resultado = calcularPaseoDia(puntos, "familiar")!;
    expect(resultado.km).toBeGreaterThan(8);
    expect(resultado.aviso?.paradaId).toBe("c");
    expect(resultado.aviso?.texto).toContain("Parada C");
  });

  it("perfil no familiar usa el umbral de 12 km: 9,5 km no avisa", () => {
    // a-b y b-c de ~3,65 km cada uno (lineal) -> *1,3 ≈ 9,5 km total.
    const puntos: PuntoPaseo[] = [
      { id: "a", nombre: "A", lat: 40.4, lon: -3.6 },
      { id: "b", nombre: "B", lat: 40.433, lon: -3.6 },
      { id: "c", nombre: "C", lat: 40.466, lon: -3.6 },
    ];
    const resultado = calcularPaseoDia(puntos, "pareja")!;
    expect(resultado.km).toBeCloseTo(9.5, 0);
    expect(resultado.aviso).toBeUndefined();
  });

  it("perfil desconocido (null) cae en el umbral no familiar, el más permisivo", () => {
    const puntos: PuntoPaseo[] = [
      { id: "a", nombre: "A", lat: 40.4, lon: -3.6 },
      { id: "b", nombre: "B", lat: 40.47, lon: -3.6 },
    ];
    const familiarAvisa = calcularPaseoDia(puntos, "familiar")!.aviso !== undefined;
    const nullNoAvisa = calcularPaseoDia(puntos, null)!.aviso === undefined;
    expect(familiarAvisa).toBe(true);
    expect(nullNoAvisa).toBe(true);
  });
});

describe("ordenarParadasPorFranja / ordenarParadasResueltas", () => {
  const franjas = [
    { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" },
    { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  ];

  function parada(id: string, franja_id: string, coordenadas?: { lat: number; lon: number }) {
    return {
      id,
      franja_id,
      nombre: id,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" as const },
      coordenadas,
    };
  }

  it("ordena por el orden de las franjas declaradas, no por el orden de llegada de las paradas", () => {
    const paradas = [parada("p-tarde", "tarde"), parada("p-manana", "manana")];
    const orden = ordenarParadasPorFranja(franjas, paradas);
    expect(orden.map((p) => p.id)).toEqual(["p-tarde", "p-manana"]);
  });

  it("ordenarParadasResueltas descarta las paradas sin coordenadas", () => {
    const paradas = [parada("p-tarde", "tarde", { lat: 1, lon: 1 }), parada("p-manana", "manana")];
    const orden = ordenarParadasResueltas(franjas, paradas);
    expect(orden).toEqual([{ id: "p-tarde", nombre: "p-tarde", lat: 1, lon: 1 }]);
  });
});

describe("formatearKm", () => {
  it("usa coma decimal, una cifra", () => {
    expect(formatearKm(2.6)).toBe("2,6 km");
    expect(formatearKm(9.5)).toBe("9,5 km");
    expect(formatearKm(8)).toBe("8,0 km");
  });
});
