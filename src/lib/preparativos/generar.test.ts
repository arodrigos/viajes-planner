import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOGO_PREPARATIVOS, IDS_PREPARATIVOS } from "./catalogo";
import { entradaDesdePlan } from "./entrada";
import { generarPreparativos } from "./generar";
import type { EntradaPreparativos } from "./tipos";

const roma: EntradaPreparativos = {
  personas: [{ edad: 1 }, { edad: 6 }, { edad: 38 }, { edad: 40 }],
  perfil: "familiar",
  fechas: { modo: "fechas", inicio: "2027-07-03", fin: "2027-07-09" },
  dias: 7,
  latitud: 41.9,
  pais: "IT",
  transporte: ["avion"],
  tiposReserva: ["vuelo", "hotel"],
};
const ids = (e: EntradaPreparativos) => generarPreparativos(e).map((x) => x.id);

describe("pre-ac1 familia de referencia (Roma, julio)", () => {
  it("trae lo que pide su situación y nada que no aplique", () => {
    const lista = generarPreparativos(roma);
    const i = lista.map((x) => x.id);
    for (const id of ["panales", "toallitas", "carrito-o-mochila", "entretenimiento-trayecto", "documentos-menores", "protector-solar", "tarjetas-embarque", "liquidos-cabina", "descargar-mapas"]) {
      expect(i).toContain(id);
    }
    for (const id of ["abrigo", "silla-coche", "confirmar-alojamiento", "adaptador-enchufe"]) {
      expect(i).not.toContain(id);
    }
    expect(lista.find((x) => x.id === "panales")?.porque).toContain("1 año");
  });
});

describe("pre-ac2 degradación a genérico", () => {
  it("época en texto: sin estacionales y con ropa-tiempo-destino", () => {
    const i = ids({ ...roma, fechas: { modo: "epoca", epoca: "puente de mayo" } });
    expect(i).not.toContain("protector-solar");
    expect(i).not.toContain("abrigo");
    expect(i).toContain("ropa-tiempo-destino");
  });
  it("sin país: comprobar-enchufe y no adaptador", () => {
    const i = ids({ ...roma, pais: null });
    expect(i).toContain("comprobar-enchufe");
    expect(i).not.toContain("adaptador-enchufe");
  });
  it("hemisferio sur: julio es invierno y el adaptador nombra el tipo I", () => {
    const lista = generarPreparativos({ ...roma, latitud: -34.6, pais: "AR" });
    const i = lista.map((x) => x.id);
    expect(i).toContain("abrigo");
    expect(i).not.toContain("protector-solar");
    expect(lista.find((x) => x.id === "adaptador-enchufe")?.texto).toContain("tipo I");
  });
});

describe("pre-ac3 lo normativo no induce a error", () => {
  it("nunca hay permiso de viaje como elemento y documentos-menores lo cita solo como condición", () => {
    expect(IDS_PREPARATIVOS.has("permiso-viaje")).toBe(false);
    const doc = generarPreparativos(roma).find((x) => x.id === "documentos-menores");
    expect(doc?.texto).toContain("DNI o pasaporte en vigor de cada niño");
    expect(doc?.porque).toContain("si alguno viajara sin sus padres");
  });
  it("lo normativo y sanitario lleva fuente con fecha de revisión", () => {
    for (const id of ["documentos-menores", "botiquin", "dosificador-infantil"]) {
      const e = CATALOGO_PREPARATIVOS.find((x) => x.id === id);
      expect(e?.fuente?.url).toMatch(/^https:\/\//);
      expect(e?.fuente?.revisado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("pre-ac4 entradaDesdePlan", () => {
  const criterios = {
    destino_o_tipo: "CENTINELA",
    fechas: roma.fechas,
    dias: 7,
    personas: roma.personas,
    perfil: "familiar" as const,
    presupuesto_eur: 1000,
    alojamiento: { direccion: "CENTINELA calle" },
    transporte: ["avion"] as const,
  };
  const reservas = [{ tipo: "vuelo" as const, nombre: "CENTINELA", localizador: "CENTINELA", notas: "CENTINELA" }];
  it("no deja pasar texto libre y deja a null lo que el plan no trae", () => {
    const e = entradaDesdePlan({ criterios: criterios as never, ciudad: undefined }, reservas);
    expect(JSON.stringify(e)).not.toContain("CENTINELA");
    expect(e.latitud).toBeNull();
    expect(e.pais).toBeNull();
    expect(e.tiposReserva).toEqual(["vuelo"]);
    expect(e.transporte).toEqual(["avion"]);
  });
  it("toma la latitud del centro de la caja de la ciudad", () => {
    const e = entradaDesdePlan(
      { criterios: criterios as never, ciudad: { estado: "resuelta", intentado_en: "x", caja: { minLat: 41, maxLat: 43, minLon: 12, maxLon: 13 } } },
      [],
    );
    expect(e.latitud).toBe(42);
  });
});

describe("pre-ac5 la lista reacciona a las reservas", () => {
  it("vuelo añade embarque y líquidos con su porqué; hotel quita confirmar-alojamiento", () => {
    const base = { ...roma, transporte: [], tiposReserva: [] } as EntradaPreparativos;
    expect(ids(base)).not.toContain("tarjetas-embarque");
    expect(ids(base)).toContain("confirmar-alojamiento");
    const conVuelo = generarPreparativos({ ...base, tiposReserva: ["vuelo"] });
    expect(conVuelo.find((x) => x.id === "tarjetas-embarque")?.porque).toContain("tienes un vuelo apuntado en Reservas");
    expect(conVuelo.find((x) => x.id === "confirmar-alojamiento")?.porque).toContain("no has apuntado ningún hotel");
    expect(ids({ ...base, tiposReserva: ["hotel"] })).not.toContain("confirmar-alojamiento");
  });
});

const entradaArb = fc.record({
  personas: fc.array(fc.record({ edad: fc.integer({ min: 0, max: 90 }) }), { maxLength: 8 }),
  perfil: fc.constantFrom("familiar", "amigos", "pareja", "solo"),
  fechas: fc.oneof(
    fc.record({ modo: fc.constant("fechas" as const), inicio: fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 })).map(([m, d]) => `2027-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`), fin: fc.constant("2028-01-02") }),
    fc.record({ modo: fc.constant("epoca" as const), epoca: fc.string({ maxLength: 20 }) }),
  ),
  dias: fc.integer({ min: 1, max: 30 }),
  latitud: fc.option(fc.double({ min: -80, max: 80, noNaN: true }), { nil: null }),
  pais: fc.option(fc.constantFrom("IT", "AR", "GB", "US", "ZZ"), { nil: null }),
  transporte: fc.subarray(["coche", "avion", "tren", "autobus"] as const),
  tiposReserva: fc.subarray(["vuelo", "tren", "hotel", "entrada"] as const),
}) as fc.Arbitrary<EntradaPreparativos>;

describe("invariantes (property tests)", () => {
  it("ids únicos, del catálogo, deterministas, con texto y sin permiso-viaje", () => {
    fc.assert(
      fc.property(entradaArb, (e) => {
        const a = generarPreparativos(e);
        const idsA = a.map((x) => x.id);
        expect(new Set(idsA).size).toBe(idsA.length);
        expect(idsA.every((id) => IDS_PREPARATIVOS.has(id))).toBe(true);
        expect(generarPreparativos(e)).toEqual(a);
        expect(a.every((x) => x.texto.trim() && x.porque.trim())).toBe(true);
        expect(idsA).not.toContain("permiso-viaje");
        expect(a.length).toBeLessThanOrEqual(CATALOGO_PREPARATIVOS.length);
      }),
    );
  });
  it("sin bebés no hay elementos de bebé; sin menores no hay niños ni documentos-menores", () => {
    fc.assert(
      fc.property(entradaArb, (e) => {
        const i = ids(e);
        if (!e.personas.some((p) => p.edad < 3)) {
          for (const b of ["panales", "toallitas", "cambiador", "carrito-o-mochila"]) expect(i).not.toContain(b);
        }
        if (!e.personas.some((p) => p.edad < 18)) {
          expect(generarPreparativos(e).some((x) => x.categoria === "ninos")).toBe(false);
          expect(i).not.toContain("documentos-menores");
        }
        if (e.fechas.modo === "epoca") {
          for (const s of ["protector-solar", "gorra", "abrigo", "guantes", "chubasquero"]) expect(i).not.toContain(s);
        }
      }),
    );
  });
  it("cambiar edades no cambia id ni categoría de lo que sigue apareciendo", () => {
    fc.assert(
      fc.property(entradaArb, entradaArb, (a, b) => {
        const mezcla = { ...a, personas: b.personas };
        const A = generarPreparativos(a);
        for (const x of generarPreparativos(mezcla)) {
          const y = A.find((z) => z.id === x.id);
          if (y) expect(y.categoria).toBe(x.categoria);
        }
      }),
    );
  });
});
