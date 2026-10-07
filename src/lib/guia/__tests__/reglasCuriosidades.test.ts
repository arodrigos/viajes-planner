import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ItemCuriosidad } from "@/lib/plan/tipos";
import { CLASES_EDIFICIO, frasesDeTexto, textoDeHecho } from "../candidatas";
import { ARRANQUES, partirFrases } from "../curiosidades";
import { ABREVIATURAS_INTERNAS, empiezaEnMinuscula, sanearItems, terminaEnAbreviaturaInterna, terminaEnInicial } from "../sanear";
import { curiosidadesSeguras } from "../seguridad";
import { EXTRACTO_MUSEO } from "../__fixtures__/extractoMuseo";

// Al multiplicar la entrada por 8, lineal ≈ 8 y cuadrático ≈ 64. En CI el código
// lineal ha llegado a 6,8 con un factor 4 (ideal 4) porque el montón más grande
// encarece el GC: con 24 hay margen de sobra para ese ruido y una complejidad
// cuadrática sigue quedando muy por encima.
const RAZON_MAXIMA = 24;

// El ruido de un runner compartido (GC, otro proceso) solo suma tiempo, nunca lo
// resta: el mínimo de varias repeticiones es la medida más cercana al coste real y
// la mediana de 5 llegó a dar 7,8 en CI con código lineal.
function minimoMs(fn: (t: string) => unknown, texto: string): number {
  let mejor = Infinity;
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    fn(texto);
    mejor = Math.min(mejor, performance.now() - t0);
  }
  return mejor;
}

function razonDeEscalado(fn: (t: string) => unknown, pequeno: string, grande: string): number {
  // Una ejecución descartada de cada tamaño: compila las regex y calienta el JIT.
  fn(pequeno);
  fn(grande);
  return minimoMs(fn, grande) / Math.max(minimoMs(fn, pequeno), 0.01);
}

const item = (texto: string): ItemCuriosidad => ({ texto, fuente: "wikipedia", idioma: "en", seleccion: "modelo", url: "https://en.wikipedia.org/wiki/X" });
const P571 = { propiedad: "P571" as const, anio: 1066 };

describe("cr-ac1: edificio y museo a la vez", () => {
  it("la Torre de Londres (castillo + museo) sale como «Se fundó»", () => {
    expect(textoDeHecho(P571, ["Q23413", "Q33506", "Q839954", "Q115154402"])).toBe("Se fundó en 1066.");
  });
  it("un museo puro conserva la fórmula institucional y sin clases es «Se fundó»", () => {
    expect(textoDeHecho({ propiedad: "P571", anio: 1889 }, ["Q207694"])).toBe("La institución se fundó en 1889.");
    expect(textoDeHecho({ propiedad: "P571", anio: 1200 }, [])).toBe("Se fundó en 1200.");
  });
  it("con alguna clase de edificio nunca empieza por «La institución» (property)", () => {
    const clases = fc.array(fc.constantFrom("Q33506", "Q207694", "Q7075", "Q3918", "Q99", ...CLASES_EDIFICIO), { maxLength: 6 });
    fc.assert(
      fc.property(clases, fc.integer({ min: 1, max: 2100 }), (cs, anio) => {
        if (cs.some((c) => CLASES_EDIFICIO.has(c))) expect(textoDeHecho({ propiedad: "P571", anio }, cs)).not.toMatch(/^La institución/);
      }),
      { numRuns: 50 },
    );
  });
});

describe("cr-ac2: frasesDeTexto", () => {
  it("une el salto de línea simple y no deja frases a media frase", () => {
    const frases = frasesDeTexto(EXTRACTO_MUSEO, "en");
    expect(frases).toContain("The museum holds over 145 million specimens, the largest such holdings in the world.");
    expect(frases).toContain("It opened to the public in 1910.");
    expect(frases).toContain("The building was designed in 1904.");
    expect(frases.some((f) => f.startsWith("specimens") || f.includes("=="))).toBe(false);
  });
  it("no une líneas que acaban en punto ni las que siguen con mayúscula", () => {
    expect(frasesDeTexto("Intro sentence here.\nThe first paragraph ends here.\nAnother paragraph is here.", "en")).toEqual(["The first paragraph ends here.", "Another paragraph is here."]);
    expect(frasesDeTexto("Intro sentence here.\nThe museum has no final mark\nThe next one is capitalised too.", "en")).toEqual(["The next one is capitalised too."]);
  });
  it("ninguna frase empieza en minúscula para ningún texto (property)", () => {
    const trozo = fc.constantFrom("The museum opened in 1910.", "specimens, the largest holdings in the world.", "¿cómo se llega hasta aquí?", "Fue en 1857 y fue grande.", "\n", "\n\n", " ", "== Historia ==", "John F. Kennedy lo visitó en 1963.");
    fc.assert(
      fc.property(fc.array(trozo, { maxLength: 12 }), (trozos) => {
        for (const f of frasesDeTexto(trozos.join(""), "en")) expect(empiezaEnMinuscula(f)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
  // Un umbral en milisegundos depende de la máquina (en CI rozaba 196 ms frente a
  // 200): lo que se vigila es la forma del coste, no su valor absoluto.
  it("el coste crece de forma lineal con el tamaño del texto (cr-ac4)", () => {
    const bloque = "John F. Kennedy visitó D.C. el año 1963 y el museo\nabrió sus puertas a las 9. Fue un gran día.\n";
    const texto = (n: number) => bloque.repeat(Math.ceil(n / bloque.length)).slice(0, n);
    const razon = razonDeEscalado((t) => frasesDeTexto(t, "en"), texto(50_000), texto(400_000));
    expect(razon).toBeLessThanOrEqual(RAZON_MAXIMA);
  });
  it("control: la medida rechaza una variante cuadrática", () => {
    // Doble bucle sobre las líneas: lo que haría un deduplicado ingenuo. Se mide
    // sola, sin frasesDeTexto, porque esta devuelve pocas frases y no sirve de base.
    const cuadratica = (t: string) => {
      const lineas = t.split("\n");
      let iguales = 0;
      for (const a of lineas) for (const b of lineas) if (a.length === b.length) iguales++;
      return iguales;
    };
    const bloque = "Frase número uno del museo y su fachada principal.\n";
    const texto = (n: number) => bloque.repeat(Math.ceil(n / bloque.length)).slice(0, n);
    expect(razonDeEscalado(cuadratica, texto(50_000), texto(400_000))).toBeGreaterThan(RAZON_MAXIMA);
  });
});

describe("cr-ac3: iniciales y siglas en partirFrases", () => {
  it("parte tras un numeral de rey o una sigla si lo siguiente abre frase", () => {
    expect(partirFrases("Se construyó bajo el mandato de Jacobo I. Su hijo la amplió.")).toEqual(["Se construyó bajo el mandato de Jacobo I.", "Su hijo la amplió."]);
    expect(partirFrases("It lies south of Washington, D.C. In 1846 it was founded.", "en")).toEqual(["It lies south of Washington, D.C.", "In 1846 it was founded."]);
  });
  it("sigue uniendo nombres con inicial y siglas dentro de la frase", () => {
    expect(partirFrases("He met John F. Kennedy in December 1963.", "en")).toHaveLength(1);
    expect(partirFrases("The U.S. President Abraham Lincoln visited it.", "en")).toHaveLength(1);
    expect(partirFrases("Warner Bros. Studio Tour London opened in 2012.", "en")).toHaveLength(1);
  });
  it("las unidas reproducen el texto y tras abreviatura de la lista nunca corta (property)", () => {
    const trozo = fc.constantFrom("Jacobo I.", "Su hijo la amplió.", "John F.", "Kennedy lo visitó.", "D.C.", "In 1846 it opened.", "Dr. Who", "Fue en 1857.", "Abrió");
    fc.assert(
      fc.property(fc.array(trozo, { maxLength: 10 }), fc.constantFrom("es", "en"), (trozos, locale) => {
        const texto = trozos.join(" ");
        const frases = partirFrases(texto, locale);
        expect(frases.join(" ")).toBe(texto.replace(/\s+/g, " ").trim());
        for (const f of frases.slice(0, -1)) expect(terminaEnAbreviaturaInterna(f)).toBe(false);
        for (const f of frases.slice(0, -1)) if (terminaEnInicial(f)) expect(ARRANQUES.has(frases[frases.indexOf(f) + 1]!.split(" ")[0]!)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe("sanearItems con formato", () => {
  it("con formato 5 una sigla final se pinta y con 4 no; la abreviatura de la lista nunca", () => {
    expect(sanearItems([item("It lies south of Washington, D.C.")], 5)).toHaveLength(1);
    expect(sanearItems([item("It lies south of Washington, D.C.")], 4)).toHaveLength(0);
    expect(sanearItems([item("Es de Warner Bros.")], 5)).toHaveLength(0);
  });
  it("descarta las que empiezan en minúscula, también las ya guardadas", () => {
    expect(sanearItems([item("specimens, the largest such holdings in the world."), item("«cita rota» dijo."), item("It opened to the public in 1910.")], 4).map((i) => i.texto)).toEqual(["It opened to the public in 1910."]);
    const c = curiosidadesSeguras({ frases: [], url: "", formato: 4, items: [item("specimens, the largest such holdings in the world."), item("It opened to the public in 1910.")] });
    expect(c?.items?.map((i) => i.texto)).toEqual(["It opened to the public in 1910."]);
  });
  it("es idempotente y nunca devuelve minúscula ni abreviatura de la lista (property)", () => {
    const texto = fc.oneof(fc.string(), fc.constantFrom("Es de Warner Bros.", "specimens, a.", "It opened.", "He met John F.", "D.C.", `Vimos ${ABREVIATURAS_INTERNAS[0]}.`));
    fc.assert(
      fc.property(fc.array(texto, { maxLength: 6 }), fc.integer({ min: 0, max: 6 }), (textos, formato) => {
        const una = sanearItems(textos.map(item), formato);
        expect(sanearItems(una, formato)).toEqual(una);
        for (const i of una) {
          expect(empiezaEnMinuscula(i.texto)).toBe(false);
          expect(terminaEnAbreviaturaInterna(i.texto)).toBe(false);
          if (formato < 5) expect(terminaEnInicial(i.texto)).toBe(false);
        }
      }),
      { numRuns: 50 },
    );
  });
});
