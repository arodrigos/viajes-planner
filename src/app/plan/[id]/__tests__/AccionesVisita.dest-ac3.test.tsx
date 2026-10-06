// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccionesVisita, TEXTO_SIN_SESION, TEXTO_SIN_UBICACION } from "@/app/plan/[id]/AccionesVisita";

afterEach(cleanup);

// dest-ac3: sin sesión no hay botones, solo el texto de ayuda -- caso que
// la vista real nunca alcanza (/api/plan/[id] exige sesión antes), pero que
// el propio componente garantiza de forma aislada.
describe("AccionesVisita (dest-ac3)", () => {
  it("sin sesión activa, no muestra ningún botón, solo el texto de ayuda", () => {
    render(
      <AccionesVisita
        sesionActiva={false}
        visitada={false}
        tieneUbicacion={true}
        cargando={false}
        nombreParada="P1 (ejemplo)"
        onMarcar={vi.fn()}
        onDesmarcar={vi.fn()}
      />,
    );
    expect(screen.getByText(TEXTO_SIN_SESION)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("con sesión y sin visitar, el botón marca; tras marcar, pasa a 'Visitada ✓' y llama onMarcar", async () => {
    const onMarcar = vi.fn();
    render(
      <AccionesVisita
        sesionActiva={true}
        visitada={false}
        tieneUbicacion={true}
        cargando={false}
        nombreParada="P1 (ejemplo)"
        hrefComoLlegar="https://www.google.com/maps/dir/?api=1&origin=1,1&destination=2,2&travelmode=walking"
        onMarcar={onMarcar}
        onDesmarcar={vi.fn()}
      />,
    );
    const boton = screen.getByRole("button", { name: "Marcar como visitada: P1 (ejemplo)" });
    await userEvent.click(boton);
    expect(onMarcar).toHaveBeenCalledTimes(1);
  });

  it("visitada=true muestra 'Visitada ✓' y pulsar llama onDesmarcar", async () => {
    const onDesmarcar = vi.fn();
    render(
      <AccionesVisita
        sesionActiva={true}
        visitada={true}
        tieneUbicacion={true}
        cargando={false}
        nombreParada="P1 (ejemplo)"
        onMarcar={vi.fn()}
        onDesmarcar={onDesmarcar}
      />,
    );
    const boton = screen.getByRole("button", { name: "Visitada ✓: P1 (ejemplo)" });
    await userEvent.click(boton);
    expect(onDesmarcar).toHaveBeenCalledTimes(1);
  });

  it("dest-ac3: sin ubicación comprobada, no hay enlace 'Cómo llegar' y se explica por qué", () => {
    render(
      <AccionesVisita
        sesionActiva={true}
        visitada={false}
        tieneUbicacion={false}
        cargando={false}
        nombreParada="P1 (ejemplo)"
        onMarcar={vi.fn()}
        onDesmarcar={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: "Cómo llegar" })).not.toBeInTheDocument();
    expect(screen.getByText(TEXTO_SIN_UBICACION)).toBeInTheDocument();
    // El botón de marcar sigue existiendo: una parada sin ubicación se
    // puede marcar como visitada igual.
    expect(screen.getByRole("button", { name: "Marcar como visitada: P1 (ejemplo)" })).toBeInTheDocument();
  });

  it("con hrefComoLlegar, el enlace 'Cómo llegar' apunta exactamente a esa URL", () => {
    const href = "https://www.google.com/maps/dir/?api=1&origin=39.85,-4.02&destination=39.84,-4.03&travelmode=walking";
    render(
      <AccionesVisita
        sesionActiva={true}
        visitada={false}
        tieneUbicacion={true}
        cargando={false}
        nombreParada="P1 (ejemplo)"
        hrefComoLlegar={href}
        onMarcar={vi.fn()}
        onDesmarcar={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Cómo llegar" })).toHaveAttribute("href", href);
  });
});
