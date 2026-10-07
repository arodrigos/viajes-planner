import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
