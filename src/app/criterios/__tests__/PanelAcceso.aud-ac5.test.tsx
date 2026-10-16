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

  // La pila local tiene enable_confirmations = false y sirve TODOS los
  // correos con magic_link.html, así que ningún e2e llega a enviar
  // confirmation.html, que es la que Supabase Cloud usa en el primer acceso
  // de un correo nuevo. Exigir que las dos sean el mismo correo (cuerpo y
  // asunto) hace que lo que los e2e comprueban con una valga para la otra.
  it("confirmation.html es el mismo correo que magic_link.html, cuerpo y asunto", () => {
    const [magicLink, confirmacion] = PLANTILLAS.map((plantilla) => readFileSync(path.join(RAIZ, plantilla), "utf-8"));
    expect(confirmacion, "confirmation.html difiere de magic_link.html").toBe(magicLink);

    const config = readFileSync(path.join(RAIZ, "supabase/config.toml"), "utf-8");
    const asunto = (plantilla: string) =>
      config.match(new RegExp(`\\[auth\\.email\\.template\\.${plantilla}\\]\\s*\\nsubject\\s*=\\s*"([^"]*)"`))?.[1];
    expect(asunto("magic_link"), "falta el asunto de magic_link en config.toml").toBeTruthy();
    expect(asunto("confirmation"), "el asunto de confirmation difiere del de magic_link").toBe(asunto("magic_link"));
  });
});
