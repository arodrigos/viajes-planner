// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelAcceso } from "@/app/criterios/PanelAcceso";
import { AVISO_REENVIO_RED, AVISO_REENVIO_SERVIDOR } from "@/app/criterios/avisoReenvio";

type Resultado = "ok" | "500" | "red";

function respuestaDe(r: Resultado): Promise<Response> {
  if (r === "red") return Promise.reject(new TypeError("Failed to fetch"));
  return Promise.resolve(
    r === "ok"
      ? new Response(JSON.stringify({ mensaje: "enviado" }), { status: 200 })
      : new Response(null, { status: 500 }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hastaPasoCodigo(resultados: Resultado[]) {
  const fetchFalso = vi.fn(() => respuestaDe(resultados.shift() ?? "ok"));
  vi.stubGlobal("fetch", fetchFalso);
  const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<PanelAcceso onVerificado={() => {}} />);
  await usuario.type(screen.getByLabelText("Tu correo"), "familia@example.com");
  await usuario.click(screen.getByRole("button", { name: "Pedir código de acceso" }));
  await screen.findByRole("form", { name: "Introducir código" });
  await usuario.type(screen.getByLabelText("Código de acceso"), "123");
  return { usuario, fetchFalso };
}

async function pasarMinuto() {
  await act(async () => {
    vi.advanceTimersByTime(61_000);
  });
}

describe("PanelAcceso: reenvío del código", () => {
  it.each([
    ["500", AVISO_REENVIO_SERVIDOR],
    ["red", AVISO_REENVIO_RED],
  ] as const)("un fallo (%s) pinta un único aviso, conserva el código y deja el botón disponible", async (fallo, texto) => {
    const { usuario } = await hastaPasoCodigo(["ok", fallo]);
    await pasarMinuto();
    await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(texto);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("Código de acceso")).toHaveValue("123");
    expect(screen.getByText(/Te hemos enviado un código a familia@example.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pedir otro código" })).toBeEnabled();
  });

  it("mientras la petición está en marcha el botón se desactiva y un segundo clic no lanza otra", async () => {
    let soltar: (r: Response) => void = () => {};
    const { usuario, fetchFalso } = await hastaPasoCodigo(["ok"]);
    fetchFalso.mockImplementationOnce(() => new Promise<Response>((res) => (soltar = res)));
    await pasarMinuto();
    await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));

    const enviando = screen.getByRole("button", { name: "Enviando otro código…" });
    expect(enviando).toBeDisabled();
    await usuario.click(enviando);
    expect(fetchFalso).toHaveBeenCalledTimes(2);

    await act(async () => soltar(new Response(null, { status: 500 })));
    expect(await screen.findByRole("alert")).toHaveTextContent(AVISO_REENVIO_SERVIDOR);
    expect(screen.getByRole("button", { name: "Pedir otro código" })).toBeEnabled();
  });

  it("un reintento correcto quita el aviso y vuelve la cuenta atrás", async () => {
    const { usuario } = await hastaPasoCodigo(["ok", "500", "ok"]);
    await pasarMinuto();
    await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));
    await screen.findByRole("alert");
    await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));

    await screen.findByRole("button", { name: /Pedir otro código \(60 s\)/ });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un reenvío fallido tras un código incorrecto deja solo el aviso del reenvío", async () => {
    const { usuario, fetchFalso } = await hastaPasoCodigo(["ok"]);
    fetchFalso.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 401 })));
    await usuario.type(screen.getByLabelText("Código de acceso"), "456");
    await usuario.click(screen.getByRole("button", { name: "Confirmar código" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Ese código no es correcto/);

    await pasarMinuto();
    fetchFalso.mockImplementationOnce(() => respuestaDe("500"));
    await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(AVISO_REENVIO_SERVIDOR);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("en cualquier secuencia de resultados hay como mucho una alerta y tras un fallo el botón está libre", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom<Resultado>("ok", "500", "red"), { minLength: 1, maxLength: 4 }), async (seq) => {
        cleanup();
        const { usuario } = await hastaPasoCodigo(["ok", ...seq]);
        for (const r of seq) {
          await pasarMinuto();
          await usuario.click(screen.getByRole("button", { name: "Pedir otro código" }));
          // Termina la petición (el botón deja de decir «Enviando…») antes de mirar.
          await waitFor(() => expect(screen.queryByText("Enviando otro código…")).toBeNull());
          expect(screen.queryAllByRole("alert").length).toBeLessThanOrEqual(1);
          if (r !== "ok") expect(screen.getByRole("button", { name: "Pedir otro código" })).toBeEnabled();
        }
      }),
      { numRuns: 8 },
    );
  }, 60_000);
});
