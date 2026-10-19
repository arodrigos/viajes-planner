import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agruparPorFranja, aplicarOrden, mismoOrden, moverParada, ordenDesdeGrupos, validarOrden, type EntradaOrden } from "../reordenar";

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
        const resultado = moverParada(dia, FRANJAS, dia[k % dia.length].id, direccion);
        expect(resultado.map((e) => e.id).sort()).toEqual(dia.map((e) => e.id).sort());
      }),
    );
  });

  it("mantiene la secuencia de franjas sin decrecer", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), fc.constantFrom("arriba", "abajo" as const), (dia, k, direccion) => {
        const resultado = moverParada(dia, FRANJAS, dia[k % dia.length].id, direccion).map(indiceDeFranja);
        expect(resultado).toEqual([...resultado].sort((a, b) => a - b));
      }),
    );
  });

  it("subir y bajar la misma parada, lejos de los extremos, devuelve la lista inicial", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), (dia, k) => {
        const id = dia[k % dia.length].id;
        const arriba = moverParada(dia, FRANJAS, id, "arriba");
        const vuelta = moverParada(arriba, FRANJAS, id, "abajo");
        const i = dia.findIndex((e) => e.id === id);
        const j = arriba.findIndex((e) => e.id === id);
        // Extremo del día: el primer movimiento no hace nada o el de vuelta cae en el borde.
        fc.pre(i > 0 && j < arriba.length - 1);
        expect(vuelta).toEqual(dia);
      }),
    );
    fc.assert(
      fc.property(diaValido, fc.nat(), (dia, k) => {
        const id = dia[k % dia.length].id;
        const abajo = moverParada(dia, FRANJAS, id, "abajo");
        const vuelta = moverParada(abajo, FRANJAS, id, "arriba");
        const i = dia.findIndex((e) => e.id === id);
        const j = abajo.findIndex((e) => e.id === id);
        fc.pre(i < dia.length - 1 && j > 0);
        expect(vuelta).toEqual(dia);
      }),
    );
  });

  it("validarOrden acepta lo que produce moverParada y rechaza lo que no es una permutación", () => {
    fc.assert(
      fc.property(diaValido, fc.nat(), fc.constantFrom("arriba", "abajo" as const), (dia, k, direccion) => {
        expect(validarOrden(dia, moverParada(dia, FRANJAS, dia[k % dia.length].id, direccion), FRANJAS)).toEqual({ ok: true });
        // Quitar una parada, repetir una o inventar un id nunca es válido.
        expect(validarOrden(dia, dia.slice(1), FRANJAS).ok).toBe(false);
        expect(validarOrden(dia, [...dia.slice(1), dia[1 % dia.length]], FRANJAS).ok).toBe(dia.length === 1 ? true : false);
        expect(validarOrden(dia, [{ id: "inventada", franja_id: "f0" }, ...dia.slice(1)], FRANJAS).ok).toBe(false);
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
    expect(moverParada(dia, FRANJAS, "A", "abajo").map((e) => e.id)).toEqual(["B", "A", "C", "D"]);
  });

  it("al subir la primera de la tarde pasa a la franja anterior, en el mismo puesto", () => {
    const resultado = moverParada(dia, FRANJAS, "C", "arriba");
    expect(resultado.map((e) => `${e.id}:${e.franja_id}`)).toEqual(["A:f0", "B:f0", "C:f0", "D:f1"]);
  });

  it("toma la franja inmediata aunque esté vacía", () => {
    const conHueco: EntradaOrden[] = [{ id: "A", franja_id: "f0" }, { id: "C", franja_id: "f2" }];
    expect(moverParada(conHueco, FRANJAS, "C", "arriba")[1].franja_id).toBe("f1");
  });

  it("en los extremos devuelve la lista igual", () => {
    expect(mismoOrden(moverParada(dia, FRANJAS, "A", "arriba"), dia)).toBe(true);
    expect(mismoOrden(moverParada(dia, FRANJAS, "D", "abajo"), dia)).toBe(true);
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
