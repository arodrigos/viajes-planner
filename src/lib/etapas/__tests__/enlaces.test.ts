import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enlacesTransporte } from "../enlaces";
import { MODOS_TRANSPORTE } from "@/lib/criterios/tipos";
import { contieneParametrosAfiliacion } from "@/lib/sin-afiliacion";

const tramo = (modo: "coche" | "avion" | "tren" | "autobus", desde = "Lisboa", hasta = "Oporto") => ({ desde, hasta, modo });

describe("enlacesTransporte (cp-etv-03)", () => {
  it("tren: búsqueda con fecha y Google Maps en transporte público, sin más parámetros", () => {
    const [busqueda, mapa] = enlacesTransporte(tramo("tren"), "2027-06-12", { origen: "Portugal", destino: "Portugal" });
    expect(busqueda.etiqueta).toBe("Buscar tren Lisboa → Oporto");
    expect(busqueda.href.startsWith("https://www.google.com/search?q=")).toBe(true);
    const q = new URL(busqueda.href);
    expect([...q.searchParams.keys()]).toEqual(["q"]);
    expect(q.searchParams.get("q")).toBe("tren Lisboa Oporto 2027-06-12");
    expect(mapa.etiqueta).toBe("Ver en Google Maps en transporte público");
    const m = new URL(mapa.href);
    expect(m.origin + m.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(m.searchParams)).toEqual({ api: "1", origin: "Lisboa, Portugal", destination: "Oporto, Portugal", travelmode: "transit" });
  });

  it("avión: un solo enlace a Google Flights con la fecha de llegada", () => {
    const enlaces = enlacesTransporte(tramo("avion", "Barcelona", "Lisboa"), "2027-06-12");
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].etiqueta).toBe("Buscar vuelos Barcelona → Lisboa");
    expect(enlaces[0].href.startsWith("https://www.google.com/travel/flights?q=")).toBe(true);
    expect(new URL(enlaces[0].href).searchParams.get("q")).toBe("Flights to Lisboa from Barcelona on 2027-06-12");
  });

  it("autobús dice «autobús» y coche no tiene enlaces", () => {
    expect(enlacesTransporte(tramo("autobus"), "2027-06-12")[0].etiqueta).toBe("Buscar autobús Lisboa → Oporto");
    expect(enlacesTransporte(tramo("coche"), "2027-06-12")).toEqual([]);
  });

  it("en modo época (sin fecha) el q va sin fecha", () => {
    expect(new URL(enlacesTransporte(tramo("tren"), undefined)[0].href).searchParams.get("q")).toBe("tren Lisboa Oporto");
    expect(new URL(enlacesTransporte(tramo("tren"), "verano")[0].href).searchParams.get("q")).toBe("tren Lisboa Oporto");
  });

  it("una ciudad con «&» y «#» queda dentro de q sin añadir parámetros", () => {
    const [busqueda] = enlacesTransporte(tramo("tren", "Sant Feliu & Co #2", "Oporto"), "2027-06-12");
    const url = new URL(busqueda.href);
    expect(url.host).toBe("www.google.com");
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe("tren Sant Feliu & Co #2 Oporto 2027-06-12");
    expect(url.hash).toBe("");
  });

  it("ningún enlace lleva parámetros de afiliación", () => {
    for (const modo of MODOS_TRANSPORTE) for (const e of enlacesTransporte(tramo(modo), "2027-06-12")) expect(contieneParametrosAfiliacion(e.href)).toBe(false);
  });
});

describe("enlacesTransporte: invariantes", () => {
  const nombre = fc.string({ unit: "grapheme", minLength: 1, maxLength: 30 });
  const modo = fc.constantFrom(...MODOS_TRANSPORTE);
  const fecha = fc.option(fc.date({ min: new Date("2025-01-01"), max: new Date("2035-12-31"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)), { nil: undefined });

  it("para cualquier par de nombres: https, host de Google, nombres y fecha literales, solo los parámetros permitidos", () => {
    fc.assert(
      fc.property(nombre, nombre, modo, fecha, (desde, hasta, m, f) => {
        for (const enlace of enlacesTransporte({ desde, hasta, modo: m }, f)) {
          const url = new URL(enlace.href);
          expect(url.protocol).toBe("https:");
          expect(url.host).toBe("www.google.com");
          const claves = [...url.searchParams.keys()].sort();
          const esMapa = url.pathname.startsWith("/maps/");
          expect(claves).toEqual(esMapa ? ["api", "destination", "origin", "travelmode"] : ["q"]);
          const texto = esMapa ? `${url.searchParams.get("origin")}|${url.searchParams.get("destination")}` : (url.searchParams.get("q") ?? "");
          expect(texto).toContain(desde);
          expect(texto).toContain(hasta);
          if (f && !esMapa) expect(texto).toContain(f);
        }
      }),
    );
  });

  it("coche: 0 enlaces; avión: 1; tren y autobús: 2", () => {
    fc.assert(
      fc.property(nombre, nombre, modo, (desde, hasta, m) => {
        const esperado = { coche: 0, avion: 1, tren: 2, autobus: 2 }[m];
        expect(enlacesTransporte({ desde, hasta, modo: m }, "2027-06-12")).toHaveLength(esperado);
      }),
    );
  });
});
