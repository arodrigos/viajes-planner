import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { conCupo } from "@/lib/google/cupo";

function clienteConRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

// ctl-ac3: la petición a Google es un fetch espiado; lo que se comprueba es
// cuántas veces sale, no cómo se llama.
describe("conCupo (ctl-ac3)", () => {
  it("con tope-dia no llama a Google", async () => {
    const llamada = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: "tope-dia", error: null });
    const resultado = await conCupo(clienteConRpc(rpc), "text_search_pro", null, llamada);
    expect(resultado).toEqual({ concedido: false, motivo: "tope-dia" });
    expect(llamada).not.toHaveBeenCalled();
  });

  it.each(["tope-mes", "tope-usuario"] as const)("con %s tampoco llama", async (motivo) => {
    const llamada = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: motivo, error: null });
    expect(await conCupo(clienteConRpc(rpc), "ui_kit", "u1", llamada)).toEqual({ concedido: false, motivo });
    expect(llamada).not.toHaveBeenCalled();
  });

  it("si la rpc lanza, no llama (cerrado ante el fallo)", async () => {
    const llamada = vi.fn();
    const rpc = vi.fn().mockRejectedValue(new Error("red caída"));
    expect(await conCupo(clienteConRpc(rpc), "text_search_pro", null, llamada)).toEqual({
      concedido: false,
      motivo: "error-reserva",
    });
    expect(llamada).not.toHaveBeenCalled();
  });

  it("si la rpc devuelve error, no llama", async () => {
    const llamada = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect((await conCupo(clienteConRpc(rpc), "ui_kit", "u1", llamada)).concedido).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it("con ok llama una vez y, si Google falla, la reserva no se devuelve", async () => {
    const llamada = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    await expect(conCupo(clienteConRpc(rpc), "text_search_pro", null, llamada)).rejects.toThrow("HTTP 500");
    expect(llamada).toHaveBeenCalledTimes(1);
    // Devolver la reserva sería otra rpc distinta de reservar_cupo_google.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reservar_cupo_google", { p_sku: "text_search_pro", p_usuario: null });
  });

  it("con ok devuelve el valor de la llamada", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    expect(await conCupo(clienteConRpc(rpc), "ui_kit", "u1", async () => 42)).toEqual({ concedido: true, valor: 42 });
  });
});
