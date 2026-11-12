import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Privacidad from "../page";

describe("/privacidad (lis-ac8)", () => {
  it("explica la lista de preparativos y que el .ics no se sube", () => {
    const texto = renderToStaticMarkup(<Privacidad />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const frase of ["Lista de preparativos y equipaje", "qué elementos marcas", "Solo quien creó el viaje la ve", "las introduce el adulto que lo crea", "al eliminar el viaje", "se lee en tu móvil y no se sube"]) {
      expect(texto).toContain(frase);
    }
  });
});
