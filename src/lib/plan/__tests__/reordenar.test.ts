import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agruparPorFranja, aplicarOrden, mismoOrden, moverParada, ordenDesdeGrupos, puedeMoverParada, validarOrden, type EntradaOrden } from "../reordenar";

const FRANJAS = [{ id: "f0" }, { id: "f1" }, { id: "f2" }, { id: "f3" }];

// Un día válido cualquiera: de 1 a 8 paradas con ids distintos y la secuencia
// de franjas sin decrecer, como la deja recuperarPlan.
const diaValido = fc
  .array(fc.integer({ min: 0, max: FRANJAS.length - 1 }), { minLength: 1, maxLength: 8 })
  .map((indices) => indices.sort((a, b) => a - b).map((f, i): EntradaOrden => ({ id: `p${i}`, franja_id: FRANJAS[f].id })));

const indiceDeFranja = (e: EntradaOrden) => FRANJAS.findIndex((f) => f.id === e.franja_id);

describe("moverParada (invariantes)", () => {
  it("devuelve siempre una permutación de su entrada", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), fc.constantFrom("arriba", "abajo" as const), (dia, k, direccion) => {
        const resultado = moverParada(dia, dia[k % dia.length].id, direccion);
        expect(resultado.map((e) => e.id).sort()).toEqual(dia.map((e) => e.id).sort());
      }),
    );
  });

  it("mantiene la secuencia de franjas sin decrecer", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), fc.constantFrom("arriba", "abajo" as const), (dia, k, direccion) => {
        const resultado = moverParada(dia, dia[k % dia.length].id, direccion).map(indiceDeFranja);
        expect(resultado).toEqual([...resultado].sort((a, b) => a - b));
      }),
    );
  });

  it("subir y bajar la misma parada, lejos de los extremos, devuelve la lista inicial", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), (dia, k) => {
        const id = dia[k % dia.length].id;
        const arriba = moverParada(dia, id, "arriba");
        const vuelta = moverParada(arriba, id, "abajo");
        const i = dia.findIndex((e) => e.id === id);
        const j = arriba.findIndex((e) => e.id === id);
        // Extremo del día: el primer movimiento no hace nada o el de vuelta cae en el borde.
        fc.pre(i > 0 && j < arriba.length - 1);
        // Al cruzar toma la franja de la vecina; solo se recupera la original si
        // la parada compartía franja con la que tenía debajo (si estaba sola,
        // no hay forma de saber cuál era sin estado).
        fc.pre(indiceDeFranja(dia[i - 1]) === indiceDeFranja(dia[i]) || indiceDeFranja(dia[i + 1]) === indiceDeFranja(dia[i]));
        expect(vuelta).toEqual(dia);
      }),
    );
    fc.assert(
      fc.property(diaValido, fc.nat(), (dia, k) => {
        const id = dia[k % dia.length].id;
        const abajo = moverParada(dia, id, "abajo");
        const vuelta = moverParada(abajo, id, "arriba");
        const i = dia.findIndex((e) => e.id === id);
        const j = abajo.findIndex((e) => e.id === id);
        fc.pre(i < dia.length - 1 && j > 0);
        fc.pre(indiceDeFranja(dia[i + 1]) === indiceDeFranja(dia[i]) || indiceDeFranja(dia[i - 1]) === indiceDeFranja(dia[i]));
        expect(vuelta).toEqual(dia);
      }),
    );
  });

  it("validarOrden acepta lo que produce moverParada y rechaza lo que no es una permutación", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), fc.constantFrom("arriba", "abajo" as const), (dia, k, direccion) => {
        expect(validarOrden(dia, moverParada(dia, dia[k % dia.length].id, direccion), FRANJAS)).toEqual({ ok: true });
        // Quitar una parada, repetir una o inventar un id nunca es válido.
        expect(validarOrden(dia, dia.slice(1), FRANJAS).ok).toBe(false);
        expect(validarOrden(dia, [...dia.slice(1), dia[1 % dia.length]], FRANJAS).ok).toBe(dia.length === 1 ? true : false);
        expect(validarOrden(dia, [{ id: "inventada", franja_id: "f0" }, ...dia.slice(1)], FRANJAS).ok).toBe(false);
      }),
    );
  });
});

describe("puedeMoverParada (invariante)", () => {
  it("la primera del día no sube y la última no baja, con cualquier reparto de franjas", () => {
    fc.assert(
      fc.property(diaValido, (dia) => {
        expect(puedeMoverParada(dia, dia[0].id, "arriba")).toBe(false);
        expect(puedeMoverParada(dia, dia[dia.length - 1].id, "abajo")).toBe(false);
      }),
    );
  });
});

describe("moverParada (ejemplos)", () => {
  const dia: EntradaOrden[] = [
    { id: "A", franja_id: "f0" },
    { id: "B", franja_id: "f0" },
    { id: "C", franja_id: "f1" },
    { id: "D", franja_id: "f1" },
  ];

  it("dentro de la franja intercambia con la vecina", () => {
    expect(moverParada(dia, "A", "abajo").map((e) => e.id)).toEqual(["B", "A", "C", "D"]);
  });

  it("al subir la primera de la tarde pasa a la franja anterior, en el mismo puesto", () => {
    const resultado = moverParada(dia, "C", "arriba");
    expect(resultado.map((e) => `${e.id}:${e.franja_id}`)).toEqual(["A:f0", "B:f0", "C:f0", "D:f1"]);
  });

  it("toma la franja de la vecina, no la inmediata si está vacía (reo-ac4)", () => {
    const conHueco: EntradaOrden[] = [{ id: "A", franja_id: "f0" }, { id: "C", franja_id: "f2" }];
    expect(moverParada(conHueco, "C", "arriba")[1].franja_id).toBe("f0");
    const bajando: EntradaOrden[] = [{ id: "A", franja_id: "f0" }, { id: "C", franja_id: "f3" }];
    expect(moverParada(bajando, "A", "abajo")[0].franja_id).toBe("f3");
  });

  it("en los extremos del día no cambia nada aunque la primera y la última franja estén vacías (reo-ac1, reo-ac7)", () => {
    // Caso real: ninguna parada en la primera ni en la última franja.
    const real: EntradaOrden[] = [{ id: "A", franja_id: "f1" }, { id: "B", franja_id: "f1" }, { id: "C", franja_id: "f2" }];
    expect(mismoOrden(moverParada(real, "A", "arriba"), real)).toBe(true);
    expect(mismoOrden(moverParada(real, "C", "abajo"), real)).toBe(true);
    expect(puedeMoverParada(real, "A", "arriba")).toBe(false);
    expect(puedeMoverParada(real, "C", "abajo")).toBe(false);
    expect(puedeMoverParada(real, "B", "abajo")).toBe(true);
  });
});

describe("validarOrden y aplicarOrden", () => {
  const base: EntradaOrden[] = [{ id: "A", franja_id: "f0" }, { id: "B", franja_id: "f1" }];

  it("rechaza una franja que no es del día y una secuencia que retrocede", () => {
    expect(validarOrden(base, [{ id: "A", franja_id: "zz" }, { id: "B", franja_id: "f1" }], FRANJAS).ok).toBe(false);
    expect(validarOrden(base, [{ id: "B", franja_id: "f1" }, { id: "A", franja_id: "f0" }], FRANJAS).ok).toBe(false);
  });

  it("aplicarOrden reordena y cambia la franja sin tocar el resto de la parada", () => {
    const paradas = [{ id: "A", franja_id: "f0", nombre: "a" }, { id: "B", franja_id: "f1", nombre: "b" }];
    expect(aplicarOrden(paradas, [{ id: "B", franja_id: "f1" }, { id: "A", franja_id: "f1" }])).toEqual([
      { id: "B", franja_id: "f1", nombre: "b" },
      { id: "A", franja_id: "f1", nombre: "a" },
    ]);
  });
});

describe("agruparPorFranja / ordenDesdeGrupos (invariantes del arrastre)", () => {
  it("ida y vuelta devuelve el mismo orden", () => {
    fc.assert(
      fc.property(diaValido, (dia) => {
        expect(ordenDesdeGrupos(agruparPorFranja(dia, FRANJAS), FRANJAS)).toEqual(dia);
      }),
    );
  });

  it("aplane lo que aplane, las franjas no decrecen y no se pierde ni se duplica ninguna parada", () => {
    fc.assert(
      fc.property(
        diaValido,
        fc.array(fc.nat(), { maxLength: 12 }),
        (dia, azar) => {
          // Mueve ids entre grupos de forma arbitraria, como haría un arrastre.
          const grupos = agruparPorFranja(dia, FRANJAS);
          azar.forEach((n, i) => {
            const origen = FRANJAS[n % FRANJAS.length].id;
            const destino = FRANJAS[(n + i + 1) % FRANJAS.length].id;
            const id = grupos[origen].shift();
            if (id) grupos[destino].splice(n % (grupos[destino].length + 1), 0, id);
          });
          const plano = ordenDesdeGrupos(grupos, FRANJAS);
          expect(plano.map(indiceDeFranja)).toEqual([...plano.map(indiceDeFranja)].sort((a, b) => a - b));
          expect(plano.map((e) => e.id).sort()).toEqual(dia.map((e) => e.id).sort());
        },
      ),
    );
  });
});
