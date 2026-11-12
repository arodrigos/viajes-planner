import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { POST } from "../manejador";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Cuerpo como el que produce la importación de hotel-booking.ics, con un
// salto de línea en el nombre: lo que un .ics ajeno podría traer.
const HOTEL_IMPORTADO = { tipo: "hotel", nombre: "Hotel\r\nX", fecha_inicio: "2027-07-03", fecha_fin: "2027-07-09", direccion: "Via dei Fiori 12, Roma", ubicacion: { lat: 41.9, lon: 12.49 } };

// imp-ac6: la importación no tiene ruta propia; estas pruebas fijan que guardar
// por la ruta de siempre sigue siendo cosa solo del dueño.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/reservas con un cuerpo importado (imp-ac6, imp-ruta-roles)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-imp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-imp-ajeno@example.com");
    c = await usuarioDePrueba("ci-test-imp-invitado@example.com");
  });

  afterAll(async () => {
    for (const id of planes) await servicio.from("reservas").delete().eq("plan_id", id);
    await limpiarPlanes(servicio, planes);
  });

  it("el dueño guarda (201, nombre limpio), un ajeno y un invitado reciben 404 y sin sesión 401; solo sube una fila", async () => {
    const id = `plan-importar-${Date.now()}`;
    planes.push(id);
    await sembrarPlan(servicio, id, a.usuarioId);
    await invitar(servicio, id, c.email, a.usuarioId);
    const alta = (u: UsuarioDePrueba | null) => POST(peticion(`/api/plan/${id}/reservas`, "POST", u?.cookie, HOTEL_IMPORTADO), contexto({ id }));

    const dueno = await alta(a);
    expect(dueno.status).toBe(201);
    for (const u of [b, c]) {
      const r = await alta(u);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "no encontrado" });
    }
    expect((await alta(null)).status).toBe(401);

    const { data } = await servicio.from("reservas").select("nombre").eq("plan_id", id);
    expect(data).toEqual([{ nombre: "HotelX" }]);
  });
});
