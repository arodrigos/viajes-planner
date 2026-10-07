import type { SupabaseClient } from "@supabase/supabase-js";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { conCupo } from "@/lib/google/cupo";

// Respuestas posibles de la rpc: las cuatro de la función, un valor ajeno, un
// error devuelto y una excepción.
const respuestaRpc = fc.oneof(
  fc.constantFrom("ok", "tope-dia", "tope-mes", "tope-usuario").map((data) => ({ tipo: "data" as const, data })),
  fc.string().map((data) => ({ tipo: "data" as const, data })),
  fc.constant({ tipo: "error" as const }),
  fc.constant({ tipo: "lanza" as const }),
);

describe("conCupo: invariante 3", () => {
  it("ejecuta la llamada si y solo si la reserva fue exactamente ok, y una sola vez", async () => {
    await fc.assert(
      fc.asyncProperty(respuestaRpc, fc.constantFrom("text_search_pro", "ui_kit"), async (respuesta, sku) => {
        const rpc = vi.fn(async () => {
          if (respuesta.tipo === "lanza") throw new Error("rpc caída");
          if (respuesta.tipo === "error") return { data: null, error: { message: "fallo" } };
          return { data: respuesta.data, error: null };
        });
        const llamada = vi.fn(async () => "x");
        const resultado = await conCupo({ rpc } as unknown as SupabaseClient, sku, null, llamada);
        const esOk = respuesta.tipo === "data" && respuesta.data === "ok";
        expect(llamada).toHaveBeenCalledTimes(esOk ? 1 : 0);
        expect(resultado.concedido).toBe(esOk);
      }),
    );
  });
});
