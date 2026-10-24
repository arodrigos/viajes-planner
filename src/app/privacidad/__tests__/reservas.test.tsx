import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Privacidad from "../page";

describe("/privacidad (res-ac6)", () => {
  it("cuenta que guarda reservas, localizador y gastos, que no salen a terceros y que se borran con el viaje", () => {
    const texto = renderToStaticMarkup(<Privacidad />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const palabra of ["reservas", "localizador", "gastos", "al eliminar el viaje"]) expect(texto).toContain(palabra);
    expect(texto).toMatch(/ni a Nominatim, Overpass, Google ni a ningún otro servicio externo/);
  });
});
