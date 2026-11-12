// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { colaDeSalida } from "@/lib/gastos/cola";
import { colaPreparativos } from "@/lib/preparativos/cola";
import { borrarCopiaPlan, borrarCopias } from "../borrar";

const alta = (plan: string, id: string) => ({ clave: `gasto:${id}`, ambito: plan, tipo: "guardar" as const, url: `/api/plan/${plan}/gastos/${id}`, cuerpo: { v: 1 } });

async function sembrar() {
  const cola = colaDeSalida();
  await cola.vaciarTodo();
  for (const plan of ["plan-1", "plan-2"]) {
    await cola.encolar(alta(plan, `${plan}-a`));
    await cola.guardarEspejo(plan, [{ id: `${plan}-e` }]);
  }
  return cola;
}

beforeEach(async () => {
  await colaDeSalida().vaciarTodo();
});

describe("borrar la cola y el espejo de gastos (off-ac5)", () => {
  it("cerrar sesión (borrarCopias) vacía la cola y el espejo de todos los viajes", async () => {
    const cola = await sembrar();
    await borrarCopias();
    for (const plan of ["plan-1", "plan-2"]) {
      expect(await cola.pendientes(plan)).toEqual([]);
      expect(await cola.leerEspejo(plan)).toBeNull();
    }
  });

  it("tras entrar con el código (conservarGastos) lo pendiente sigue para subirse", async () => {
    const cola = await sembrar();
    await borrarCopias({ conservarGastos: true });
    expect(await cola.pendientes("plan-1")).toHaveLength(1);
    expect(await cola.leerEspejo("plan-2")).not.toBeNull();
  });

  it("eliminar un viaje (borrarCopiaPlan) vacía solo el de ese viaje", async () => {
    const cola = await sembrar();
    await borrarCopiaPlan("plan-1");
    expect(await cola.pendientes("plan-1")).toEqual([]);
    expect(await cola.leerEspejo("plan-1")).toBeNull();
    expect(await cola.pendientes("plan-2")).toHaveLength(1);
    expect((await cola.leerEspejo<{ id: string }>("plan-2"))?.datos).toEqual([{ id: "plan-2-e" }]);
  });
});

describe("borrar la cola de preparativos (lis-ac6)", () => {
  const marca = (plan: string) => ({ clave: `marca:${plan}:panales`, ambito: plan, tipo: "guardar" as const, url: `/api/plan/${plan}/preparativos/panales`, cuerpo: { estado: "hecho" } });

  async function sembrarAmbas() {
    const gastos = await sembrar();
    const prep = colaPreparativos();
    await prep.vaciarTodo();
    for (const plan of ["plan-1", "plan-2"]) {
      await prep.encolar(marca(plan));
      await prep.guardarEspejo(plan, [{ id: "panales" }]);
    }
    return { gastos, prep };
  }

  it("cerrar sesión vacía las marcas de todos los viajes, incluso con conservarGastos, sin tocar los gastos", async () => {
    const { gastos, prep } = await sembrarAmbas();
    await borrarCopias({ conservarGastos: true });
    for (const plan of ["plan-1", "plan-2"]) {
      expect(await prep.pendientes(plan)).toEqual([]);
      expect(await prep.leerEspejo(plan)).toBeNull();
    }
    expect(await gastos.pendientes("plan-1")).toHaveLength(1);
  });

  it("eliminar un viaje vacía solo sus marcas y no el espejo de gastos del mismo plan", async () => {
    const { gastos, prep } = await sembrarAmbas();
    await borrarCopiaPlan("plan-1");
    expect(await prep.pendientes("plan-1")).toEqual([]);
    expect(await prep.leerEspejo("plan-1")).toBeNull();
    expect(await prep.pendientes("plan-2")).toHaveLength(1);
    expect(await gastos.pendientes("plan-1")).toEqual([]);
  });

  it("el espejo de preparativos no pisa el de gastos", async () => {
    const { gastos } = await sembrarAmbas();
    expect((await gastos.leerEspejo<{ id: string }>("plan-1"))?.datos).toEqual([{ id: "plan-1-e" }]);
  });
});
