import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clienteAnonimo, clienteServicio } from "@/lib/db/cliente";

const ENV_ORIGINAL = { ...process.env };

function restaurarEnv() {
  for (const clave of Object.keys(process.env)) {
    if (!(clave in ENV_ORIGINAL)) delete process.env[clave];
  }
  Object.assign(process.env, ENV_ORIGINAL);
}

// cliente-ac1: el esquema se declara en un único sitio (SUPABASE_SCHEMA),
// viaja en todas las peticiones y su ausencia se nota al instante en vez de
// degradar a `public` -que en un proyecto compartido con el resto de la
// flota leería o escribiría sobre datos ajenos.
describe("clienteServicio y clienteAnonimo (cliente-ac1)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-servicio";
    process.env.SUPABASE_ANON_KEY = "clave-anonima";
  });

  afterEach(() => {
    restaurarEnv();
    vi.unstubAllGlobals();
  });

  it("clienteServicio lanza si falta SUPABASE_SCHEMA, nombrando la variable", () => {
    delete process.env.SUPABASE_SCHEMA;
    expect(() => clienteServicio()).toThrow(/SUPABASE_SCHEMA/);
  });

  it("clienteServicio lanza si SUPABASE_SCHEMA está vacía (sin caer a 'public')", () => {
    process.env.SUPABASE_SCHEMA = "";
    expect(() => clienteServicio()).toThrow(/SUPABASE_SCHEMA/);
  });

  it("clienteAnonimo lanza si falta SUPABASE_SCHEMA, nombrando la variable", () => {
    delete process.env.SUPABASE_SCHEMA;
    expect(() => clienteAnonimo()).toThrow(/SUPABASE_SCHEMA/);
  });

  // supabase-js acepta un `global.fetch` doblado: es la única forma de
  // comprobar que el cliente manda de verdad las cabeceras de perfil sin
  // montar una pila de Supabase real (eso ya lo hace rls.integration.test.ts
  // contra Postgres de verdad).
  it("con SUPABASE_SCHEMA puesta, cada petición lleva la cabecera de perfil del esquema", async () => {
    process.env.SUPABASE_SCHEMA = "viajes_planner";
    const cabeceras: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        cabeceras.push(new Headers(init?.headers));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const supabase = clienteServicio();
    await supabase.from("salud").select("id"); // lectura -> GET
    await supabase.from("salud").insert({ origen: "test" }); // escritura -> POST
    await supabase.rpc("liberar_cerrojo_trabajador", { p_tomado_por: "test" }); // rpc -> POST

    expect(cabeceras).toHaveLength(3);
    expect(cabeceras[0].get("Accept-Profile")).toBe("viajes_planner");
    expect(cabeceras[1].get("Content-Profile")).toBe("viajes_planner");
    expect(cabeceras[2].get("Content-Profile")).toBe("viajes_planner");
  });

  // cliente-ac2(b): un cliente sin db.schema (el estado de antes de esta
  // incisión) no falla ni deja de mandar cabecera -manda "Accept-Profile:
  // public" porque supabase-js usa DEFAULT_DB_OPTIONS = { schema: "public" }-
  // así que se resolvería en silencio contra el esquema de otro producto de
  // la flota en el mismo proyecto compartido. Eso es justo lo que la
  // fábrica ya no permite construir sin SUPABASE_SCHEMA.
  it("sin schema, supabase-js cae a 'public' en vez de fallar (lo que la fábrica ya no permite)", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const cabeceras: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        cabeceras.push(new Headers(init?.headers));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const sinEsquema = createClient("http://localhost:54321", "clave-servicio");
    await sinEsquema.from("salud").select("id");

    expect(cabeceras[0].get("Accept-Profile")).toBe("public");
  });
});
