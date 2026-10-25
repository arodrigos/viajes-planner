import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { eliminarViaje } from "@/lib/cola/eliminar";
import { TOPE_GASTOS } from "@/lib/gastos/tipos";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { GET as GET_PLAN } from "../../route";
import { DELETE, PUT } from "../[gastoId]/route";
import { GET } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const T1 = "2027-01-01T10:00:00.000Z";
const T0 = "2027-01-01T09:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// 2027-03-05 es el único día del plan sembrado: una fecha fuera del viaje se rechaza.
const ENTRADAS = { importe_centimos: 1200, categoria: "entradas", fecha: "2027-03-05", actualizado_cliente: T1 };

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("/api/plan/[id]/gastos (gas-ac2, gas-ac4, gas-ac6)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-gastos-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-gastos-ajeno@example.com");
  });

  afterAll(async () => {
    for (const id of planes) await servicio.from("gastos").delete().eq("plan_id", id);
    await limpiarPlanes(servicio, planes);
  });

  async function plan(sufijo: string) {
    const id = `plan-gastos-${sufijo}-${Date.now()}`;
    planes.push(id);
    await sembrarPlan(servicio, id, a.usuarioId);
    return id;
  }
  const poner = (u: UsuarioDePrueba | null, id: string, gastoId: string, cuerpo: unknown) =>
    PUT(peticion(`/api/plan/${id}/gastos/${gastoId}`, "PUT", u?.cookie, cuerpo), contexto({ id, gastoId }));
  const quitar = (u: UsuarioDePrueba | null, id: string, gastoId: string) =>
    DELETE(peticion(`/api/plan/${id}/gastos/${gastoId}`, "DELETE", u?.cookie), contexto({ id, gastoId }));
  const lista = (u: UsuarioDePrueba | null, id: string) => GET(peticion(`/api/plan/${id}/gastos`, "GET", u?.cookie), contexto({ id }));
  const filas = async (id: string) => (await servicio.from("gastos").select("id, importe_centimos").eq("plan_id", id)).data ?? [];

  it("gas-ac2: el mismo PUT repetido no duplica y uno más viejo no pisa al más nuevo", async () => {
    const id = await plan("idem");
    expect((await poner(a, id, uuid(1), ENTRADAS)).status).toBe(200);
    expect((await poner(a, id, uuid(1), ENTRADAS)).status).toBe(200);
    expect((await poner(a, id, uuid(1), { ...ENTRADAS, importe_centimos: 1500, actualizado_cliente: T0 })).status).toBe(200);
    const l = await lista(a, id);
    expect(l.headers.get("cache-control")).toContain("no-store");
    expect(await l.json()).toMatchObject([{ id: uuid(1), importe_centimos: 1200 }]);
    expect((await poner(a, id, uuid(1), { ...ENTRADAS, importe_centimos: 1700, actualizado_cliente: "2027-01-01T11:00:00.000Z" })).status).toBe(200);
    expect(await filas(id)).toEqual([{ id: uuid(1), importe_centimos: 1700 }]);
  });

  it("gas-ac2: DELETE de lo que no existe da 204; categoría inválida, regla de día y fecha fuera del viaje dan 400 con texto; sin JSON 415", async () => {
    const id = await plan("reglas");
    expect((await quitar(a, id, uuid(2))).status).toBe(204);
    expect((await quitar(a, id, uuid(2))).status).toBe(204);
    const ocio = await poner(a, id, uuid(3), { ...ENTRADAS, categoria: "ocio" });
    expect(ocio.status).toBe(400);
    expect((await ocio.json()).error).toBe(E.categoria);
    expect((await (await poner(a, id, uuid(3), { ...ENTRADAS, categoria: "alojamiento" })).json()).error).toBe(E.alojamientoSinDia);
    expect((await (await poner(a, id, uuid(3), { ...ENTRADAS, fecha: null })).json()).error).toBe(E.elegirDia);
    const fueraDelViaje = await poner(a, id, uuid(3), { ...ENTRADAS, fecha: "2030-01-01" });
    expect(fueraDelViaje.status).toBe(400);
    expect((await fueraDelViaje.json()).error).toBe(E.fecha);
    expect((await poner(a, id, uuid(3), { ...ENTRADAS, categoria: "transporte", fecha: null })).status).toBe(200);
    const noJson = await PUT(
      new NextRequest(`http://localhost/api/plan/${id}/gastos/${uuid(4)}`, { method: "PUT", headers: { cookie: a.cookie, "content-type": "text/plain" }, body: "hola" }),
      contexto({ id, gastoId: uuid(4) }),
    );
    expect(noJson.status).toBe(415);
    expect(await filas(id)).toHaveLength(1);
  });

  it("gas-ac2: a partir del gasto 501 da 409 y editar uno existente sigue valiendo", async () => {
    const id = await plan("tope");
    const relleno = Array.from({ length: TOPE_GASTOS }, (_, i) => ({ id: uuid(1000 + i), plan_id: id, importe_centimos: 100, categoria: "transporte", actualizado_cliente: T0 }));
    expect((await servicio.from("gastos").insert(relleno)).error).toBeNull();
    const tope = await poner(a, id, uuid(9999), ENTRADAS);
    expect(tope.status).toBe(409);
    expect((await tope.json()).error).toBe(E.tope);
    expect((await poner(a, id, uuid(1000), { ...ENTRADAS, categoria: "transporte", fecha: null })).status).toBe(200);
    expect(await filas(id)).toHaveLength(TOPE_GASTOS);
  });

  it("gas-ac4: un id que ya existe en otro plan no se sobrescribe (400) y un ajeno recibe 404 y sin sesión 401", async () => {
    const x = await plan("x");
    const y = await plan("y");
    await poner(a, x, uuid(5), ENTRADAS);
    const otro = await poner(a, y, uuid(5), { ...ENTRADAS, importe_centimos: 1, actualizado_cliente: "2027-02-01T00:00:00.000Z" });
    expect(otro.status).toBe(400);
    expect((await otro.json()).error).toBe(E.otroPlan);
    expect(await filas(x)).toEqual([{ id: uuid(5), importe_centimos: 1200 }]);
    expect(await filas(y)).toHaveLength(0);
    expect((await lista(b, x)).status).toBe(404);
    expect((await poner(b, x, uuid(6), ENTRADAS)).status).toBe(404);
    expect((await quitar(b, x, uuid(5))).status).toBe(404);
    expect((await lista(null, x)).status).toBe(401);
    expect(await filas(x)).toHaveLength(1);
  });

  it("gas-ac4: el invitado no recibe gastos ni por la API de gastos ni en el plan", async () => {
    const id = await plan("invitado");
    await invitar(servicio, id, b.email, a.usuarioId);
    await poner(a, id, uuid(7), { ...ENTRADAS, concepto: "secreto-concepto" });
    expect((await lista(b, id)).status).toBe(404);
    const r = await GET_PLAN(peticion(`/api/plan/${id}`, "GET", b.cookie), contexto({ id }));
    const texto = await r.text();
    expect(texto).not.toContain("secreto-concepto");
    expect(Object.keys(JSON.parse(texto))).not.toContain("gastos");
  });

  it("gas-ac6: al eliminar el viaje se borran sus gastos de verdad", async () => {
    const id = await plan("eliminar");
    await poner(a, id, uuid(8), ENTRADAS);
    expect(await filas(id)).toHaveLength(1);
    const { data } = await servicio.from("trabajos").select("id").eq("plan_id", id).single();
    expect(await eliminarViaje(servicio, data!.id as string, a.usuarioId)).toBe(true);
    expect(await filas(id)).toHaveLength(0);
  });
});
