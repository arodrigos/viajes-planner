// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";
import { extraerUrls } from "@/lib/sin-afiliacion";

// reg-ac1: VistaPlan usa useRouter() (regenerar-viaje); este componente no
// vive bajo un App Router real en el test, mismo doble que
// FormularioCriterios.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// reco-ac3(b): un dominio incrustado en el nombre de una recomendación, y
// un campo "url" colado en el JSON (como si /api/plan/[id] tuviera un bug y
// no lo hubiera limpiado), no pueden llegar a ningún atributo href/src del
// HTML renderizado. El enlace real siempre lo construye urlBusquedaSitio a
// partir del destino y el nombre, nunca de un campo suelto del payload.
const PLAN_ENVENENADO = {
  id: "plan-envenenado",
  version: 1,
  destino: "Sevilla",
  personas: 2,
  dias: [],
  avisos: [],
  recomendaciones: [
    {
      tipo: "comida",
      nombre: "Visita https://malicioso.example ahora mismo",
      motivo: "Motivo normal.",
      url: "https://otro-malicioso.example/y",
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PLAN_ENVENENADO), { status: 200 })),
  );
});

describe("VistaPlan con recomendación envenenada (reco-ac3(b))", () => {
  it("ningún href/src del HTML contiene los dominios inventados", async () => {
    const { container } = render(<VistaPlan id="plan-envenenado" />);

    await waitFor(() => expect(screen.getByText(/Visita https:\/\/malicioso\.example ahora mismo/)).toBeInTheDocument());

    // El texto "malicioso.example" puede aparecer codificado DENTRO del
    // parámetro de búsqueda (encodeURIComponent no toca letras ni puntos),
    // pero eso no es un enlace hacia ese dominio -- lo que de verdad importa
    // es que ningún href navegue realmente a él, algo que solo "://" sin
    // codificar (nunca "%3A%2F%2F") podría hacer.
    const urls = extraerUrls(container.innerHTML);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).hostname).toBe("www.google.com");
    expect(urls[0]).not.toContain("://malicioso.example");
    expect(urls[0]).not.toContain("://otro-malicioso.example");

    // El único href de la tarjeta es la búsqueda determinista construida
    // por el propio código, con el nombre codificado como texto inerte.
    const enlace = screen.getByRole("link", { name: /Visita https:\/\/malicioso\.example ahora mismo/ });
    expect(enlace).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Visita%20https%3A%2F%2Fmalicioso.example%20ahora%20mismo%20Sevilla",
    );
  });
});
