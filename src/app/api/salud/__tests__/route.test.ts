import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reiniciarCacheRellenoParaTests } from "@/lib/relleno";

const rpc = vi.fn();

// Consulta encadenable que siempre responde «sin filas»: lo único que este
// test necesita es que comprobarSupabase salga bien y la rpc sea lo que falla.
function consultaVacia() {
  const consulta: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "order", "limit"]) consulta[metodo] = () => consulta;
  consulta.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return consulta;
}

vi.mock("@/lib/db/cliente", () => ({
  clienteServicio: () => ({ from: () => consultaVacia(), rpc }),
}));

import { GET } from "@/app/api/salud/route";

beforeEach(() => {
  _reiniciarCacheRellenoParaTests();
  rpc.mockReset();
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
