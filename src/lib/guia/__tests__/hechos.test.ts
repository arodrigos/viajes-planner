import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ItemCuriosidad } from "@/lib/plan/tipos";
import { construirCandidatas, textoDeHecho, type EntidadWikidata, type FuenteCuriosidades, type HechoWikidata } from "../candidatas";
import { curiosidadesSeguras } from "../seguridad";

const MUSEO = "Q33506";
const MUSEO_DE_ARTE = "Q207694";
const IGLESIA = "Q16970";

const entidad = (qid: string, hechos: HechoWikidata[], clases: string[]): EntidadWikidata => ({ qid, titulos: {}, hechos, clases });

async function hechosDe(e: EntidadWikidata): Promise<string[]> {
  const fuente: FuenteCuriosidades = { entidades: async () => new Map([[e.qid, e]]), articulo: async () => null, entradillas: async () => new Map() };
  const sitio = { id: "s", tipo: "parada" as const, nombre: "Sitio", lugar: { etiquetas: { wikidata: e.qid } } as never };
  const [resultado] = await construirCandidatas([sitio], fuente);
  return resultado.candidatas.filter((c) => c.fuente === "wikidata").map((c) => c.texto);
}

describe("textoDeHecho (cur-ac2-a)", () => {
  it("Science Museum: abre en 1857 y no habla de fundación", async () => {
    const t = await hechosDe(entidad("Q1", [{ propiedad: "P571", anio: 1909 }, { propiedad: "P1619", anio: 1857 }], [MUSEO]));
    expect(t).toContain("Se inauguró en 1857.");
    expect(t.some((x) => x.includes("fund"))).toBe(false);
  });

  it("Tate Modern: solo P571 en un museo de arte dice «La institución se fundó»", async () => {
    expect(await hechosDe(entidad("Q2", [{ propiedad: "P571", anio: 1889 }], [MUSEO_DE_ARTE]))).toEqual(["La institución se fundó en 1889."]);
  });

  it("solo P571 en una iglesia sigue diciendo «Se fundó en»", async () => {
    expect(await hechosDe(entidad("Q3", [{ propiedad: "P571", anio: 1100 }], [IGLESIA]))).toEqual(["Se fundó en 1100."]);
    expect(textoDeHecho({ propiedad: "P571", anio: 1100 })).toBe("Se fundó en 1100.");
  });

  it("los números grandes llevan punto de miles y los años no", () => {
    expect(textoDeHecho({ propiedad: "P1174", numero: 6500000, anioMedida: 2019 })).toBe("Recibe unos 6.500.000 visitantes al año (2019).");
    expect(textoDeHecho({ propiedad: "P2048", numero: 1000 })).toBe("Mide 1.000 m de altura.");
  });

  it("nunca salen fundación y apertura a la vez, sea cual sea la entidad (property)", async () => {
    const hecho = fc.constantFrom<HechoWikidata>({ propiedad: "P571", anio: 1909 }, { propiedad: "P1619", anio: 1857 }, { propiedad: "P2048", numero: 80 });
    await fc.assert(
      fc.asyncProperty(fc.array(hecho, { maxLength: 6 }), fc.constantFrom<string[]>([MUSEO], [IGLESIA], []), async (hechos, clases) => {
        const t = await hechosDe(entidad("Q9", hechos, clases));
        expect(t.some((x) => /fundó/.test(x)) && t.some((x) => /inauguró|abrió/.test(x))).toBe(false);
      }),
    );
  });
});

describe("curiosidadesSeguras limpia lo ya guardado (cur-ac1-b)", () => {
  const item = (texto: string): ItemCuriosidad => ({ texto, fuente: "wikipedia", idioma: "en", seleccion: "modelo", url: "https://en.wikipedia.org/wiki/X" });

  it("de tres curiosidades guardadas pinta dos: sin invisibles y sin la cortada", () => {
    const c = curiosidadesSeguras({
      frases: [],
      url: "",
      items: [item("The tour​ covers the sets used in the films."), item("The studio is owned by Warner Bros."), item("It opened in 2012 to the public.")],
    });
    expect(c?.items?.map((i) => i.texto)).toEqual(["The tour covers the sets used in the films.", "It opened in 2012 to the public."]);
  });

  it("si todas están cortadas no queda nada que pintar", () => {
    expect(curiosidadesSeguras({ frases: [], url: "", items: [item("Es de Warner Bros.")] })).toBeUndefined();
  });
});
