import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extraerFichas, limpiarTexto, MAX_TEXTO, parsearPrecioEur } from "../wikitexto";

function contenidoGrabado(nombre: string): string {
  const crudo = JSON.parse(readFileSync(join(process.cwd(), "fixtures/guia", nombre), "utf8")) as {
    query: { pages: Array<{ revisions: Array<{ slots: { main: { content: string } } }> }> };
  };
  return crudo.query.pages[0].revisions[0].slots.main.content;
}

describe("parsearPrecioEur (gui-ac1)", () => {
  it("lee «€10, under 12 free» como 10", () => {
    expect(parsearPrecioEur("€10, under 12 free")).toBe(10);
  });
  it("«free on Sundays» no es numérico", () => {
    expect(parsearPrecioEur("free on Sundays")).toBeUndefined();
  });
  it("«free» a secas es gratis", () => {
    expect(parsearPrecioEur("Free")).toBe(0);
  });
});

describe("extraerFichas con páginas grabadas", () => {
  it("cp-gui-01: ficha de los Jerónimos con «€10, under 12 free» → precio_eur 10", () => {
    const [f] = extraerFichas("{{see|name=Jerónimos Monastery|price=€10, under 12 free|content=Gótico manuelino.}}");
    expect(f.precio_eur).toBe(10);
    expect(f.precio_texto).toBe("€10, under 12 free");
  });
  it("Lisboa/Belém grabada: la ficha de los Jerónimos trae el precio de la página real", () => {
    const fichas = extraerFichas(contenidoGrabado("en-Lisbon-Belem.json"));
    expect(fichas.length).toBeGreaterThan(10);
    const jeronimos = fichas.find((f) => /Jer[óo]nimos/.test(f.nombre));
    expect(jeronimos?.precio_eur).toBe(18);
    expect(jeronimos?.precio_texto).toMatch(/^€18/);
  });
  it("Sevilla: cuatro fichas de ver, la catedral entre ellas", () => {
    const fichas = extraerFichas(contenidoGrabado("en-Seville.json"));
    expect(fichas.map((f) => f.nombre)).toContain("Cathedral");
    expect(fichas.every((f) => f.tipo === "see")).toBe(true);
  });
  it("es.wikivoyage de Sevilla solo trae un listado de hotel: ninguna ficha de ver/hacer/comer/beber", () => {
    expect(extraerFichas(contenidoGrabado("es-Sevilla.json"))).toEqual([]);
  });
  it("ignora plantillas que no son fichas", () => {
    expect(extraerFichas("{{Infobox|name=Algo|content=Texto}} {{sleep|name=Hotel|content=Cama}}")).toEqual([]);
  });
});

describe("invariante 1: sin marcado y ≤ 400 caracteres", () => {
  it("limpiarTexto nunca deja llaves, corchetes ni etiquetas, ni pasa de 400", () => {
    const trozo = fc.oneof(
      fc.string(),
      fc.constantFrom("{{", "}}", "[[", "]]", "<b>", "</b>", "<ref>x</ref>", "<!--c-->", "[http://x.org y]", "''", "|", "&nbsp;"),
    );
    fc.assert(
      fc.property(fc.array(trozo, { maxLength: 80 }).map((p) => p.join("")), (entrada) => {
        const salida = limpiarTexto(entrada);
        expect(salida).not.toMatch(/[{}[\]<>]/);
        expect(salida.length).toBeLessThanOrEqual(MAX_TEXTO);
      }),
      { numRuns: 300 },
    );
  });

  it("toda ficha extraída de wikitexto arbitrario cumple lo mismo", () => {
    const parametro = fc.string({ maxLength: 120 });
    fc.assert(
      fc.property(parametro, parametro, (nombre, contenido) => {
        for (const f of extraerFichas(`{{see|name=${nombre}|content=${contenido}}}`)) {
          for (const texto of [f.nombre, f.contenido]) {
            expect(texto).not.toMatch(/[{}[\]<>]/);
            expect(texto.length).toBeLessThanOrEqual(MAX_TEXTO);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("las fichas de las páginas reales también", () => {
    for (const nombre of ["en-Lisbon-Belem.json", "en-Seville.json"]) {
      for (const f of extraerFichas(contenidoGrabado(nombre))) {
        expect(f.contenido).not.toMatch(/[{}[\]<>]/);
        expect(f.contenido.length).toBeLessThanOrEqual(MAX_TEXTO);
      }
    }
  });
});
