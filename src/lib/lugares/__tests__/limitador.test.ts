import { describe, expect, it } from "vitest";
import { crearLimitador, type Reloj } from "../limitador";

// lug-ac3: el reloj falso gobierna la espera de RITMO (nunca se espera de
// verdad), pero la latencia de la propia tarea (como una petición HTTP real)
// es independiente de ese reloj -- por eso aquí se simula con un `setTimeout`
// real, que es justo lo que el feedback del gatekeeper detectó: con latencia
// mayor que el intervalo, el limitador viejo dejaba varias tareas en vuelo.
function crearRelojFalso(): Reloj {
  let tiempo = 0;
  return {
    ahora: () => tiempo,
    dormir: async (ms: number) => {
      tiempo += ms;
    },
  };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("crearLimitador (lug-ac3)", () => {
  it("nunca deja dos tareas en vuelo a la vez, aunque cada tarea tarde más que el intervalo mínimo", async () => {
    const limitar = crearLimitador(1100, crearRelojFalso());
    let enVuelo = 0;
    let maximoEnVuelo = 0;

    const tarea = (id: number) => async () => {
      enVuelo++;
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
      await esperar(20);
      enVuelo--;
      return id;
    };

    const resultados = await Promise.all([limitar(tarea(1)), limitar(tarea(2)), limitar(tarea(3))]);

    expect(resultados).toEqual([1, 2, 3]);
    expect(maximoEnVuelo).toBe(1);
  });

  it("si una tarea falla, la cadena sigue: la siguiente tarea espera su turno igualmente", async () => {
    const limitar = crearLimitador(1100, crearRelojFalso());

    await expect(
      limitar(async () => {
        throw new Error("falla");
      }),
    ).rejects.toThrow("falla");
    await expect(limitar(async () => "ok")).resolves.toBe("ok");
  });
});
