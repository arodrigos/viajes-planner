import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { fuenteZonasGrabada } from "@/lib/testing/nominatimGrabado";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { procesarTrabajo } from "@/lib/trabajador/procesarTrabajo";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Portugal, Grecia",
  fechas: { modo: "epoca", epoca: "verano" },
  dias: 10,
  personas: [{ edad: 41 }, { edad: 39 }, { edad: 11 }, { edad: 8 }],
  perfil: "familiar",
  presupuesto_eur: 5000,
  transporte: ["tren", "autobus"],
};

function dobleContador(): EjecutorModelo & { invocaciones: number } {
  const doble = {
    invocaciones: 0,
    async invocar(): Promise<ResultadoInvocacion> {
      doble.invocaciones += 1;
      return { texto: "{}" };
    },
  };
  return doble;
}

// dmc-ac2/dmc-ac4: el descarte previo deja la fila en fallido/inviable sin
// invocar al modelo; un viaje viable sí sigue al modelo.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("procesarTrabajo con un viaje de varias ciudades (dmc-ac2)", () => {
  const supabase = clienteDePrueba();

  async function crear(criterios: CriteriosViaje) {
    const { data: usuario } = await supabase.auth.admin.createUser({ email: `inviable-${Date.now()}-${Math.random()}@ej.com`, email_confirm: true });
    const { data, error } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuario.user!.id, tipo: "generacion", criterios })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el trabajo: ${error?.message}`);
    return data.id as string;
  }

  it("un viaje imposible termina fallido/inviable, con razones y 0 invocaciones del modelo", async () => {
    const id = await crear(CRITERIOS);
    const ejecutor = dobleContador();
    const { fuente } = fuenteZonasGrabada();
    const resultado = await procesarTrabajo(supabase, { id, plan_id: null, criterios: CRITERIOS }, { ejecutor, directorio: "/tmp", fuenteLugares: fuente });
    expect(resultado.estado).toBe("fallido");
    expect(ejecutor.invocaciones).toBe(0);

    const { data } = await supabase.from("trabajos").select("estado, motivo, inviable").eq("id", id).single();
    expect(data?.estado).toBe("fallido");
    expect(data?.motivo).toBe("inviable");
    const inviable = data?.inviable as { razones: { codigo: string; texto: string }[]; sugerencias: string[] };
    // Invariante 4: código válido y al menos una razón.
    expect(["dias", "distancia", "presupuesto", "zona-sin-etapa"]).toContain(inviable.razones[0].codigo);
    expect(inviable.razones[0].codigo).toBe("distancia");
    expect(inviable.razones[0].texto).toMatch(/Portugal.*Grecia.*4 h/);
  });

  it("un viaje viable no queda inviable: sigue al modelo", async () => {
    const criterios = { ...CRITERIOS, transporte: ["avion", "tren"] } as CriteriosViaje;
    const id = await crear(criterios);
    const ejecutor = dobleContador();
    const { fuente } = fuenteZonasGrabada();
    await procesarTrabajo(supabase, { id, plan_id: null, criterios }, { ejecutor, directorio: "/tmp", fuenteLugares: fuente });
    expect(ejecutor.invocaciones).toBeGreaterThan(0);
    const { data } = await supabase.from("trabajos").select("inviable").eq("id", id).single();
    expect(data?.inviable).toBeNull();
  });
});
