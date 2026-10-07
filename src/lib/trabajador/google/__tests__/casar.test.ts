import { describe, expect, it } from "vitest";
import {
  buscarEnGoogle,
  elegirCoincidencia,
  MASCARA_CAMPOS,
  necesitaCasado,
  rectanguloAlrededor,
  umbralCasadoM,
  type FilaExistente,
} from "../casar";

const ANCLA = { lat: 51.5194, lon: -0.127 };

describe("elegirCoincidencia", () => {
  it("acepta el primer resultado dentro del umbral, aunque haya uno anterior fuera", () => {
    const elegido = elegirCoincidencia(ANCLA, 300, [
      { id: "lejos", location: { latitude: 51.55, longitude: -0.127 } },
      { id: "cerca", location: { latitude: 51.5195, longitude: -0.1271 } },
    ]);
    expect(elegido).toBe("cerca");
  });

  it("no acepta nada si el único resultado está a 2 km, ni uno sin ubicación", () => {
    expect(elegirCoincidencia(ANCLA, 300, [{ id: "a", location: { latitude: 51.5374, longitude: -0.127 } }])).toBeNull();
    expect(elegirCoincidencia(ANCLA, 300, [{ id: "sin-ubicacion" }])).toBeNull();
    expect(elegirCoincidencia(ANCLA, 300, [])).toBeNull();
  });
});

describe("umbralCasadoM", () => {
  it("da más margen a los sitios extensos que a los puntuales", () => {
    expect(umbralCasadoM("parque")).toBeGreaterThan(umbralCasadoM("museo"));
    expect(umbralCasadoM(null)).toBe(umbralCasadoM("museo"));
  });
});

describe("rectanguloAlrededor", () => {
  it("contiene el ancla y es simétrico", () => {
    const r = rectanguloAlrededor(ANCLA, 300);
    expect(r.low.latitude).toBeLessThan(ANCLA.lat);
    expect(r.high.latitude).toBeGreaterThan(ANCLA.lat);
    expect(r.low.longitude).toBeLessThan(ANCLA.lon);
    expect(r.high.longitude).toBeGreaterThan(ANCLA.lon);
    expect(ANCLA.lat - r.low.latitude).toBeCloseTo(r.high.latitude - ANCLA.lat, 9);
  });
});

describe("necesitaCasado", () => {
  const ahora = new Date("2026-10-07T12:00:00Z");
  const fila = (estado: FilaExistente["estado"], comprobado_en: string): FilaExistente => ({ clave: "osm:node/1", estado, comprobado_en });

  it("sin fila, obsoleto y error se vuelven a casar", () => {
    expect(necesitaCasado(undefined, ahora)).toBe(true);
    expect(necesitaCasado(fila("obsoleto", "2026-10-07T11:00:00Z"), ahora)).toBe(true);
    expect(necesitaCasado(fila("error", "2026-10-07T11:00:00Z"), ahora)).toBe(true);
  });

  it("sin-coincidencia espera 30 días y casado 12 meses", () => {
    expect(necesitaCasado(fila("sin-coincidencia", "2026-09-20T00:00:00Z"), ahora)).toBe(false);
    expect(necesitaCasado(fila("sin-coincidencia", "2026-09-01T00:00:00Z"), ahora)).toBe(true);
    expect(necesitaCasado(fila("casado", "2026-01-01T00:00:00Z"), ahora)).toBe(false);
    expect(necesitaCasado(fila("casado", "2025-09-01T00:00:00Z"), ahora)).toBe(true);
  });
});

describe("buscarEnGoogle", () => {
  it("manda la clave y la máscara en cabeceras, nunca en la URL, y el rectángulo contiene el ancla", async () => {
    let url = "";
    let init: RequestInit = {};
    const peticion = async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ places: [{ id: "x" }] }), { status: 200 });
    };
    const resultados = await buscarEnGoogle(peticion, "clave-secreta-de-prueba", "British Museum, Londres", ANCLA, 300);
    expect(resultados).toEqual([{ id: "x" }]);
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(url).not.toContain("key=");
    const cabeceras = init.headers as Record<string, string>;
    expect(cabeceras["X-Goog-Api-Key"]).toBe("clave-secreta-de-prueba");
    expect(cabeceras["X-Goog-FieldMask"]).toBe(MASCARA_CAMPOS);
    expect(MASCARA_CAMPOS).toBe("places.id,places.location");
    const cuerpo = JSON.parse(init.body as string);
    expect(cuerpo.textQuery).toBe("British Museum, Londres");
    expect(cuerpo.locationRestriction.rectangle.low.latitude).toBeLessThan(ANCLA.lat);
  });

  it("un error HTTP lanza sin la clave ni la URL en el mensaje", async () => {
    const peticion = async () => new Response("detalle con clave-secreta-de-prueba", { status: 403 });
    const fallo = await buscarEnGoogle(peticion, "clave-secreta-de-prueba", "x", ANCLA, 300).catch((e: Error) => e);
    expect(fallo).toBeInstanceOf(Error);
    expect((fallo as Error).message).toBe("Text Search respondió 403");
    expect((fallo as Error).message).not.toContain("clave-secreta-de-prueba");
  });
});
