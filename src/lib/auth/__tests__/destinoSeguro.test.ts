import { describe, expect, it } from "vitest";
import { destinoSeguro } from "@/lib/auth/destinoSeguro";

const ORIGEN = "https://mi-origen.example";

// seg-ac1: la aserción se hace sobre el ORIGEN resultante, no sobre la
// cadena devuelta -- es la propiedad que de verdad importa, y una
// comparación de cadenas podría dar por buena una codificación que el
// navegador reinterpreta de otra forma.
describe("destinoSeguro", () => {
  describe("hostiles: el origen resultante nunca puede ser distinto del propio", () => {
    const hostiles = [
      "https://ajeno.example/x",
      "http://ajeno.example",
      "HTTPS://ajeno.example",
      "//ajeno.example/x",
      "/\\ajeno.example",
      "\\\\ajeno.example",
      "https:/\\ajeno.example",
      "http:/ajeno.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "%2F%2Fajeno.example",
      "/%09/ajeno.example",
    ];

    // La aserción no es sobre una cadena sino sobre el `.origin` del propio
    // objeto `URL` que devuelve la función, LEÍDO DIRECTAMENTE, sin volver
    // a envolverlo en un `new URL(destino, ORIGEN)` -- esa segunda
    // resolución es exactamente el fallo que dejó pasar la revisión
    // anterior de este mismo test: re-parsear un `pathname` ya resuelto
    // (p. ej. `//ajeno.example` tras normalizar un `..`) puede reinterpretarlo
    // como protocol-relative y darle un origen distinto, aunque el objeto
    // original ya fuera seguro. La función ahora devuelve el `URL` ya
    // resuelto para que quien lo use nunca tenga que volver a parsearlo.
    it.each(hostiles)("%s no puede resolver a un origen distinto del propio", (next) => {
      const destino = destinoSeguro(next, ORIGEN);
      expect(destino.origin).toBe(ORIGEN);
    });

    it("la cadena vacía cae al destino por defecto", () => {
      expect(destinoSeguro("", ORIGEN).href).toBe(`${ORIGEN}/criterios`);
    });

    it("next ausente (undefined) cae al destino por defecto", () => {
      expect(destinoSeguro(undefined, ORIGEN).href).toBe(`${ORIGEN}/criterios`);
    });
  });

  // Sin estos casos, una implementación que ignore `next` por completo (o
  // que devuelva siempre `/criterios`) aprobaría igual el bloque de
  // hostiles: no habría ninguna lista blanca, solo un parámetro amputado.
  describe("positivos de control: next legítimo se respeta, no se amputa", () => {
    it("una ruta relativa simple se conserva", () => {
      expect(destinoSeguro("/criterios", ORIGEN).href).toBe(`${ORIGEN}/criterios`);
    });

    it("una ruta con segmento se conserva", () => {
      expect(destinoSeguro("/trabajos/abc-123", ORIGEN).href).toBe(`${ORIGEN}/trabajos/abc-123`);
    });

    it("la query string sobrevive", () => {
      expect(destinoSeguro("/plan/abc?x=1", ORIGEN).href).toBe(`${ORIGEN}/plan/abc?x=1`);
    });

    it("el fragmento sobrevive", () => {
      expect(destinoSeguro("/criterios#seccion", ORIGEN).href).toBe(`${ORIGEN}/criterios#seccion`);
    });
  });
});
