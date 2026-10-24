import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { eliminarViaje } from "@/lib/cola/eliminar";
import { TOPE_RESERVAS } from "@/lib/reservas/tipos";
import { TEXTOS_RESERVAS } from "@/lib/textos/reservas";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { GET as GET_PLAN } from "../../route";
import { DELETE, PATCH } from "../[reservaId]/route";
import { GET, POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const VUELO = { tipo: "vuelo", sentido: "ida", origen: "MAD", destino: "FCO", fecha_inicio: "2027-03-05", hora_inicio: "08:00", fecha_fin: "2027-03-05", hora_fin: "13:00", localizador: "ABC123" };
const ENTRADA = { tipo: "entrada", nombre: "Borghese", fecha_inicio: "2027-03-05", hora_inicio: "10:30" };

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("/api/plan/[id]/reservas (res-ac1, res-ac3..res-ac7)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    c = await usuarioDePrueba("ci-test-comp-ajeno@example.com");
  });

  afterAll(async () => {
    for (const id of planes) await servicio.from("reservas").delete().eq("plan_id", id);
    await limpiarPlanes(servicio, planes);
  });

  async function plan(sufijo: string) {
    const id = `plan-reservas-${sufijo}-${Date.now()}`;
    planes.push(id);
    await sembrarPlan(servicio, id, a.usuarioId);
    return id;
  }
  const alta = (u: UsuarioDePrueba | null, id: string, cuerpo: unknown) => POST(peticion(`/api/plan/${id}/reservas`, "POST", u?.cookie, cuerpo), contexto({ id }));
  const lista = (u: UsuarioDePrueba | null, id: string) => GET(peticion(`/api/plan/${id}/reservas`, "GET", u?.cookie), contexto({ id }));
  const filas = async (id: string) => (await servicio.from("reservas").select("id").eq("plan_id", id)).data ?? [];

  it("res-ac1: el dueño da de alta un vuelo (201) y sigue en la lista al volver a pedirla", async () => {
    const id = await plan("alta");
    const r = await alta(a, id, VUELO);
    expect(r.status).toBe(201);
    const creada = await r.json();
    const l = await lista(a, id);
    expect(l.status).toBe(200);
    expect(l.headers.get("cache-control")).toContain("no-store");
    expect(await l.json()).toMatchObject([{ id: creada.id, tipo: "vuelo", origen: "MAD", destino: "FCO", hora_fin: "13:00", localizador: "ABC123" }]);
  });

  it("res-ac3: 400 con errores por campo, 415 sin JSON y 409 en la reserva 31, sin guardar nada de más", async () => {
    const id = await plan("limites");
    const mala = await alta(a, id, { ...VUELO, hora_fin: undefined });
    expect(mala.status).toBe(400);
    expect(Object.keys((await mala.json()).errores)).toContain("hora_fin");
    const noJson = await POST(
      new NextRequest(`http://localhost/api/plan/${id}/reservas`, { method: "POST", headers: { cookie: a.cookie, "content-type": "text/plain" }, body: "hola" }),
      contexto({ id }),
    );
    expect(noJson.status).toBe(415);
    expect(await filas(id)).toHaveLength(0);

    const relleno = Array.from({ length: TOPE_RESERVAS }, (_, i) => ({ plan_id: id, tipo: "entrada", nombre: `E${i}`, fecha_inicio: "2027-03-05", hora_inicio: "10:30" }));
    expect((await servicio.from("reservas").insert(relleno)).error).toBeNull();
    const tope = await alta(a, id, ENTRADA);
    expect(tope.status).toBe(409);
    expect((await tope.json()).error).toBe(TEXTOS_RESERVAS.tope);
    expect(await filas(id)).toHaveLength(TOPE_RESERVAS);
  });

  it("res-ac4: un ajeno y un invitado reciben 404 en todo y sin sesión 401, sin cambiar nada", async () => {
    const id = await plan("ajenos");
    await invitar(servicio, id, b.email, a.usuarioId);
    const creada = await (await alta(a, id, ENTRADA)).json();
    for (const u of [b, c]) {
      expect((await lista(u, id)).status).toBe(404);
      expect((await alta(u, id, VUELO)).status).toBe(404);
      const p = await PATCH(peticion(`/api/plan/${id}/reservas/${creada.id}`, "PATCH", u.cookie, ENTRADA), contexto({ id, reservaId: creada.id }));
      expect(p.status).toBe(404);
      const d = await DELETE(peticion(`/api/plan/${id}/reservas/${creada.id}`, "DELETE", u.cookie), contexto({ id, reservaId: creada.id }));
      expect(d.status).toBe(404);
    }
    expect((await lista(null, id)).status).toBe(401);
    expect((await alta(null, id, VUELO)).status).toBe(401);
    expect(await filas(id)).toHaveLength(1);
  });

  it("res-ac5: el invitado ve en el plan solo id, tipo, sentido, fecha y hora; el localizador nunca sale", async () => {
    const id = await plan("publico");
    await invitar(servicio, id, b.email, a.usuarioId);
    await alta(a, id, { ...VUELO, notas: "pasaporte 123" });
    const r = await GET_PLAN(peticion(`/api/plan/${id}`, "GET", b.cookie), contexto({ id }));
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain("ABC123");
    expect(texto).not.toContain("pasaporte 123");
    const reservas = JSON.parse(texto).reservas as Record<string, unknown>[];
    expect(reservas).toHaveLength(1);
    for (const x of reservas) expect(Object.keys(x).every((k) => ["id", "tipo", "sentido", "fecha", "hora"].includes(k))).toBe(true);
  });

  it("res-ac6: al eliminar el viaje se borran sus reservas de verdad", async () => {
    const id = await plan("eliminar");
    await alta(a, id, VUELO);
    await alta(a, id, ENTRADA);
    expect(await filas(id)).toHaveLength(2);
    const { data } = await servicio.from("trabajos").select("id").eq("plan_id", id).single();
    expect(await eliminarViaje(servicio, data!.id as string, a.usuarioId)).toBe(true);
    expect(await filas(id)).toHaveLength(0);
  });

  it("res-ac7: el texto libre se limpia de controles antes de guardarse", async () => {
    const id = await plan("texto");
    const r = await alta(a, id, { ...ENTRADA, nombre: "Bor\u0000ghese", notas: "<b>hola</b>" });
    expect(r.status).toBe(201);
    const { data } = await servicio.from("reservas").select("nombre, notas").eq("plan_id", id).single();
    expect(data?.nombre).toBe("Borghese");
    expect(data?.notas).toBe("<b>hola</b>");
  });
});
