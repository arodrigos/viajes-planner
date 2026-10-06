import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enlacesDeParada, type ParadaConEnlaces } from "../enlacesParada";

const SIN_RESOLVER = { fuente: "propuesto-sin-verificar" } as const;
const HOSTS = ["www.google.com", "www.openstreetmap.org"];
const hostPermitido = (host: string) => HOSTS.includes(host) || host.endsWith(".wikipedia.org");

describe("enlacesDeParada (enl-ac1, cp-enl-01)", () => {
  it("con coordenadas el enlace de Maps lleva lat,lon exactos y la fuente OSM", () => {
    const enlaces = enlacesDeParada(
      {
        nombre: "Borough Market",
        coordenadas: { lat: 51.5055, lon: -0.091 },
        procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/1" },
      },
      "Londres",
    );
    expect(enlaces).toEqual([
      { etiqueta: "Ver en Google Maps", href: "https://www.google.com/maps/search/?api=1&query=51.5055,-0.091" },
      { etiqueta: "Fuente: OpenStreetMap", href: "https://www.openstreetmap.org/node/1" },
    ]);
  });

  it("sin resolver (la cena) solo lleva el mapa, por búsqueda con la ciudad", () => {
    const enlaces = enlacesDeParada({ nombre: "Cena en Dishoom Covent Garden", procedencia: SIN_RESOLVER }, "Londres");
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].etiqueta).toBe("Ver en Google Maps");
    expect(enlaces[0].href).toBe(
      "https://www.google.com/maps/search/?api=1&query=Cena%20en%20Dishoom%20Covent%20Garden%20Londres",
    );
  });

  it("Wikipedia resuelta enseña «Fuente: Wikipedia»", () => {
    const enlaces = enlacesDeParada(
      { nombre: "British Museum", coordenadas: { lat: 51.5194, lon: -0.127 }, procedencia: { fuente: "wikipedia", url: "https://en.wikipedia.org/wiki/British_Museum" } },
      "Londres",
    );
    expect(enlaces.map((e) => e.etiqueta)).toEqual(["Ver en Google Maps", "Fuente: Wikipedia"]);
  });

  it("«javascript:alert(1)» queda codificado dentro de https://www.google.com", () => {
    const [mapa] = enlacesDeParada({ nombre: "javascript:alert(1)", procedencia: SIN_RESOLVER }, "Londres");
    expect(mapa.href.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(mapa.href).toContain("javascript%3Aalert(1)");
  });

  it("descarta una URL de fuente que no es https ni del host de su fuente", () => {
    for (const url of ["javascript:alert(1)", "http://www.openstreetmap.org/node/1", "https://evil.example/x", "https://en.wikipedia.org.evil.example/x", "no es url", undefined]) {
      const enlaces = enlacesDeParada({ nombre: "X", procedencia: { fuente: "osm", url } }, "Y");
      expect(enlaces.map((e) => e.etiqueta)).toEqual(["Ver en Google Maps"]);
    }
    expect(enlacesDeParada({ nombre: "X", procedencia: { fuente: "wikipedia", url: "https://www.openstreetmap.org/node/1" } }, "Y")).toHaveLength(1);
  });
});

const arbitraryParada = fc.record({
  nombre: fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.constantFrom("javascript:alert(1)", 'a"b', "x\ny", "😀 Café", "https://otro.example")),
  coordenadas: fc.option(fc.record({ lat: fc.double({ min: -90, max: 90, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }) }), { nil: undefined }),
  procedencia: fc.oneof(
    fc.constant<ParadaConEnlaces["procedencia"]>(SIN_RESOLVER),
    fc.record({ fuente: fc.constantFrom("osm", "wikipedia"), url: fc.option(fc.oneof(fc.webUrl(), fc.string(), fc.constant("https://es.wikipedia.org/wiki/X"), fc.constant("https://www.openstreetmap.org/way/2")), { nil: undefined }) }),
  ),
}) as fc.Arbitrary<ParadaConEnlaces>;

describe("invariantes de enlacesDeParada", () => {
  it("siempre exactamente un «Ver en Google Maps», resuelta o no", () => {
    fc.assert(
      fc.property(arbitraryParada, fc.string(), (parada, ciudad) => {
        const enlaces = enlacesDeParada(parada, ciudad);
        expect(enlaces.filter((e) => e.etiqueta === "Ver en Google Maps")).toHaveLength(1);
      }),
    );
  });

  it("todo href es https:// y su host está en {www.google.com, www.openstreetmap.org, *.wikipedia.org}", () => {
    fc.assert(
      fc.property(arbitraryParada, fc.string(), (parada, ciudad) => {
        for (const { href } of enlacesDeParada(parada, ciudad)) {
          expect(href.startsWith("https://")).toBe(true);
          expect(hostPermitido(new URL(href).hostname)).toBe(true);
        }
      }),
    );
  });

  it("con coordenadas Maps lleva query=<lat>,<lon>; sin ellas, el nombre con encodeURIComponent", () => {
    fc.assert(
      fc.property(arbitraryParada, fc.string(), (parada, ciudad) => {
        const [mapa] = enlacesDeParada(parada, ciudad);
        if (parada.coordenadas) {
          expect(mapa.href).toContain(`query=${parada.coordenadas.lat},${parada.coordenadas.lon}`);
        } else {
          expect(mapa.href).toContain(encodeURIComponent(parada.nombre));
        }
      }),
    );
  });
});
