// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelAcceso } from "@/app/criterios/PanelAcceso";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Caso real de una incidencia anterior: el dueño del producto pedía acceso, Supabase Auth
// del proyecto DEV real le mandaba un código de 8 dígitos, y la pantalla
// -maxLength={6} en el campo, más un regex de exactamente 6- no dejaba ni
// teclearlo entero. Este test reproduce ese escenario exacto: sin el fix,
// falla en la primera aserción (el campo trunca a 6 dígitos); con el fix,
// pasa entero.
async function irAlPasoDelCodigo(usuario: ReturnType<typeof userEvent.setup>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  render(<PanelAcceso onVerificado={() => {}} />);
  await usuario.type(screen.getByLabelText("Tu correo"), "familia@example.com");
  await usuario.click(screen.getByRole("button", { name: "Pedir código de acceso" }));
  return screen.getByLabelText("Código de acceso");
}

describe("PanelAcceso -- longitud del código de acceso", () => {
  it("acepta un código de 8 dígitos completo, sin truncarlo a 6", async () => {
    const usuario = userEvent.setup();
    const campo = await irAlPasoDelCodigo(usuario);

    await usuario.type(campo, "12345678");

    expect(campo).toHaveValue("12345678");
  });

  it("habilita 'Confirmar código' con 8 dígitos, no solo con 6", async () => {
    const usuario = userEvent.setup();
    const campo = await irAlPasoDelCodigo(usuario);
    const boton = screen.getByRole("button", { name: "Confirmar código" });

    await usuario.type(campo, "12345678");

    expect(boton).toBeEnabled();
  });

  it("el texto de ayuda ya no promete un número de dígitos fijo", async () => {
    const usuario = userEvent.setup();
    await irAlPasoDelCodigo(usuario);

    const ayuda = screen.getByText(/El código llega en un correo/i);
    expect(ayuda.textContent).not.toMatch(/seis dígitos|6 dígitos/i);
  });
});
