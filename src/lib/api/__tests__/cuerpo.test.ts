import { describe, expect, it } from "vitest";
import { leerCuerpoJson } from "../cuerpo";

const pet = (cuerpo: string) => new Request("http://x.test/api/plan", { method: "POST", body: cuerpo });

describe("leerCuerpoJson", () => {
  it("devuelve el cuerpo parseado", async () => {
    expect(await leerCuerpoJson(pet('{"a":1}'))).toEqual({ cuerpo: { a: 1 } });
  });

  // El 400 y su texto son los que ya daban las rutas antes de compartir la ayuda.
  it("responde 400 con el mismo texto si el cuerpo no es JSON", async () => {
    const leido = await leerCuerpoJson(pet("{no"));
    if (!("respuesta" in leido)) throw new Error("debía fallar");
    expect(leido.respuesta.status).toBe(400);
    expect(await leido.respuesta.json()).toEqual({ error: "el cuerpo de la petición no es JSON válido" });
  });
});
