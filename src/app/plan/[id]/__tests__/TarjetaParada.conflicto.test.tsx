// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TarjetaParada } from "@/app/plan/[id]/TarjetaParada";
import type { ParadaPublica } from "@/app/plan/[id]/tiposVista";
import type { ConflictoDia } from "@/lib/plan/conflictos";

afterEach(cleanup);

const parada: ParadaPublica = {
  id: "p1",
  franja_id: "manana",
  nombre: "Museo (ejemplo)",
  descripcion: "Descripción.",
  procedencia: { fuente: "osm" },
  horario: { inicio: "10:00", fin: "11:00", recortada: false, apertura: "Abierto durante la visita", fuenteOsm: { comprobadoEn: "2026-05-01" } },
};

const conflicto: ConflictoDia = { paradaId: "p1", clase: "cerrado-en-franja", texto: "Cerrado el lunes", procedencia: { fuente: "osm", comprobado: "2026-05-01" } };

function pintar(extra: { conflicto?: ConflictoDia; sinConfirmar?: boolean; parada?: Partial<ParadaPublica> } = {}) {
  return (
    <ul>
      <TarjetaParada
        planId="plan-1"
        parada={{ ...parada, ...extra.parada }}
        franjaId="manana"
        ciudad="Lisboa"
        tarjetaRef={() => undefined}
        activa={false}
        solicitudAlternativas={0}
        solicitudGoogle={0}
        hoy="2026-10-08"
        esHoy={false}
        conflicto={extra.conflicto}
        sinConfirmar={extra.sinConfirmar}
        esSiguiente={false}
        visitaEnCurso={false}
        cambiando={null}
        onUsarAlternativa={async () => true}
        onAlternarVisita={() => undefined}
      />
    </ul>
  );
}

// ape-ac3: los tres estados se distinguen en texto, no solo en color.
describe("TarjetaParada: conflicto de horario (ape-ac3)", () => {
  it("abierto: no pinta ni conflicto ni rótulo", () => {
    render(pintar());
    expect(screen.queryByTestId("conflicto-parada")).toBeNull();
    expect(screen.queryByTestId("horario-sin-confirmar")).toBeNull();
  });

  it("cerrado: frase del conflicto y fuente con el año", () => {
    render(pintar({ conflicto }));
    expect(screen.getByTestId("conflicto-parada")).toHaveTextContent("Cerrado el lunes");
    expect(screen.getByTestId("fuente-conflicto")).toHaveTextContent("Horario de OpenStreetMap, comprobado en 2026");
  });

  it("cerrado sin fecha de comprobación lo dice", () => {
    render(pintar({ conflicto: { ...conflicto, procedencia: { fuente: "osm" } } }));
    expect(screen.getByTestId("fuente-conflicto")).toHaveTextContent("sin fecha de comprobación");
  });

  it("desconocido: rótulo «Horario sin confirmar», sin conflicto", () => {
    render(pintar({ sinConfirmar: true }));
    expect(screen.getByTestId("horario-sin-confirmar")).toHaveTextContent("Horario sin confirmar");
    expect(screen.queryByTestId("conflicto-parada")).toBeNull();
  });

  it("un cierre claro de una parada casada ofrece comprobarlo en Google", () => {
    render(pintar({ conflicto, parada: { google: { estado: "casado" } } }));
    expect(screen.getByRole("button", { name: "Compruébalo en Google" })).toBeInTheDocument();
  });
});
