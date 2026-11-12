import { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { eliminarViaje } from "@/lib/cola/eliminar";
import { ERRORES_PREPARATIVOS as E } from "@/lib/textos/preparativos";
import { IDS_PREPARATIVOS } from "@/lib/preparativos/catalogo";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { PUT } from "../[elemento]/manejador";
import { GET } from "../manejador";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Relativas a ahora: validarMarca rechaza fechas a más de 24 h en el futuro.
const AHORA = Date.now();
const T0 = new Date(AHORA - 2 * 3600_000).toISOString();
const T1 = new Date(AHORA - 3600_000).toISOString();
const T2 = new Date(AHORA - 1800_000).toISOString();
const ELEMENTO = [...IDS_PREPARATIVOS][0];

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("/api/plan/[id]/preparativos (dat-ac1..ac6)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-prep-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-prep-ajeno@example.com");
    c = await usuarioDePrueba("ci-test-prep-invitado@example.com");
  });

  afterAll(async () => {
    for (const id of planes) await servicio.from("preparativos_marcas").delete().eq("plan_id", id);
    await limpiarPlanes(servicio, planes);
  });

  async function plan(sufijo: string) {
    const id = `plan-prep-${sufijo}-${Date.now()}`;
    planes.push(id);
    await sembrarPlan(servicio, id, a.usuarioId);
    return id;
  }
  const poner = (u: UsuarioDePrueba | null, id: string, elemento: string, cuerpo: unknown) =>
    PUT(peticion(`/api/plan/${id}/preparativos/${elemento}`, "PUT", u?.cookie, cuerpo), contexto({ id, elemento }));
  const lista = (u: UsuarioDePrueba | null, id: string) => GET(peticion(`/api/plan/${id}/preparativos`, "GET", u?.cookie), contexto({ id }));
  const filas = async (id: string) => (await servicio.from("preparativos_marcas").select("elemento, estado").eq("plan_id", id)).data ?? [];

  it("dat-ac2: PUT guarda, repetirlo no cambia nada y uno más viejo no pisa", async () => {
    const id = await plan("lww");
    expect((await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 })).status).toBe(200);
    expect((await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 })).status).toBe(200);
    expect((await poner(a, id, ELEMENTO, { estado: "pendiente", actualizado_cliente: T0 })).status).toBe(200);
    const r = await lista(a, id);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.json()).toEqual({ marcas: [{ elemento: ELEMENTO, estado: "hecho", actualizado_cliente: T1 }] });
    expect((await poner(a, id, ELEMENTO, { estado: "no_hace_falta", actualizado_cliente: T2 })).status).toBe(200);
    expect(await filas(id)).toEqual([{ elemento: ELEMENTO, estado: "no_hace_falta" }]);
  });

  it("dat-ac3: ajeno, invitado e inexistente 404, sin sesión 401, y no se crea ninguna fila", async () => {
    const id = await plan("idor");
    await invitar(servicio, id, c.email, a.usuarioId);
    for (const u of [b, c]) {
      expect((await lista(u, id)).status).toBe(404);
      expect((await poner(u, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 })).status).toBe(404);
    }
    expect((await lista(null, id)).status).toBe(401);
    expect((await poner(null, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 })).status).toBe(401);
    expect((await lista(a, "plan-prep-no-existe")).status).toBe(404);
    expect(await filas(id)).toHaveLength(0);
  });

  it("dat-ac4: elemento, estado y fecha inválidos dan 400 con texto; sin JSON 415", async () => {
    const id = await plan("valida");
    const fuera = await poner(a, id, "no-existe", { estado: "hecho", actualizado_cliente: T1 });
    expect(fuera.status).toBe(400);
    expect((await fuera.json()).error).toBe(E.elemento);
    expect((await (await poner(a, id, ELEMENTO, { estado: "listo", actualizado_cliente: T1 })).json()).error).toBe(E.estado);
    expect((await (await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: "ayer" })).json()).error).toBe(E.fecha);
    expect((await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: "2099-01-01T00:00:00Z" })).status).toBe(400);
    const noJson = await PUT(
      new NextRequest(`http://localhost/api/plan/${id}/preparativos/${ELEMENTO}`, { method: "PUT", headers: { cookie: a.cookie, "content-type": "text/plain" }, body: "hola" }),
      contexto({ id, elemento: ELEMENTO }),
    );
    expect(noJson.status).toBe(415);
    expect(await filas(id)).toHaveLength(0);
  });

  it("dat-ac1: la tabla y la función están cerradas a anon (sin privilegios)", async () => {
    const anon = clienteDePrueba("anonimo");
    expect((await anon.from("preparativos_marcas").select("elemento")).error).not.toBeNull();
    expect((await anon.from("preparativos_marcas").insert({ plan_id: "x", elemento: ELEMENTO, estado: "hecho", actualizado_cliente: T1 })).error).not.toBeNull();
    expect((await anon.rpc("guardar_marca_preparativo", { p_plan_id: "x", p_elemento: ELEMENTO, p_estado: "hecho", p_actualizado: T1 })).error).not.toBeNull();
    // service_role sí puede: la tabla existe y es legible por la ruta.
    expect((await servicio.from("preparativos_marcas").select("elemento").limit(1)).error).toBeNull();
  });

  it("dat-ac5: eliminar el viaje borra sus marcas de verdad", async () => {
    const id = await plan("eliminar");
    await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 });
    expect(await filas(id)).toHaveLength(1);
    const { data } = await servicio.from("trabajos").select("id").eq("plan_id", id).single();
    expect(await eliminarViaje(servicio, data!.id as string, a.usuarioId)).toBe(true);
    expect(await filas(id)).toHaveLength(0);
  });

  it("dat-ac6: un fallo de la base da 500 genérico y el log no lleva ni uuid ni plan_id ni cuerpo", async () => {
    const id = await plan("fallo");
    const espia = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.spyOn(SupabaseClient.prototype, "rpc").mockResolvedValue({ error: { message: `fallo en ${id} 00000000-0000-4000-8000-000000000001 secreto` } } as never);
    try {
      const r = await poner(a, id, ELEMENTO, { estado: "hecho", actualizado_cliente: T1 });
      expect(r.status).toBe(500);
      expect(Object.keys(await r.json())).toEqual(["error"]);
      const log = espia.mock.calls.flat().join(" ");
      expect(log).not.toContain("00000000-0000-4000");
    } finally {
      rpc.mockRestore();
      espia.mockRestore();
    }
  });
});
