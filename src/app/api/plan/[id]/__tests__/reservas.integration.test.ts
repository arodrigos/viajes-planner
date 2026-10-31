import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { idPlanProteccion, limpiarPlanesProteccion, sembrarPlanEdicion } from "@/test-utils/semilla-edicion";
import { peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { DELETE, GET, POST } from "../[...ruta]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ENTRADA = { tipo: "entrada", nombre: "Alcázar", fecha_inicio: "2027-03-05", hora_inicio: "10:30" };

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("reservas por la ruta agrupada (reg-ac3)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let duenyo: UsuarioDePrueba;
  let ajeno: UsuarioDePrueba;

  beforeAll(async () => {
    await limpiarPlanesProteccion(servicio);
    duenyo = await usuarioDePrueba("ci-test-prot-duenyo@example.com");
    ajeno = await usuarioDePrueba("ci-test-prot-ajeno@example.com");
  });
  afterAll(async () => {
    await limpiarPlanesProteccion(servicio, planes);
  });

  async function plan() {
    const id = idPlanProteccion("reservas");
    planes.push(id);
    await sembrarPlanEdicion(servicio, id, duenyo.usuarioId);
    return id;
  }
  const alta = (u: UsuarioDePrueba, id: string) => POST(peticion(`/api/plan/${id}/reservas`, "POST", u.cookie, ENTRADA));
  const lista = (u: UsuarioDePrueba, id: string) => GET(peticion(`/api/plan/${id}/reservas`, "GET", u.cookie));
  const borrar = (u: UsuarioDePrueba, id: string, reservaId: string) =>
    DELETE(peticion(`/api/plan/${id}/reservas/${reservaId}`, "DELETE", u.cookie));
  const filas = async (id: string) => (await servicio.from("reservas").select("id").eq("plan_id", id)).data ?? [];

  it("el dueño crea, lista y borra; un ajeno no puede crear ni borrar", async () => {
    const id = await plan();
    const creada = await alta(duenyo, id);
    expect(creada.status).toBe(201);
    const { id: reservaId } = await creada.json();
    expect(typeof reservaId).toBe("string");

    const l = await lista(duenyo, id);
    expect(l.status).toBe(200);
    const items = (await l.json()) as { id: string }[];
    expect(items.map((r) => r.id)).toEqual([reservaId]);

    expect((await borrar(ajeno, id, reservaId)).status).toBe(404);
    expect(await filas(id)).toHaveLength(1);

    expect((await borrar(duenyo, id, reservaId)).status).toBe(204);
    expect(await filas(id)).toHaveLength(0);
  });

  it("un ajeno que intenta crear recibe 404 y no deja ninguna reserva", async () => {
    const id = await plan();
    expect((await alta(ajeno, id)).status).toBe(404);
    expect(await filas(id)).toHaveLength(0);
  });
});
