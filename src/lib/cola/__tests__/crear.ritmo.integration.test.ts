import { beforeAll, describe, expect, it } from "vitest";
import { crearTrabajoGeneracion } from "@/lib/cola/crear";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS = {
  destino_o_tipo: "Valencia",
  fechas: { modo: "epoca", epoca: "diciembre" },
  dias: 3,
  personas: [{ edad: 40 }, { edad: 38 }, { edad: 7 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("crearTrabajoGeneracion con ritmo e intereses (rit-ac1, rit-ac3)", () => {
  const supabase = clienteDePrueba();
  let usuarioId = "";

  beforeAll(async () => {
    const { data, error } = await supabase.auth.admin.createUser({ email: `crear-ritmo-${Date.now()}@ej.com`, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  it("el ritmo y los intereses, en su orden, se guardan y se leen de vuelta", async () => {
    const r = await crearTrabajoGeneracion(supabase, usuarioId, { ...CRITERIOS, ritmo: "tranquilo", intereses: ["museos", "parques-ninos"] });
    expect(r.estado).toBe("creado");
    if (r.estado !== "creado") return;
    const { data } = await supabase.from("trabajos").select("criterios").eq("id", r.id).single();
    expect(data?.criterios).toMatchObject({ ritmo: "tranquilo", intereses: ["museos", "parques-ninos"] });
  });

  it("un interés fuera de la lista, o más de tres, no encolan nada", async () => {
    const fuera = await crearTrabajoGeneracion(supabase, usuarioId, { ...CRITERIOS, intereses: ["museos", "playa"] });
    expect(fuera.estado).toBe("criterios-invalidos");
    const cuatro = await crearTrabajoGeneracion(supabase, usuarioId, { ...CRITERIOS, intereses: ["museos", "naturaleza", "compras", "monumentos"] });
    expect(cuatro.estado).toBe("criterios-invalidos");
  });
});
