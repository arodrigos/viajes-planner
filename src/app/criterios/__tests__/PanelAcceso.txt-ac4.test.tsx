// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelAcceso } from "@/app/criterios/PanelAcceso";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// txt-ac4: "con el asunto «...»" era una promesa que este repo no controla
// -el asunto del correo lo fija el panel de Supabase, no la plantilla que
// vive aquí-, así que el texto describe lo que la plantilla sí imprime, sin
// nombrar la palabra "asunto". La atadura contra las plantillas reales
// (que el título citado aparece tal cual en ellas) ya la cubre
// PanelAcceso.aud-ac5.test.tsx; aquí solo se comprueba que no queda la
// promesa que no se puede sostener.
describe("PanelAcceso (txt-ac4)", () => {
  it("el texto de ayuda del código no promete un asunto de correo que este repo no controla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const usuario = userEvent.setup();
    render(<PanelAcceso onVerificado={() => {}} />);

    await usuario.type(screen.getByLabelText("Tu correo"), "familia@example.com");
    await usuario.click(screen.getByRole("button", { name: "Pedir código de acceso" }));

    const ayuda = await screen.findByText(/código llega/i);
    const texto = ayuda.textContent ?? "";
    expect(texto).not.toMatch(/asunto/i);
    expect(texto).toContain("«Tu código de acceso»");
  });
});
