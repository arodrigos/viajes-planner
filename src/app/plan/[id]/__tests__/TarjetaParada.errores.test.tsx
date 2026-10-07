// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TarjetaParada } from "@/app/plan/[id]/TarjetaParada";
import type { ErrorParada } from "@/lib/plan/erroresParada";
import type { ParadaPublica } from "@/app/plan/[id]/tiposVista";

afterEach(cleanup);

function parada(id: string, nombre: string): ParadaPublica {
  return {
    id,
    franja_id: "manana",
    nombre,
    descripcion: "Descripción.",
    procedencia: { fuente: "propuesto-sin-verificar" },
    alternativas: [{ id: `${id}-alt`, nombre: `Alt de ${nombre}`, descripcion: "d", motivo: "m", procedencia: { fuente: "osm" }, etiquetasEncaje: [] }],
  };
}

function pintar(p: ParadaPublica, error?: ErrorParada) {
  return (
    <TarjetaParada
      planId="plan-1"
      parada={p}
      franjaId="manana"
      ciudad="Lisboa"
      tarjetaRef={() => undefined}
      activa={false}
      solicitudAlternativas={1}
      esHoy={true}
      esSiguiente={false}
      visitaEnCurso={false}
      cambiando={null}
      error={error}
      onUsarAlternativa={async () => true}
      onAlternarVisita={() => undefined}
    />
  );
}

// err-ac1, err-ac2: el error sale solo en la tarjeta de su parada.
describe("TarjetaParada con errores por parada", () => {
  it("un error de cambio se ve en su tarjeta y no en la de otra parada", () => {
    render(
      <ul>
        {pintar(parada("a", "Parada A (ejemplo)"), { tipo: "cambio", mensaje: "La parada ya no se puede cambiar." })}
        {pintar(parada("b", "Parada B (ejemplo)"))}
      </ul>,
    );
    const [tarjetaA, tarjetaB] = screen.getAllByRole("listitem").filter((li) => li.classList.contains("tarjeta-parada"));
    expect(within(tarjetaA).getByRole("alert")).toHaveTextContent("La parada ya no se puede cambiar.");
    expect(within(tarjetaB).queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("un error de visita se pinta con role=alert y deja el botón activo y sin marcar", () => {
    render(<ul>{pintar(parada("a", "Parada A (ejemplo)"), { tipo: "visita", mensaje: "No se ha podido guardar la visita. Revisa la conexión y vuelve a intentarlo." })}</ul>);
    expect(screen.getByRole("alert")).toHaveTextContent("No se ha podido guardar la visita.");
    const boton = screen.getByRole("button", { name: "Marcar como visitada: Parada A (ejemplo)" });
    expect(boton).toBeEnabled();
    expect(boton).toHaveAttribute("aria-pressed", "false");
  });
});
