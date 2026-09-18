import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/latido/route";

function peticion(cabeceraAuth?: string): NextRequest {
  const cabeceras = cabeceraAuth ? { authorization: cabeceraAuth } : undefined;
  return new NextRequest("http://localhost/api/cron/latido", { headers: cabeceras });
}

describe("GET /api/cron/latido (latido-ac1)", () => {
  const original = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = original;
    vi.unstubAllEnvs();
  });

  it("sin cabecera Authorization devuelve 401", async () => {
    process.env.CRON_SECRET = "secreto-de-prueba";
    const respuesta = await GET(peticion());
    expect(respuesta.status).toBe(401);
  });

  it("con un secreto incorrecto devuelve 401", async () => {
    process.env.CRON_SECRET = "secreto-de-prueba";
    const respuesta = await GET(peticion("Bearer otro-secreto"));
    expect(respuesta.status).toBe(401);
  });

  it("si CRON_SECRET no está configurado, ninguna cabecera autoriza", async () => {
    delete process.env.CRON_SECRET;
    const respuesta = await GET(peticion("Bearer lo-que-sea"));
    expect(respuesta.status).toBe(401);
  });
});
