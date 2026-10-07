// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TarjetaParada } from "@/app/plan/[id]/TarjetaParada";
import { contarConsejosYCuriosidades } from "@/app/plan/[id]/SeccionesGuia";
import type { ParadaPublica } from "@/app/plan/[id]/tiposVista";

afterEach(cleanup);

const parada: ParadaPublica = {
  id: "p1",
  franja_id: "manana",
  nombre: "Sitio (ejemplo)",
  descripcion: "Descripción.",
  procedencia: { fuente: "propuesto-sin-verificar" },
  motivo: "Porque sí.",
  alternativas: [{ id: "a1", nombre: "Otra (ejemplo)", descripcion: "d", motivo: "m", procedencia: { fuente: "osm" }, etiquetasEncaje: [] }],
};

function pintar(solicitudAlternativas: number, extra: Partial<ParadaPublica> = {}) {
  return (
    <TarjetaParada
      planId="plan-1"
      parada={{ ...parada, ...extra }}
      franjaId="manana"
      ciudad="Lisboa"
      tarjetaRef={() => undefined}
      activa={false}
      solicitudAlternativas={solicitudAlternativas}
      esHoy={false}
      esSiguiente={false}
      visitaEnCurso={false}
      cambiando={null}
      onUsarAlternativa={async () => true}
      onAlternarVisita={() => undefined}
    />
  );
}

describe("TarjetaParada", () => {
  it("comparte el nombre del grupo en los cuatro paneles y arranca todos cerrados", () => {
    const { container } = render(<ul>{pintar(0)}</ul>);
    const paneles = Array.from(container.querySelectorAll("details"));
    expect(paneles).toHaveLength(4);
    expect(new Set(paneles.map((p) => p.getAttribute("name")))).toEqual(new Set(["parada-p1"]));
    expect(paneles.some((p) => p.open)).toBe(false);
  });

  it("el aviso de paseo abre «Alternativas» y los demás siguen cerrados", () => {
    const { container, rerender } = render(<ul>{pintar(0)}</ul>);
    rerender(<ul>{pintar(1)}</ul>);
    const abiertos = Array.from(container.querySelectorAll("details")).filter((p) => p.open);
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0].textContent).toContain("Alternativas (1)");
    expect(screen.getByRole("button", { name: "Usar esta" })).toBeInTheDocument();
  });

  it("la marca «Sin comprobar» está a la vista fuera de los paneles", () => {
    const { container } = render(<ul>{pintar(0)}</ul>);
    const marca = screen.getByText(/Sin comprobar/);
    expect(marca.closest("details")).toBeNull();
    expect(container.querySelectorAll("h4")).toHaveLength(1);
  });

  it("sin motivo ni alternativas quedan los paneles de consejos y de Google", () => {
    const { container } = render(<ul>{pintar(0, { motivo: undefined, alternativas: [] })}</ul>);
    expect(container.querySelectorAll("details")).toHaveLength(2);
  });

  it("cuenta el consejo y cada curiosidad", () => {
    expect(contarConsejosYCuriosidades(undefined, undefined)).toBe(0);
    expect(contarConsejosYCuriosidades({ consejo: "c", url: "u", licencia: "CC BY-SA" }, { frases: ["a", "b"], url: "u" })).toBe(3);
  });
});
