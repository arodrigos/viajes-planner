import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import { motivoDeSitio } from "@/lib/plan/publico";
import type { CandidatoLugar, FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { FuenteCercanos } from "@/lib/alternativas/cercanos";
import type { InfoResolucion, Plan } from "@/lib/plan/tipos";
import { completarParadasPendientes } from "@/lib/trabajador/barrido";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESTINO = "Fez-sitio-propio-test";
const BBOX = { minLat: 39, maxLat: 40, minLon: -1, maxLon: 0 };
const CIUDAD: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: DESTINO, caja: BBOX, intentado_en: "2026-10-01T00:00:00Z" };
const NOTA = "NOTA-SECRETA-123";
const FUENTE_FOTOS = crearFuenteFotosGrabada({ paginas: {}, imagenes: {}, geosearch: {} });
const FUENTE_CERCANOS: FuenteCercanos = { async buscar() { return []; } };

function candidato(nombre: string): CandidatoLugar {
  return {
    fuente: "osm",
    id: `osm:node/${nombre}`,
    url: `https://www.openstreetmap.org/node/${nombre}`,
    nombreFuente: nombre,
    nombresAlternativos: [],
    lat: 39.47,
    lon: -0.37,
    categoriaOsm: "amenity",
    tipoOsm: "restaurant",
    etiquetas: {},
  };
}

// Espía: guarda todo lo que el trabajador manda a las fuentes externas, para
// comprobar que la nota privada no sale nunca (spd-ac6).
function fuenteEspia(nominatim: Record<string, CandidatoLugar[]>): FuenteLugares & FuenteCiudad & { peticiones: string[] } {
  const peticiones: string[] = [];
  return {
    peticiones,
    async geocodificarDestino() {
      return BBOX;
    },
    async buscarNominatim(nombre: string, ...resto: unknown[]) {
      peticiones.push(JSON.stringify([nombre, ...resto]));
      return nominatim[nombre] ?? [];
    },
    async buscarWikipedia(nombre: string, ...resto: unknown[]) {
      peticiones.push(JSON.stringify([nombre, ...resto]));
      return [];
    },
    async buscarLibre() {
      throw new Error("este fichero siembra ciudad ya resuelta");
    },
    async geocodificarCiudad() {
      throw new Error("este fichero siembra ciudad ya resuelta");
    },
  };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("sitio propio en el barrido (spd-ac2, spd-ac6)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-barrido-propio-%");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    // Mismo motivo que barrido.integration.test.ts: el recuento de paradas
    // pendientes solo es determinista sin planes de otros ficheros.
    await supabase.from("planes").delete().not("id", "like", "plan-barrido-propio-%");
  });

  it("resuelve un sitio propio sin categoría y deja el inexistente en no-encontrado con su motivo; la nota no sale", async () => {
    const planId = "plan-barrido-propio-1";
    const plan: Plan = {
      id: planId,
      version: 1,
      destino: DESTINO,
      personas: 2,
      ciudad: CIUDAD,
      dias: [
        {
          fecha: "2026-11-01",
          franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
          paradas: ["Casa Fassi", "Zzqx Sitio Inventado"].map((nombre, i) => ({
            id: `propia-0000000${i}`,
            franja_id: "manana",
            nombre,
            descripcion: "",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" as const },
            propia: true,
            nota: NOTA,
          })),
        },
      ],
    };
    await guardarPlan(supabase, plan);

    const fuente = fuenteEspia({ "Casa Fassi": [candidato("Casa Fassi")] });
    await completarParadasPendientes(supabase, fuente, 120, FUENTE_FOTOS, undefined, undefined, FUENTE_CERCANOS);

    expect(fuente.peticiones.length).toBeGreaterThan(0);
    expect(fuente.peticiones.filter((p) => p.includes(NOTA))).toHaveLength(0);

    const { data } = await supabase.from("paradas").select("nombre, lat, resolucion, nota").in("nombre", ["Casa Fassi", "Zzqx Sitio Inventado"]);
    const porNombre = new Map((data ?? []).map((f) => [f.nombre as string, f]));
    const fassi = porNombre.get("Casa Fassi");
    expect((fassi?.resolucion as InfoResolucion).estado).toBe("resuelta");
    expect(fassi?.lat).toBeCloseTo(39.47);

    const inventado = porNombre.get("Zzqx Sitio Inventado");
    const resolucion = inventado?.resolucion as InfoResolucion;
    expect(resolucion.estado).toBe("no-resuelta");
    expect(motivoDeSitio({ nombre: "Zzqx Sitio Inventado", resolucion }, DESTINO)).toBe(
      `No hemos encontrado «Zzqx Sitio Inventado» en el mapa de ${DESTINO}. Revisa cómo se escribe.`,
    );
    // La nota sigue guardada: solo se asegura que no viaja fuera.
    expect(inventado?.nota).toBe(NOTA);
  });
});
