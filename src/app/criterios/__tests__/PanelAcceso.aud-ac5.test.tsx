// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelAcceso } from "@/app/criterios/PanelAcceso";

const RAIZ = path.resolve(import.meta.dirname, "../../../..");
const PLANTILLAS = ["supabase/templates/magic_link.html", "supabase/templates/confirmation.html"];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// aud-ac5(b,c): prueba de ATADURA entre la pantalla y las plantillas reales
// del repositorio -unitaria y determinista, sin pila de Supabase-, que es la
// mitad que impide que el criterio sea circular: si alguien cambia la
// plantilla y no la pantalla, o al revés, este test se pone rojo.
describe("PanelAcceso (aud-ac5)", () => {
  it("el título entre comillas que cita la pantalla aparece tal cual en las dos plantillas de correo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const usuario = userEvent.setup();
    render(<PanelAcceso onVerificado={() => {}} />);

    await usuario.type(screen.getByLabelText("Tu correo"), "familia@example.com");
    await usuario.click(screen.getByRole("button", { name: "Pedir código de acceso" }));

    const ayuda = await screen.findByText(/código llega/i);
    const texto = ayuda.textContent ?? "";
    expect(texto).not.toMatch(/desde Viajes/i);

    const match = texto.match(/«([^»]+)»/);
    expect(match, `la pantalla no cita ningún título entre comillas: "${texto}"`).not.toBeNull();
    const titulo = match![1];

    for (const plantilla of PLANTILLAS) {
      const contenido = readFileSync(path.join(RAIZ, plantilla), "utf-8");
      expect(contenido, `"${titulo}" no aparece en ${plantilla}`).toContain(titulo);
    }
  });

  it("ninguna de las dos plantillas de correo nombra el producto (regla de flota: plantilla común a Auth entero)", () => {
    for (const plantilla of PLANTILLAS) {
      const contenido = readFileSync(path.join(RAIZ, plantilla), "utf-8");
      expect(contenido, `${plantilla} nombra el producto`).not.toMatch(/viajes|planner/i);
    }
  });
});
