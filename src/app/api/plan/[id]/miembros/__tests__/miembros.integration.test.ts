import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { MAX_MIEMBROS, MENSAJES_MIEMBROS } from "@/lib/plan/miembros";
import { DELETE } from "../[miembroId]/route";
import { GET, POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("/api/plan/[id]/miembros (cmd-ac2)", () => {
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
    await limpiarPlanes(servicio, planes);
  });

  async function plan(sufijo: string) {
    const id = `plan-miembros-${sufijo}-${Date.now()}`;
    planes.push(id);
    await sembrar(id);
    return id;
  }
  const sembrar = (id: string) => sembrarPlan(servicio, id, a.usuarioId);
  const invitarComo = (u: UsuarioDePrueba, id: string, correo: unknown) => POST(peticion(`/api/plan/${id}/miembros`, "POST", u.cookie, { correo }), contexto({ id }));
  const filas = async (id: string) => (await servicio.from("miembros_plan").select("correo").eq("plan_id", id)).data ?? [];

  it("el dueño invita (201, normalizado), repetir da 200 sin duplicar y aparece en GET", async () => {
    const id = await plan("invitar");
    const r = await invitarComo(a, id, "CI-Test-Comp-Miembro@Example.com ");
    expect(r.status).toBe(201);
    expect((await r.json()).correo).toBe(b.email);
    expect((await invitarComo(a, id, b.email)).status).toBe(200);
    expect(await filas(id)).toHaveLength(1);
    const lista = await GET(peticion(`/api/plan/${id}/miembros`, "GET", a.cookie), contexto({ id }));
    expect(lista.status).toBe(200);
    expect((await lista.json()).miembros).toMatchObject([{ correo: b.email }]);
  });

  it("422 con el texto declarado fuera de la lista, con el propio correo y con el 11.º; 400 si no es un correo", async () => {
    const id = await plan("limites");
    const fuera = await invitarComo(a, id, "z@example.com");
    expect(fuera.status).toBe(422);
    expect((await fuera.json()).error).toBe(MENSAJES_MIEMBROS.noPermitido);
    const propio = await invitarComo(a, id, a.email);
    expect(propio.status).toBe(422);
    expect((await propio.json()).error).toBe(MENSAJES_MIEMBROS.propio);
    expect((await invitarComo(a, id, "no-es-un-correo")).status).toBe(400);
    expect((await invitarComo(a, id, undefined)).status).toBe(400);

    // Se llenan los 10 puestos directamente en la base y el siguiente se rechaza.
    for (let i = 0; i < MAX_MIEMBROS; i++) await invitar(servicio, id, `relleno-${i}@example.com`, a.usuarioId);
    const lleno = await invitarComo(a, id, b.email);
    expect(lleno.status).toBe(422);
    expect((await lleno.json()).error).toBe(MENSAJES_MIEMBROS.lleno);
    expect(await filas(id)).toHaveLength(MAX_MIEMBROS);
  });

  it("un miembro recibe 403 y un ajeno 404, en GET, POST y DELETE, sin cambiar nada", async () => {
    const id = await plan("roles");
    const miembroId = await invitar(servicio, id, b.email, a.usuarioId);
    for (const [usuario, estado] of [[b, 403], [c, 404]] as const) {
      expect((await invitarComo(usuario, id, a.email)).status).toBe(estado);
      expect((await GET(peticion(`/api/plan/${id}/miembros`, "GET", usuario.cookie), contexto({ id }))).status).toBe(estado);
      expect((await DELETE(peticion(`/api/plan/${id}/miembros/${miembroId}`, "DELETE", usuario.cookie), contexto({ id, miembroId }))).status).toBe(estado);
    }
    expect(await filas(id)).toHaveLength(1);
  });

  it("DELETE quita la fila (204) y un miembroId de otro plan da 404 sin tocar el suyo", async () => {
    const id = await plan("quitar");
    const otro = await plan("quitar-otro");
    const miembroId = await invitar(servicio, id, b.email, a.usuarioId);
    const deOtro = await invitar(servicio, otro, b.email, a.usuarioId);

    const cruzado = await DELETE(peticion(`/api/plan/${id}/miembros/${deOtro}`, "DELETE", a.cookie), contexto({ id, miembroId: deOtro }));
    expect(cruzado.status).toBe(404);
    expect(await filas(otro)).toHaveLength(1);

    const r = await DELETE(peticion(`/api/plan/${id}/miembros/${miembroId}`, "DELETE", a.cookie), contexto({ id, miembroId }));
    expect(r.status).toBe(204);
    expect(await filas(id)).toHaveLength(0);
    expect((await DELETE(peticion(`/api/plan/${id}/miembros/no-es-uuid`, "DELETE", a.cookie), contexto({ id, miembroId: "no-es-uuid" }))).status).toBe(404);
  });

  it("sin sesión responde 401", async () => {
    const id = await plan("sinsesion");
    expect((await GET(peticion(`/api/plan/${id}/miembros`, "GET"), contexto({ id }))).status).toBe(401);
  });
});
