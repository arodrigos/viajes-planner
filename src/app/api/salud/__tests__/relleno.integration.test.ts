import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/salud/route";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import { _reiniciarCacheRellenoParaTests } from "@/lib/relleno";
import type { Dia, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PREFIJO = "plan-salud-test-";

function diaConParadas(nombres: string[]): Dia {
  return {
    fecha: "2026-11-01",
    franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
    paradas: nombres.map((nombre) => ({
      id: `${nombre}-id`,
      franja_id: "manana",
      nombre,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" },
      categoria: "monumento",
    })),
  };
}

async function sembrarTrabajo(
  supabase: ReturnType<typeof clienteDePrueba>,
  planId: string,
  destino: string,
  opciones: { eliminado?: boolean } = {},
): Promise<void> {
  const { error } = await supabase.from("trabajos").insert({
    tipo: "generacion",
    criterios: { destino_o_tipo: destino, fechas: { modo: "epoca", epoca: "otoño" }, dias: 1, personas: [{ edad: 30 }], perfil: "pareja", presupuesto_eur: 500 },
    estado: "completado",
    plan_id: planId,
    eliminado_en: opciones.eliminado ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`No se pudo sembrar el trabajo de prueba: ${error.message}`);
}

async function marcarParada(
  supabase: ReturnType<typeof clienteDePrueba>,
  idExterno: string,
  cambios: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.from("paradas").update(cambios).eq("id_externo", idExterno).select("id").single();
  if (error || !data) throw new Error(`No se pudo actualizar la parada de prueba: ${error?.message}`);
  return data.id as string;
}

// sal-ac1/sal-ac3: contra la pila real de Supabase, no contra un doble --
// "paradas_total >= 100" solo significa algo si la consulta de verdad podría
// fallar. Los otros ficheros de integración (p. ej. barrido) borran
// cualquier plan ajeno en su propio beforeEach (mismo motivo documentado
// ahí: fileParallelism:false hace seguro barrer lo que no es de este
// fichero), así que aquí se hace lo mismo para tener un recuento
// determinista en vez de depender de cuántos planes dejaron otros ficheros.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("GET /api/salud -- relleno (sal-ac1, sal-ac2, sal-ac3)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    _reiniciarCacheRellenoParaTests();
    await supabase.from("planes").delete().not("id", "like", `${PREFIJO}%`);
    await supabase.from("planes").delete().like("id", `${PREFIJO}%`);
  });

  it("cuadra el total, usa solo las veinticinco claves numéricas, y no publica ningún dato personal", async () => {
    // Plan 1: destino descriptivo real de un usuario, trabajo vivo, parada sin
    // intentar, ciudad efectiva ya resuelta (ciu-ac6).
    const plan1: Plan = {
      id: `${PREFIJO}londres`,
      version: 1,
      destino: "Londres en familia con niños",
      personas: 4,
      dias: [diaConParadas(["British Museum"])],
      ciudad: {
        estado: "resuelta",
        metodo: "paradas",
        nombre: "Greater London",
        nivel: "distrito",
        apoyo: 8,
        caja: { minLat: 51.28, maxLat: 51.69, minLon: -0.51, maxLon: 0.33 },
        intentado_en: new Date().toISOString(),
      },
    };
    await guardarPlan(supabase, plan1);
    await sembrarTrabajo(supabase, plan1.id, plan1.destino);

    // Plan 2: destino sin ciudad, trabajo vivo, parada no-resuelta, ciudad
    // efectiva "sin-ciudad-identificable" (ciu-ac6).
    const plan2: Plan = {
      id: `${PREFIJO}ciudad-con-ninos`,
      version: 1,
      destino: "Ciudad con niños",
      personas: 2,
      dias: [diaConParadas(["Parque infantil"])],
      ciudad: {
        estado: "sin-ciudad-identificable",
        motivo: "no hay una ciudad clara (Madrid 2, Valencia 2, Barcelona 1)",
        categoria_motivo: "sin-candidato-claro",
        candidatos: [{ nombre: "Madrid", apoyo: 2 }, { nombre: "Valencia", apoyo: 2 }, { nombre: "Barcelona", apoyo: 1 }],
        intentado_en: new Date().toISOString(),
      },
    };
    await guardarPlan(supabase, plan2);
    await sembrarTrabajo(supabase, plan2.id, plan2.destino);
    await marcarParada(supabase, "Parque infantil-id", {
      resolucion: { estado: "no-resuelta", intentado_en: new Date().toISOString(), motivo: "ningún candidato aceptable" },
    });

    // Plan 3: Sevilla, SIN trabajo vivo (el caso de Sevilla/Roma/Lisboa), parada
    // resuelta con foto y una alternativa.
    const plan3: Plan = {
      id: `${PREFIJO}sevilla`,
      version: 1,
      destino: "Sevilla",
      personas: 2,
      dias: [diaConParadas(["Real Alcázar"])],
    };
    await guardarPlan(supabase, plan3);
    const paradaSevillaId = await marcarParada(supabase, "Real Alcázar-id", {
      resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() },
      lat: 37.3826,
      lon: -5.9905,
      foto: { url: "https://example.com/foto.jpg", atribucion: "Wikipedia" },
    });
    await supabase.from("paradas_alternativas").insert({
      parada_id: paradaSevillaId,
      origen: "cercano",
      nombre: "Catedral de Sevilla",
      descripcion: "Catedral gótica",
      motivo: "A 300 m",
      duracion_min: 60,
      categoria: "monumento",
      lat: 37.3861,
      lon: -5.9926,
      lugar: { url: "https://www.openstreetmap.org/node/1" },
    });

    // Plan 4: sin ninguna versión (el caso "Oporto"): solo la fila de `planes`.
    const { error: errorPlan4 } = await supabase.from("planes").insert({ id: `${PREFIJO}oporto`, destino: "Oporto" });
    if (errorPlan4) throw new Error(`No se pudo sembrar el plan sin versión: ${errorPlan4.message}`);

    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const cuerpo = await respuesta.json();
    const relleno = cuerpo.relleno;

    expect(Object.keys(relleno).sort()).toEqual(
      [
        "paradas_total",
        "paradas_resueltas",
        "paradas_no_resueltas",
        "paradas_en_error",
        "paradas_sin_intentar",
        "paradas_con_foto",
        "paradas_con_alternativas",
        "paradas_con_categoria",
        "paradas_con_guia",
        "paradas_con_motivo",
        "versiones_con_eventos",
        "versiones_multiciudad",
        "trabajos_inviables",
        "planes_total",
        "planes_sin_version",
        "planes_sin_trabajo_vivo",
        "planes_con_ciudad",
        "planes_sin_ciudad_identificable",
        "planes_sellados_pocas_paradas",
        "planes_sellados_sin_caja",
        "planes_sellados_zona_grande",
        "planes_sellados_sin_contencion",
        "planes_sellados_sin_ventaja",
        "planes_sellados_sin_candidato_claro",
        "planes_sellados_ciudad_no_encontrada",
      ].sort(),
    );
    expect(new Set(Object.values(relleno).map((v) => typeof v))).toEqual(new Set(["number"]));
    expect(Object.values(relleno).every((v) => (v as number) >= 0)).toBe(true);

    expect(relleno.paradas_total).toBe(3);
    expect(relleno.paradas_resueltas).toBe(1);
    expect(relleno.paradas_no_resueltas).toBe(1);
    expect(relleno.paradas_en_error).toBe(0);
    expect(relleno.paradas_sin_intentar).toBe(1);
    expect(relleno.paradas_total).toBe(
      relleno.paradas_resueltas + relleno.paradas_no_resueltas + relleno.paradas_en_error + relleno.paradas_sin_intentar,
    );
    expect(relleno.paradas_con_foto).toBe(1);
    expect(relleno.paradas_con_alternativas).toBe(1);
    expect(relleno.planes_total).toBe(4);
    expect(relleno.planes_sin_version).toBe(1);
    expect(relleno.planes_sin_trabajo_vivo).toBe(2); // Sevilla y Oporto
    expect(relleno.planes_con_ciudad).toBe(1); // Londres
    expect(relleno.planes_sin_ciudad_identificable).toBe(1); // Ciudad con niños
    expect(relleno.planes_con_ciudad + relleno.planes_sin_ciudad_identificable).toBeLessThan(relleno.planes_total);
    expect(relleno.planes_sellados_sin_candidato_claro).toBe(1); // Ciudad con niños
    expect(relleno.planes_sellados_pocas_paradas).toBe(0);
    expect(relleno.planes_sellados_sin_caja).toBe(0);
    expect(relleno.planes_sellados_zona_grande).toBe(0);
    expect(relleno.planes_sellados_sin_contencion).toBe(0);
    expect(relleno.planes_sellados_sin_ventaja).toBe(0);
    expect(relleno.planes_sellados_ciudad_no_encontrada).toBe(0);

    // Modelo de amenazas: `relleno` no puede contener ni un destino, ni un
    // nombre de parada, ni un correo, ni un identificador de usuario.
    const textoRespuesta = JSON.stringify(cuerpo.relleno);
    for (const literal of ["londres", "ciudad con", "sevilla", "british museum", "real alcázar", "parque infantil"]) {
      expect(textoRespuesta.toLowerCase()).not.toContain(literal);
    }
    expect(textoRespuesta).not.toMatch(/@/);
    expect(textoRespuesta).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  // cp-sco-01: los tres contadores nuevos cuentan exactamente lo que dicen.
  it("cuenta versiones multiciudad, trabajos inviables y paradas con motivo (cp-sco-01)", async () => {
    const vacio = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(vacio.relleno.versiones_multiciudad).toBe(0);
    expect(vacio.relleno.trabajos_inviables).toBe(0);
    expect(vacio.relleno.paradas_con_motivo).toBe(0);

    const etapa = (nombre: string, diaInicio: number) => ({
      ciudad: { estado: "resuelta", nombre },
      pais: "España",
      dias: 1,
      dia_inicio: diaInicio,
      alojamiento_noche_eur: 80,
      zona: 1,
      ajustes: [],
    });
    const multiciudad: Plan = {
      id: `${PREFIJO}multi`,
      version: 1,
      destino: "Ruta de dos ciudades",
      personas: 2,
      dias: [diaConParadas(["Parada uno"])],
      etapas: [etapa("Toledo", 0), etapa("Segovia", 1)] as unknown as Plan["etapas"],
    };
    await guardarPlan(supabase, multiciudad);
    const unaCiudad: Plan = { id: `${PREFIJO}una`, version: 1, destino: "Una ciudad", personas: 2, dias: [diaConParadas(["Parada dos"])] };
    await guardarPlan(supabase, unaCiudad);
    // guardarPlan escribe null cuando no hay etapas; el [] solo puede venir de un insert directo.
    const { error: errorVacia } = await supabase
      .from("plan_versiones")
      .insert({ plan_id: unaCiudad.id, version: 2, personas: 2, dias: [], etapas: [] });
    if (errorVacia) throw new Error(`No se pudo sembrar la versión con etapas vacías: ${errorVacia.message}`);

    await sembrarTrabajo(supabase, multiciudad.id, multiciudad.destino);
    await sembrarTrabajo(supabase, unaCiudad.id, unaCiudad.destino);
    const { error: errorInviable } = await supabase
      .from("trabajos")
      .update({ inviable: { razones: ["No caben en tres días"], sugerencias: [] } })
      .eq("plan_id", multiciudad.id);
    if (errorInviable) throw new Error(`No se pudo marcar el trabajo como inviable: ${errorInviable.message}`);

    const motivos: Array<[string, string | null]> = [
      ["Con motivo uno", "Ideal con niños"],
      ["Con motivo dos", "Vistas al río"],
      ["Motivo vacío", ""],
      ["Sin motivo", null],
    ];
    const conMotivos: Plan = {
      id: `${PREFIJO}motivos`,
      version: 1,
      destino: "Con motivos",
      personas: 2,
      dias: [diaConParadas(motivos.map(([nombre]) => nombre))],
    };
    await guardarPlan(supabase, conMotivos);
    for (const [nombre, motivo] of motivos) await marcarParada(supabase, `${nombre}-id`, { motivo });

    _reiniciarCacheRellenoParaTests();
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    const relleno = cuerpo.relleno;
    expect(relleno.versiones_multiciudad).toBe(1);
    expect(relleno.trabajos_inviables).toBe(1);
    expect(relleno.paradas_con_motivo).toBe(2);
    expect(Object.keys(relleno)).toHaveLength(25);
    expect(new Set(Object.values(relleno).map((v) => typeof v))).toEqual(new Set(["number"]));

    const texto = JSON.stringify(relleno).toLowerCase();
    for (const literal of ["ruta de dos", "una ciudad", "con motivos", "parada uno", "ideal con niños", "toledo"]) {
      expect(texto).not.toContain(literal);
    }
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("si una consulta de recuento falla, la respuesta omite relleno entero y conserva el resto", async () => {
    // Un esquema que no existe fuerza el error sin tocar la pila real.
    const original = process.env.SUPABASE_SCHEMA;
    process.env.SUPABASE_SCHEMA = "esquema_que_no_existe";
    try {
      const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
      const cuerpo = await respuesta.json();
      expect(cuerpo).not.toHaveProperty("relleno");
      expect(cuerpo).toHaveProperty("commit");
    } finally {
      process.env.SUPABASE_SCHEMA = original;
    }
  });
});
