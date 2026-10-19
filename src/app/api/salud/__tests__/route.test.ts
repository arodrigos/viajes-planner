import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reiniciarCacheRellenoParaTests } from "@/lib/relleno";

const rpc = vi.fn();
let filaSalud: unknown = null;

// Consulta encadenable que siempre responde «sin filas»: lo único que este
// test necesita es que comprobarSupabase salga bien y la rpc sea lo que falla.
function consultaVacia() {
  const consulta: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "order", "limit"]) consulta[metodo] = () => consulta;
  consulta.maybeSingle = () => Promise.resolve({ data: filaSalud, error: null });
  return consulta;
}

vi.mock("@/lib/db/cliente", () => ({
  clienteServicio: () => ({ from: () => consultaVacia(), rpc }),
}));

import { GET } from "@/app/api/salud/route";

beforeEach(() => {
  _reiniciarCacheRellenoParaTests();
  rpc.mockReset();
  filaSalud = null;
});

// sal-ac3: si la rpc falla, /api/salud sigue respondiendo con el resto de
// campos y sin la clave relleno.
describe("GET /api/salud con la rpc de relleno caída (sal-ac3)", () => {
  it("responde sin relleno y con el resto de los campos", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "función no disponible" } });
    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    expect([200, 503]).toContain(respuesta.status);
    const cuerpo = await respuesta.json();
    expect(cuerpo).not.toHaveProperty("relleno");
    expect(cuerpo).toHaveProperty("commit");
    expect(cuerpo).toHaveProperty("supabase", "activa");
  });

  it("si la rpc devuelve algo que no es la lista cerrada, tampoco publica relleno", async () => {
    rpc.mockResolvedValue({ data: { destino: "Lisboa" }, error: null });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo).not.toHaveProperty("relleno");
    expect(JSON.stringify(cuerpo)).not.toContain("Lisboa");
  });
});

// El desglose por motivo de las no-resueltas llega a la respuesta tal cual,
// y una clave fuera de la lista sigue tumbando `relleno` entero.
describe("GET /api/salud: motivo de las paradas no resueltas", () => {
  const anteriores = {
    paradas_total: 5, paradas_resueltas: 1, paradas_no_resueltas: 3, paradas_en_error: 0, paradas_sin_intentar: 1,
    paradas_con_foto: 0, paradas_con_alternativas: 0, paradas_con_categoria: 0, paradas_con_guia: 0, paradas_con_motivo: 0,
    curiosidades_formato_antiguo: 0, versiones_con_eventos: 0, versiones_multiciudad: 0, trabajos_inviables: 0,
    planes_total: 1, planes_sin_version: 0, planes_sin_trabajo_vivo: 0, planes_con_ciudad: 1, planes_sin_ciudad_identificable: 0,
    planes_sellados_pocas_paradas: 0, planes_sellados_sin_caja: 0, planes_sellados_zona_grande: 0, planes_sellados_sin_contencion: 0,
    planes_sellados_sin_ventaja: 0, planes_sellados_sin_candidato_claro: 0, planes_sellados_ciudad_no_encontrada: 0,
  };
  const nuevas = {
    paradas_no_resueltas_sin_candidatos: 1, paradas_no_resueltas_fuera_de_caja: 0, paradas_no_resueltas_nombre_distinto: 1,
    paradas_no_resueltas_tipo_incompatible: 0, paradas_no_resueltas_motivo_desconocido: 1, paradas_con_toponimo: 3,
    paradas_sin_intentar_ultima_version: 1,
  };
  const responder = (base: unknown, desglose: { data: unknown; error: { message: string } | null }) =>
    rpc.mockImplementation((nombre: string) =>
      Promise.resolve(
        nombre === "estado_relleno"
          ? { data: base, error: null }
          : nombre === "estado_relleno_motivos"
            ? desglose
            : { data: null, error: { message: "sin cupo" } },
      ),
    );

  it("publica las claves de estado_relleno_motivos junto a las de siempre", async () => {
    responder(anteriores, { data: nuevas, error: null });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.relleno).toEqual({ ...anteriores, ...nuevas });
  });

  it("sin la función nueva (antes de la migración) publica las de siempre, sin las nuevas", async () => {
    responder(anteriores, { data: null, error: { message: "Could not find the function viajes_planner.estado_relleno_motivos" } });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.relleno).toEqual(anteriores);
  });

  it("una clave que no está en la lista cerrada de la función de siempre omite relleno", async () => {
    responder({ ...anteriores, paradas_no_resueltas_otro: 1 }, { data: nuevas, error: null });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo).not.toHaveProperty("relleno");
  });

  it("una clave ajena en el desglose solo descarta el desglose", async () => {
    responder(anteriores, { data: { ...nuevas, destino: 1 }, error: null });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.relleno).toEqual(anteriores);
  });
});

// ctl-ac4: el objeto google es una lista cerrada de enteros y fuentes.fichas
// lo declara el endpoint; si la rpc del controlador falla se omite sin tumbar
// el resto.
describe("GET /api/salud: bloque google (ctl-ac4)", () => {
  const CLAVES_GOOGLE = [
    "clave_navegador",
    "clave_trabajador",
    "lugares_casados",
    "lugares_sin_coincidencia",
    "text_search_hoy",
    "text_search_mes",
    "ui_kit_hoy",
    "ui_kit_mes",
  ];

  it("expone exactamente las ocho claves, enteros no negativos, y fuentes.fichas", async () => {
    rpc.mockImplementation(async (nombre: string) =>
      nombre === "consumo_google_resumen"
        ? { data: { text_search_hoy: 3, text_search_mes: 10, ui_kit_hoy: 0, ui_kit_mes: 7 }, error: null }
        : { data: null, error: { message: "sin relleno" } },
    );
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(Object.keys(cuerpo.google).sort()).toEqual(CLAVES_GOOGLE);
    for (const valor of Object.values(cuerpo.google)) {
      expect(Number.isInteger(valor) && (valor as number) >= 0).toBe(true);
    }
    expect(cuerpo.google).toMatchObject({ text_search_hoy: 3, text_search_mes: 10, ui_kit_mes: 7 });
    expect(cuerpo.fuentes.fichas).toBe("google-ui-kit");
    expect(JSON.stringify(cuerpo)).not.toContain("AIza");
  });

  it("si la rpc del controlador falla, omite google y conserva el resto", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "función no disponible" } });
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo).not.toHaveProperty("google");
    expect(cuerpo).toHaveProperty("supabase", "activa");
  });

  it("si la rpc devuelve algo fuera de la lista cerrada, no lo publica", async () => {
    rpc.mockImplementation(async (nombre: string) =>
      nombre === "consumo_google_resumen"
        ? { data: { text_search_hoy: 1, text_search_mes: 1, ui_kit_hoy: 1, ui_kit_mes: "Lisboa" }, error: null }
        : { data: null, error: { message: "x" } },
    );
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo).not.toHaveProperty("google");
    expect(JSON.stringify(cuerpo)).not.toContain("Lisboa");
  });
});

// fic-ac7: /api/salud dice si la clave de navegador está puesta, sin exponerla.
describe("GET /api/salud: clave_navegador (fic-ac7)", () => {
  const rpcConConsumo = async (nombre: string) =>
    nombre === "consumo_google_resumen"
      ? { data: { text_search_hoy: 0, text_search_mes: 0, ui_kit_hoy: 0, ui_kit_mes: 0 }, error: null }
      : { data: null, error: { message: "sin relleno" } };

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, 0],
    ["", 0],
    ["AIza-clave-secreta-de-prueba", 1],
  ])("con la variable %j, clave_navegador vale %i y el valor no se publica", async (valor, esperado) => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR", valor as string);
    rpc.mockImplementation(rpcConConsumo);
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.google.clave_navegador).toBe(esperado);
    expect(JSON.stringify(cuerpo)).not.toContain("AIza");
  });
});

// cas-ac2: la clave del trabajador vive en otra máquina; /api/salud solo sabe
// de ella por lo que el propio trabajador escribe en su fila de salud.
describe("GET /api/salud: clave_trabajador (cas-ac2)", () => {
  const rpcConConsumo = async (nombre: string) =>
    nombre === "consumo_google_resumen"
      ? { data: { text_search_hoy: 0, text_search_mes: 0, ui_kit_hoy: 0, ui_kit_mes: 0 }, error: null }
      : { data: null, error: { message: "sin relleno" } };

  it.each([
    [1, 1],
    [0, 0],
  ])("google_clave %i en la fila del trabajador sale como clave_trabajador %i", async (escrito, esperado) => {
    rpc.mockImplementation(rpcConConsumo);
    filaSalud = { registrado_en: new Date().toISOString(), commit_sha: "abc", resultado: { ok: true, trabajos_procesados: 0, planes_mirados: 0, paradas_intentadas: 0, google_clave: escrito } };
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.google.clave_trabajador).toBe(esperado);
  });

  it("sin fila del trabajador, clave_trabajador es 0", async () => {
    rpc.mockImplementation(rpcConConsumo);
    const cuerpo = await (await GET(new NextRequest("http://localhost/api/salud"))).json();
    expect(cuerpo.google.clave_trabajador).toBe(0);
  });
});
