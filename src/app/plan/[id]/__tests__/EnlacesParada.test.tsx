// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EnlacesParada } from "../EnlacesParada";

afterEach(cleanup);

// enl-ac1: pestaña nueva y noopener en todos los enlaces de la tarjeta.
describe("EnlacesParada", () => {
  it("pinta mapa y fuente, ambos con target=_blank y rel noopener noreferrer", () => {
    render(
      <EnlacesParada
        parada={{ nombre: "British Museum", coordenadas: { lat: 51.5194, lon: -0.127 }, procedencia: { fuente: "wikipedia", url: "https://en.wikipedia.org/wiki/British_Museum" } }}
        ciudad="Londres"
      />,
    );
    const mapa = screen.getByRole("link", { name: "Ver en Google Maps" });
    expect(mapa).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=51.5194,-0.127");
    const fuente = screen.getByRole("link", { name: "Fuente: Wikipedia" });
    for (const enlace of [mapa, fuente]) {
      expect(enlace).toHaveAttribute("target", "_blank");
      expect(enlace.getAttribute("rel")).toContain("noopener");
    }
  });

  it("una parada sin resolver no enseña enlace de fuente", () => {
    render(<EnlacesParada parada={{ nombre: "Cena", procedencia: { fuente: "propuesto-sin-verificar" } }} ciudad="Londres" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
