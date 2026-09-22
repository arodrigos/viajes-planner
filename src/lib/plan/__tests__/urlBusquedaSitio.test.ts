import { describe, expect, it } from "vitest";
import { urlBusquedaSitio } from "../urlBusquedaSitio";

// reco-ac2: los literales esperados están calculados a mano (no con
// encodeURIComponent en el propio test, que sería comprobar la función
// contra sí misma) para que el test pueda fallar de verdad si la
// codificación cambia.
describe("urlBusquedaSitio", () => {
  it("codifica acentos y espacios", () => {
    expect(urlBusquedaSitio("Café España", "Madrid")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20Espa%C3%B1a%20Madrid",
    );
  });

  it("codifica el símbolo &", () => {
    expect(urlBusquedaSitio("Bar & Grill", "Sevilla")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Bar%20%26%20Grill%20Sevilla",
    );
  });

  it("codifica º y dígitos", () => {
    expect(urlBusquedaSitio("Nº 5 Restaurante", "Valencia")).toBe(
      "https://www.google.com/maps/search/?api=1&query=N%C2%BA%205%20Restaurante%20Valencia",
    );
  });

  it("codifica comillas", () => {
    expect(urlBusquedaSitio('Restaurante "El Rincón"', "Bilbao")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Restaurante%20%22El%20Rinc%C3%B3n%22%20Bilbao",
    );
  });

  it("neutraliza una URL incrustada en el nombre: queda como texto de búsqueda, nunca como enlace", () => {
    expect(urlBusquedaSitio("Visita https://otro.example ahora", "Granada")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Visita%20https%3A%2F%2Fotro.example%20ahora%20Granada",
    );
  });
});
