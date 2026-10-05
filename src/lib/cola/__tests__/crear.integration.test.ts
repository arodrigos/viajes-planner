import { beforeAll, describe, expect, it } from "vitest";
import { crearTrabajoGeneracion } from "@/lib/cola/crear";
import { LIMITE_TRABAJOS_POR_HORA } from "@/lib/cola/config";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS_VALIDOS = {
  destino_o_tipo: "Lisboa",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 4,
  personas: [{ edad: 38 }, { edad: 36 }],
  perfil: "pareja",
  presupuesto_eur: 1200,
};

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("crearTrabajoGeneracion (acceso-ac3)", () => {
  const supabase = clienteDePrueba();
  let usuarioId = "";

  beforeAll(async () => {
    const correo = `crear-trabajo-${Date.now()}@ej.com`;
    const { data, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  it("tra-ac1: el transporte elegido llega a la fila; un medio desconocido da 400 y no encola", async () => {
    const resultado = await crearTrabajoGeneracion(supabase, usuarioId, { ...CRITERIOS_VALIDOS, transporte: ["tren", "autobus"] });
    expect(resultado.estado).toBe("creado");
    if (resultado.estado !== "creado") return;
    const { data } = await supabase.from("trabajos").select("criterios").eq("id", resultado.id).single();
    expect(data?.criterios).toMatchObject({ transporte: ["tren", "autobus"] });

    const invalido = await crearTrabajoGeneracion(supabase, usuarioId, { ...CRITERIOS_VALIDOS, transporte: ["barco"] });
    expect(invalido).toEqual({ estado: "criterios-invalidos", errores: ["Medio de transporte no válido"] });
  });

  it("con criterios válidos encola el trabajo y devuelve su id al instante", async () => {
    const antes = Date.now();
    const resultado = await crearTrabajoGeneracion(supabase, usuarioId, CRITERIOS_VALIDOS);
    expect(Date.now() - antes).toBeLessThan(1000);
    expect(resultado.estado).toBe("creado");
    if (resultado.estado !== "creado") return;

    const { data } = await supabase.from("trabajos").select("estado, criterios").eq("id", resultado.id).single();
    expect(data?.estado).toBe("encolado");
    expect(data?.criterios).toEqual(CRITERIOS_VALIDOS);
  });

  it("con criterios inválidos no encola nada", async () => {
    const resultado = await crearTrabajoGeneracion(supabase, usuarioId, { destino_o_tipo: "" });
    expect(resultado.estado).toBe("criterios-invalidos");
  });

  it("superado el límite por hora, deja de encolar (acceso-ac1 en la capa de cola)", async () => {
    const correo = `limite-cola-${Date.now()}@ej.com`;
    const { data: usuario, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

    for (let i = 0; i < LIMITE_TRABAJOS_POR_HORA; i++) {
      const resultado = await crearTrabajoGeneracion(supabase, usuario.user.id, CRITERIOS_VALIDOS);
      expect(resultado.estado).toBe("creado");
    }

    const resultado = await crearTrabajoGeneracion(supabase, usuario.user.id, CRITERIOS_VALIDOS);
    expect(resultado.estado).toBe("limite-superado");

    const { count } = await supabase
      .from("trabajos")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", usuario.user.id);
    expect(count).toBe(LIMITE_TRABAJOS_POR_HORA);
  });
});
