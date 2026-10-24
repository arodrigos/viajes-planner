import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OperacionCola } from "@/lib/sinConexion/colaSalida";
import { claveGasto, fusionarLista, paraTotales, sinSubir } from "../lista";
import type { Gasto, GastoEntrada } from "../tipos";

const g = (id: string, t = "2027-01-01T00:00:00.000Z"): Gasto => ({ id, importe_centimos: 1000, categoria: "transporte", fecha: null, actualizado_cliente: t });
const entrada = (t: string): GastoEntrada => ({ importe_centimos: 1200, categoria: "entradas", fecha: "2027-03-05", actualizado_cliente: t });
let rev = 0;
const op = (id: string, tipo: OperacionCola["tipo"], extra: Partial<OperacionCola> = {}): OperacionCola => ({
  clave: claveGasto(id), ambito: "p", tipo, url: "/x", creada: "", intentos: 0, estado: "pendiente", rev: ++rev,
  ...(tipo === "guardar" ? { cuerpo: entrada("2027-02-01T00:00:00.000Z") } : {}), ...extra,
});

describe("fusionarLista (off-ac1, off-ac4)", () => {
  it("un alta pendiente aparece marcada y cuenta en los totales", () => {
    const l = fusionarLista([g("a")], [op("b", "guardar")]);
    expect(l.map((x) => [x.id, x.estado])).toEqual([["b", "pendiente"], ["a", "subido"]]);
    expect(paraTotales(l)).toHaveLength(2);
    expect(sinSubir(l)).toBe(1);
  });

  it("un borrado pendiente quita el gasto al momento", () => {
    expect(fusionarLista([g("a")], [op("a", "borrar")])).toEqual([]);
  });

  it("una edición pendiente sustituye al subido", () => {
    const [x] = fusionarLista([g("a")], [op("a", "guardar")]);
    expect(x).toMatchObject({ id: "a", importe_centimos: 1200, estado: "pendiente" });
  });

  it("un rechazado sale marcado con su motivo y no cuenta en los totales ni en «sin subir»", () => {
    const l = fusionarLista([], [op("a", "guardar", { estado: "rechazada", error: "Motivo" })]);
    expect(l[0]).toMatchObject({ estado: "rechazado", error: "Motivo" });
    expect(paraTotales(l)).toEqual([]);
    expect(sinSubir(l)).toBe(0);
  });

  it("un borrado rechazado no esconde el gasto", () => {
    expect(fusionarLista([g("a")], [op("a", "borrar", { estado: "rechazada" })]).map((x) => x.id)).toEqual(["a"]);
  });

  it("ignora operaciones de otros usos de la cola", () => {
    expect(fusionarLista([g("a")], [op("a", "guardar", { clave: "equipaje:a" })]).map((x) => x.estado)).toEqual(["subido"]);
  });

  it("invariante: sin repeticiones y cada id sale como mucho una vez, con cualquier mezcla", () => {
    const ids = fc.constantFrom("a", "b", "c", "d");
    fc.assert(
      fc.property(
        fc.uniqueArray(ids, { maxLength: 4 }),
        fc.array(fc.tuple(ids, fc.constantFrom("guardar" as const, "borrar" as const)), { maxLength: 8 }),
        (en_servidor, ops) => {
          const unicas = [...new Map(ops.map(([id, tipo]) => [id, op(id, tipo)])).values()];
          const lista = fusionarLista(en_servidor.map((i) => g(i)), unicas);
          expect(new Set(lista.map((x) => x.id)).size).toBe(lista.length);
          const esperados = new Set(en_servidor);
          for (const o of unicas) {
            const id = o.clave.slice(6);
            if (o.tipo === "borrar") esperados.delete(id);
            else esperados.add(id);
          }
          expect(new Set(lista.map((x) => x.id))).toEqual(esperados);
        },
      ),
    );
  });
});
