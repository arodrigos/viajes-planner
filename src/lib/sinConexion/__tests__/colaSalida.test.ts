import "fake-indexeddb/auto";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearColaSalida, esperaMs, type NuevaOperacion } from "../colaSalida";

afterEach(() => vi.unstubAllGlobals());

let n = 0;
const nueva = () => crearColaSalida(`prueba-${++n}`);
const op = (clave: string, extra: Partial<NuevaOperacion> = {}): NuevaOperacion => ({ clave, ambito: "plan-1", tipo: "guardar", url: `/x/${clave}`, cuerpo: { v: 1 }, ...extra });
const respuesta = (status: number, cuerpo?: unknown) => new Response(status === 204 ? null : JSON.stringify(cuerpo ?? {}), { status });

describe("colaSalida (off-ac2, off-ac3, off-ac4)", () => {
  it("encolar con una clave ya pendiente reemplaza la operación", async () => {
    const cola = nueva();
    await cola.encolar(op("gasto:a", { cuerpo: { v: 1 } }));
    await cola.encolar(op("gasto:a", { cuerpo: { v: 2 } }));
    const p = await cola.pendientes("plan-1");
    expect(p).toHaveLength(1);
    expect(p[0].cuerpo).toEqual({ v: 2 });
  });

  it("una operación solo sale de la cola tras un 2xx (o un 404 en un borrado)", async () => {
    const cola = nueva();
    await cola.encolar(op("gasto:ok"));
    await cola.encolar(op("gasto:borrado", { tipo: "borrar", cuerpo: undefined }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("ok") ? respuesta(200) : respuesta(404))));
    expect(await cola.sincronizar()).toEqual({ subidas: 2, pendientes: 0 });
    expect(await cola.pendientes("plan-1")).toEqual([]);
  });

  it.each([
    ["fallo de red", () => Promise.reject(new TypeError("offline"))],
    ["500", () => Promise.resolve(respuesta(500))],
    ["503", () => Promise.resolve(respuesta(503))],
  ])("%s: sigue pendiente y suma un intento", async (_n, f) => {
    const cola = nueva();
    await cola.encolar(op("gasto:a"));
    vi.stubGlobal("fetch", vi.fn(f));
    expect(await cola.sincronizar()).toEqual({ subidas: 0, pendientes: 1 });
    const [o] = await cola.pendientes("plan-1");
    expect(o).toMatchObject({ estado: "pendiente", intentos: 1 });
  });

  it("off-ac3: un 401 deja todo en 'sin-sesion', sin perder nada, y se sube al volver la sesión", async () => {
    const cola = nueva();
    await cola.encolar(op("gasto:a"));
    await cola.encolar(op("gasto:b"));
    const f = vi.fn(async () => respuesta(401));
    vi.stubGlobal("fetch", f);
    expect(await cola.sincronizar()).toEqual({ subidas: 0, pendientes: 2 });
    expect((await cola.pendientes("plan-1")).map((o) => o.estado)).toEqual(["sin-sesion", "sin-sesion"]);
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200)));
    expect(await cola.sincronizar()).toEqual({ subidas: 2, pendientes: 0 });
  });

  it.each([400, 409, 404])("off-ac4: un %i deja la operación rechazada con su motivo y no la quita", async (status) => {
    const cola = nueva();
    await cola.encolar(op("gasto:a"));
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(status, { error: "Motivo visible" })));
    const r = await cola.sincronizar();
    expect(r.pendientes).toBe(0);
    const [o] = await cola.pendientes("plan-1");
    expect(o).toMatchObject({ estado: "rechazada", error: "Motivo visible" });
    // Una rechazada no se reintenta sola.
    const f = vi.fn(async () => respuesta(200));
    vi.stubGlobal("fetch", f);
    await cola.sincronizar();
    expect(f).not.toHaveBeenCalled();
    // Descartar la quita; volver a encolar la clave la deja pendiente de nuevo.
    await cola.encolar(op("gasto:a"));
    expect((await cola.pendientes("plan-1"))[0].estado).toBe("pendiente");
    await cola.descartar("gasto:a");
    expect(await cola.pendientes("plan-1")).toEqual([]);
  });

  it("si se reemplaza una operación mientras vuela su petición, el reemplazo sigue en la cola", async () => {
    const cola = nueva();
    await cola.encolar(op("gasto:a", { cuerpo: { v: 1 } }));
    let reemplazada = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!reemplazada) {
          reemplazada = true;
          await cola.encolar(op("gasto:a", { cuerpo: { v: 2 } }));
        }
        return respuesta(200);
      }),
    );
    await cola.sincronizar();
    // La pasada se repite sola y sube el reemplazo: no se pierde ni se da por subido el viejo.
    expect(vi.mocked(fetch).mock.calls.map((c) => JSON.parse(String(c[1]?.body)).v)).toEqual([1, 2]);
    expect(await cola.pendientes("plan-1")).toEqual([]);
  });

  it("alCambiar avisa al encolar y se puede dejar de escuchar", async () => {
    const cola = nueva();
    const cb = vi.fn();
    const baja = cola.alCambiar(cb);
    await cola.encolar(op("gasto:a"));
    expect(cb).toHaveBeenCalledTimes(1);
    baja();
    await cola.encolar(op("gasto:b"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("esperaMs crece 1, 2, 4… y se queda en 60 s", () => {
    expect([1, 2, 3, 4, 7, 8, 20].map(esperaMs)).toEqual([1000, 2000, 4000, 8000, 60000, 60000, 60000]);
  });

  it("la cola sobrevive a reabrirla (está en IndexedDB, no en memoria)", async () => {
    const nombre = `persistente-${++n}`;
    await crearColaSalida(nombre).encolar(op("gasto:a"));
    expect(await crearColaSalida(nombre).pendientes("plan-1")).toHaveLength(1);
  });
});

describe("colaSalida: ámbitos y espejo (off-ac5)", () => {
  it("vaciarAmbito deja 0 operaciones y 0 entradas de espejo de ese plan y no toca las de otros", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.constantFrom("p1", "p2", "p3"), fc.integer({ min: 0, max: 5 })), { maxLength: 12 }), fc.constantFrom("p1", "p2", "p3"), async (altas, objetivo) => {
        const cola = nueva();
        for (const [ambito, i] of altas) await cola.encolar(op(`gasto:${ambito}-${i}`, { ambito }));
        for (const a of ["p1", "p2", "p3"]) await cola.guardarEspejo(a, [{ id: `${a}-e` }]);
        const antes = new Map<string, number>();
        for (const a of ["p1", "p2", "p3"]) antes.set(a, (await cola.pendientes(a)).length);
        await cola.vaciarAmbito(objetivo);
        expect(await cola.pendientes(objetivo)).toEqual([]);
        expect(await cola.leerEspejo(objetivo)).toBeNull();
        for (const a of ["p1", "p2", "p3"].filter((x) => x !== objetivo)) {
          expect((await cola.pendientes(a)).length).toBe(antes.get(a));
          expect((await cola.leerEspejo<{ id: string }>(a))?.datos).toEqual([{ id: `${a}-e` }]);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("guardarEspejo reemplaza lo anterior y leerEspejo distingue «sin copia» de «copia vacía»", async () => {
    const cola = nueva();
    expect(await cola.leerEspejo("plan-1")).toBeNull();
    await cola.guardarEspejo("plan-1", [{ id: "a" }, { id: "b" }]);
    await cola.guardarEspejo("plan-1", [{ id: "c" }]);
    expect((await cola.leerEspejo<{ id: string }>("plan-1"))?.datos).toEqual([{ id: "c" }]);
    await cola.guardarEspejo("plan-1", []);
    expect((await cola.leerEspejo("plan-1"))?.datos).toEqual([]);
  });

  it("vaciarTodo limpia cola y espejos de todos los planes", async () => {
    const cola = nueva();
    await cola.encolar(op("gasto:a", { ambito: "p1" }));
    await cola.guardarEspejo("p2", [{ id: "x" }]);
    await cola.vaciarTodo();
    expect(await cola.pendientes("p1")).toEqual([]);
    expect(await cola.leerEspejo("p2")).toBeNull();
  });
});

// Invariante del bloque: para cualquier secuencia de altas, ediciones y borrados
// y cortes de red en cualquier punto, cuando vuelve la red y la sincronización
// termina, el servidor tiene exactamente lo que el usuario veía.
describe("colaSalida: convergencia con el servidor (off-ac2, off-ac4)", () => {
  type Paso = { que: "guardar" | "borrar"; id: number; valor: number; corte: "ninguno" | "antes" | "despues" };
  const paso = fc.record({
    que: fc.constantFrom("guardar" as const, "borrar" as const),
    id: fc.integer({ min: 0, max: 3 }),
    valor: fc.integer({ min: 1, max: 1000 }),
    corte: fc.constantFrom("ninguno" as const, "antes" as const, "despues" as const),
  });

  it("sin duplicados ni pérdidas, incluso si la respuesta se pierde tras escribir en el servidor", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(paso, { maxLength: 25 }), async (pasos: Paso[]) => {
        const servidor = new Map<string, { valor: number; t: number }>();
        let corte: Paso["corte"] = "ninguno";
        let t = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string, init?: RequestInit) => {
            if (corte === "antes") throw new TypeError("sin red");
            const id = url.split("/").pop()!;
            if (init?.method === "DELETE") servidor.delete(id);
            else {
              const cuerpo = JSON.parse(String(init?.body)) as { valor: number; t: number };
              const previo = servidor.get(id);
              if (!previo || previo.t < cuerpo.t) servidor.set(id, cuerpo);
            }
            if (corte === "despues") throw new TypeError("respuesta perdida");
            return respuesta(200);
          }),
        );
        const cola = nueva();
        const vista = new Map<string, number>();
        for (const p of pasos) {
          const clave = `gasto:${p.id}`;
          if (p.que === "guardar") {
            await cola.encolar({ clave, ambito: "plan-1", tipo: "guardar", url: `/g/${p.id}`, cuerpo: { valor: p.valor, t: ++t } });
            vista.set(String(p.id), p.valor);
          } else {
            await cola.encolar({ clave, ambito: "plan-1", tipo: "borrar", url: `/g/${p.id}` });
            vista.delete(String(p.id));
          }
          corte = p.corte;
          await cola.sincronizar();
        }
        corte = "ninguno";
        const r = await cola.sincronizar();
        expect(r.pendientes).toBe(0);
        expect(new Map([...servidor].map(([k, v]) => [k, v.valor]))).toEqual(vista);
      }),
      { numRuns: 60 },
    );
  });

  it("off-ac2: si el corte llega tras escribir y antes de la respuesta, el reintento no duplica", async () => {
    const cola = nueva();
    const servidor = new Map<string, unknown>();
    let primera = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        servidor.set(url, JSON.parse(String(init?.body)));
        if (primera) {
          primera = false;
          throw new TypeError("corte");
        }
        return respuesta(200);
      }),
    );
    await cola.encolar(op("gasto:a", { url: "/g/a" }));
    expect((await cola.sincronizar()).pendientes).toBe(1);
    expect((await cola.sincronizar()).pendientes).toBe(0);
    expect([...servidor.keys()]).toEqual(["/g/a"]);
  });
});
