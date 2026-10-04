import { describe, expect, it } from "vitest";
import { urlRecorridoDia, type PuntoRecorrido } from "../urlRecorridoDia";

// map-ac3: puntos ficticios en línea, solo para comprobar el partido en
// tramos y el contenido exacto de cada enlace -no representan un destino
// real.
function puntos(n: number): PuntoRecorrido[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 40 + i, lon: -3 - i }));
}

describe("urlRecorridoDia", () => {
  it("menos de 2 paradas resueltas no produce ningún enlace", () => {
    expect(urlRecorridoDia([])).toEqual([]);
    expect(urlRecorridoDia(puntos(1))).toEqual([]);
  });

  it("2 paradas: un único enlace sin waypoints intermedios", () => {
    const tramos = urlRecorridoDia(puntos(2));
    expect(tramos).toHaveLength(1);
    expect(tramos[0]).toEqual({
      etiqueta: "Abrir el recorrido en Google Maps",
      href: "https://www.google.com/maps/dir/?api=1&origin=40,-3&destination=41,-4&travelmode=walking",
    });
  });

  it("5 paradas: un único enlace con los 3 waypoints intermedios", () => {
    const tramos = urlRecorridoDia(puntos(5));
    expect(tramos).toHaveLength(1);
    expect(tramos[0]).toEqual({
      etiqueta: "Abrir el recorrido en Google Maps",
      href: "https://www.google.com/maps/dir/?api=1&origin=40,-3&destination=44,-7&waypoints=41,-4|42,-5|43,-6&travelmode=walking",
    });
  });

  it("6 paradas: se parte en dos tramos que comparten la parada de unión", () => {
    const tramos = urlRecorridoDia(puntos(6));
    expect(tramos).toHaveLength(2);
    expect(tramos[0].etiqueta).toBe("Tramo 1: paradas 1–5");
    expect(tramos[0].href).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=40,-3&destination=44,-7&waypoints=41,-4|42,-5|43,-6&travelmode=walking",
    );
    expect(tramos[1].etiqueta).toBe("Tramo 2: paradas 5–6");
    expect(tramos[1].href).toBe("https://www.google.com/maps/dir/?api=1&origin=44,-7&destination=45,-8&travelmode=walking");
  });

  it("9 paradas: dos tramos de 5 paradas cada uno, 1–5 y 5–9, como describe el diseño", () => {
    const tramos = urlRecorridoDia(puntos(9));
    expect(tramos).toHaveLength(2);
    expect(tramos[0].etiqueta).toBe("Tramo 1: paradas 1–5");
    expect(tramos[1].etiqueta).toBe("Tramo 2: paradas 5–9");
    for (const tramo of tramos) {
      // Ningún waypoint intermedio pasa de 3.
      const waypoints = tramo.href.match(/waypoints=([^&]*)/)?.[1]?.split("|") ?? [];
      expect(waypoints.length).toBeLessThanOrEqual(3);
    }
  });

  it("ninguna URL lleva nada que no sea dígitos, signo, coma, punto, barra vertical o los parámetros literales", () => {
    for (const tramo of urlRecorridoDia(puntos(9))) {
      const resto = tramo.href.replace(
        /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=|&destination=|&waypoints=|&travelmode=walking$/g,
        "|",
      );
      // Tras quitar los parámetros literales, solo quedan números, signos,
      // comas, puntos y barras verticales (separadores de puntos y tramos).
      expect(resto).toMatch(/^[\d,.|-]*$/);
    }
  });
});
