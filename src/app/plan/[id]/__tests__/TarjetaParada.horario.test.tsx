// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TarjetaParada } from "@/app/plan/[id]/TarjetaParada";
import type { ParadaPublica } from "@/app/plan/[id]/tiposVista";

afterEach(cleanup);

const parada: ParadaPublica = {
  id: "p1",
  franja_id: "manana",
  nombre: "Museo (ejemplo)",
  descripcion: "Descripción.",
  procedencia: { fuente: "osm" },
  google: { estado: "casado" },
  horario: { inicio: "10:00", fin: "11:00", recortada: false, apertura: "Abierto durante la visita", fuenteOsm: { comprobadoEn: "2021-03" } },
};

function pintar(extra: Partial<ParadaPublica> = {}, solicitudGoogle = 0) {
  return (
    <ul>
      <TarjetaParada
        planId="plan-1"
        parada={{ ...parada, ...extra }}
        franjaId="manana"
        ciudad="Lisboa"
        tarjetaRef={() => undefined}
        activa={false}
        solicitudAlternativas={0}
        solicitudGoogle={solicitudGoogle}
        hoy="2026-10-08"
        esHoy={false}
        esSiguiente={false}
        visitaEnCurso={false}
        cambiando={null}
        onUsarAlternativa={async () => true}
        onAlternarVisita={() => undefined}
      />
    </ul>
  );
}

const panelGoogle = (c: HTMLElement) => Array.from(c.querySelectorAll("details")).find((d) => d.textContent?.includes("Google Maps"))!;

// dif-ac1, dif-ac2
describe("TarjetaParada: procedencia del horario", () => {
  it("enseña fuente y año de comprobación y ofrece «Compruébalo en Google» si es antiguo", () => {
    render(pintar());
    expect(screen.getByTestId("procedencia-horario")).toHaveTextContent("Horario según OpenStreetMap · comprobado en 2021 · El horario de OpenStreetMap puede haber cambiado desde entonces.");
    expect(screen.getByRole("button", { name: "Compruébalo en Google" })).toBeInTheDocument();
  });

  it("un horario reciente y sin aviso de cierre no ofrece el botón", () => {
    render(pintar({ horario: { ...parada.horario!, fuenteOsm: { comprobadoEn: "2026-05-01" } } }));
    expect(screen.getByTestId("procedencia-horario")).toHaveTextContent("comprobado en 2026");
    expect(screen.queryByRole("button", { name: "Compruébalo en Google" })).toBeNull();
  });

  it("sin fecha dice «sin fecha de comprobación»; con posible cierre dice «puede estar cerrado»", () => {
    const { rerender } = render(pintar({ horario: { ...parada.horario!, fuenteOsm: {} } }));
    expect(screen.getByTestId("procedencia-horario")).toHaveTextContent("sin fecha de comprobación");
    rerender(pintar({ horario: { ...parada.horario!, fuenteOsm: { comprobadoEn: "2026-09" }, posibleCierre: true } }));
    expect(screen.getByTestId("procedencia-horario")).toHaveTextContent("puede estar cerrado a esa hora");
    expect(screen.getByRole("button", { name: "Compruébalo en Google" })).toBeInTheDocument();
  });

  it("una parada no casada nunca ofrece el botón", () => {
    render(pintar({ google: { estado: "pendiente" } }));
    expect(screen.queryByRole("button", { name: "Compruébalo en Google" })).toBeNull();
  });

  it("sin etiqueta de horario de OSM no hay línea de procedencia", () => {
    render(pintar({ horario: { inicio: "10:00", fin: "11:00", recortada: false, apertura: "Horario no disponible" } }));
    expect(screen.queryByTestId("procedencia-horario")).toBeNull();
  });

  it("el botón abre el panel de Google de esa tarjeta", () => {
    const { container } = render(pintar());
    expect(panelGoogle(container).open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Compruébalo en Google" }));
    expect(panelGoogle(container).open).toBe(true);
  });

  it("la petición del atajo de Ahora abre ese mismo panel", () => {
    const { container, rerender } = render(pintar({}, 0));
    rerender(pintar({}, 1));
    expect(panelGoogle(container).open).toBe(true);
  });
});
