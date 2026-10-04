import { describe, expect, it } from "vitest";
import { calcularApertura, calcularEtiquetasEncaje, formatearEtiquetasEncaje, vecinosResueltos } from "../encaje";

// enc-ac1
describe("calcularApertura (enc-ac1)", () => {
  const FECHA_MARTES = "2026-10-06"; // martes real
  const FECHA_MIERCOLES = "2026-10-07";

  it("'Mo-Su 10:00-20:00; Tu off' con franja mañana (09:00) de un martes -> cerrada", () => {
    expect(calcularApertura("Mo-Su 10:00-20:00; Tu off", FECHA_MARTES, "09:00")).toBe("cerrada");
  });

  it("la misma regla un miércoles por la mañana (10:00) -> abierta", () => {
    expect(calcularApertura("Mo-Su 10:00-20:00; Tu off", FECHA_MIERCOLES, "10:00")).toBe("abierta");
  });

  it("sin etiqueta opening_hours -> horario desconocido", () => {
    expect(calcularApertura(undefined, FECHA_MARTES, "09:00")).toBe("desconocida");
  });

  it("'24/7' -> siempre abierta", () => {
    expect(calcularApertura("24/7", FECHA_MARTES, "03:00")).toBe("abierta");
  });

  it("una etiqueta que la librería no sabe interpretar -> desconocida, nunca lanza", () => {
    expect(calcularApertura("esto no es un horario válido de OSM @@@", FECHA_MARTES, "09:00")).toBe("desconocida");
  });
});

describe("calcularEtiquetasEncaje / formatearEtiquetasEncaje (enc-ac1)", () => {
  const parada = { categoria: "museo" as const, duracion_min: 90 };

  it("incluye distancia a la parada anterior y a la siguiente, redondeadas a 50 m", () => {
    const etiquetas = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "museo", duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      coordenadasAnterior: { lat: 40.4138, lon: -3.6963 }, // ~357 m -> 350
      coordenadasSiguiente: { lat: 40.4138, lon: -3.6880 }, // ~345 m -> 350
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(etiquetas.distanciaAnteriorM).toBeGreaterThanOrEqual(300);
    expect(etiquetas.distanciaAnteriorM! % 50).toBe(0);
    expect(etiquetas.distanciaSiguienteM! % 50).toBe(0);

    const textos = formatearEtiquetasEncaje(etiquetas);
    expect(textos).toContain(`A ${etiquetas.distanciaAnteriorM} m de la parada anterior`);
    expect(textos).toContain(`A ${etiquetas.distanciaSiguienteM} m de la siguiente parada`);
  });

  it("sin vecino resuelto en un lado, omite esa etiqueta sin fallar", () => {
    const etiquetas = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "museo", duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(etiquetas.distanciaAnteriorM).toBeUndefined();
    expect(etiquetas.distanciaSiguienteM).toBeUndefined();
    const textos = formatearEtiquetasEncaje(etiquetas);
    expect(textos.some((t) => t.includes("parada anterior"))).toBe(false);
    expect(textos.some((t) => t.includes("siguiente parada"))).toBe(false);
  });

  it("misma categoría -> etiqueta 'Misma categoría (museo)'", () => {
    const etiquetas = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "museo", duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(formatearEtiquetasEncaje(etiquetas)).toContain("Misma categoría (museo)");
  });

  it("categoría distinta -> sin etiqueta de categoría", () => {
    const etiquetas = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "parque", duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(etiquetas.categoria).toBeUndefined();
    expect(formatearEtiquetasEncaje(etiquetas).some((t) => t.startsWith("Misma categoría"))).toBe(false);
  });

  it("duración dentro de ±30 % -> 'Duración similar'; fuera -> ausente", () => {
    const dentro = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "museo", duracion_min: 100, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(formatearEtiquetasEncaje(dentro)).toContain("Duración similar");

    const fuera = calcularEtiquetasEncaje({
      parada,
      alternativa: { categoria: "museo", duracion_min: 45, coordenadas: { lat: 40.4138, lon: -3.6921 } },
      fecha: "2026-10-07",
      horaInicioFranja: "09:00",
    });
    expect(formatearEtiquetasEncaje(fuera)).not.toContain("Duración similar");
  });

  it("apertura 'cerrada' -> etiqueta 'Cerrado a esa hora'; 'abierta' -> 'Abre a esa hora'; desconocida -> 'Horario desconocido'", () => {
    const base = { parada, fecha: "2026-10-06", horaInicioFranja: "09:00" };

    const cerrada = calcularEtiquetasEncaje({
      ...base,
      alternativa: {
        categoria: "museo",
        duracion_min: 90,
        coordenadas: { lat: 40.4138, lon: -3.6921 },
        lugar: {
          fuente: "osm",
          id: "osm:node/1",
          url: "https://www.openstreetmap.org/node/1",
          nombre_fuente: "x",
          etiquetas: { opening_hours: "Mo-Su 10:00-20:00; Tu off" },
          resuelto_en: "2026-10-01T00:00:00Z",
        },
      },
    });
    expect(formatearEtiquetasEncaje(cerrada)).toContain("Cerrado a esa hora");

    const abierta = calcularEtiquetasEncaje({
      ...base,
      alternativa: {
        categoria: "museo",
        duracion_min: 90,
        coordenadas: { lat: 40.4138, lon: -3.6921 },
        lugar: {
          fuente: "osm",
          id: "osm:node/1",
          url: "https://www.openstreetmap.org/node/1",
          nombre_fuente: "x",
          etiquetas: { opening_hours: "24/7" },
          resuelto_en: "2026-10-01T00:00:00Z",
        },
      },
    });
    expect(formatearEtiquetasEncaje(abierta)).toContain("Abre a esa hora");

    const desconocida = calcularEtiquetasEncaje({
      ...base,
      alternativa: { categoria: "museo", duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } },
    });
    expect(formatearEtiquetasEncaje(desconocida)).toContain("Horario desconocido");
  });
});

describe("vecinosResueltos (enc-ac1)", () => {
  const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];

  function parada(id: string, coordenadas?: { lat: number; lon: number }) {
    return {
      id,
      franja_id: "manana",
      nombre: id,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" as const },
      coordenadas,
    };
  }

  it("encuentra la parada resuelta anterior y la siguiente en el orden del día", () => {
    const dia = {
      fecha: "2026-10-07",
      franjas,
      paradas: [
        parada("a", { lat: 1, lon: 1 }),
        parada("b"), // sin resolver -- hay que saltarla
        parada("c", { lat: 2, lon: 2 }),
        parada("d", { lat: 3, lon: 3 }),
      ],
    };
    expect(vecinosResueltos(dia, "b")).toEqual({ anterior: { lat: 1, lon: 1 }, siguiente: { lat: 2, lon: 2 } });
    expect(vecinosResueltos(dia, "a")).toEqual({ siguiente: { lat: 2, lon: 2 } });
    expect(vecinosResueltos(dia, "d")).toEqual({ anterior: { lat: 2, lon: 2 } });
  });

  it("una parada que no existe en el día no da vecinos", () => {
    const dia = { fecha: "2026-10-07", franjas, paradas: [parada("a", { lat: 1, lon: 1 })] };
    expect(vecinosResueltos(dia, "ninguna")).toEqual({});
  });
});
