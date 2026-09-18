import { describe, expect, it } from "vitest";
import { parsearXmlBCE, XmlBCEInvalido } from "@/lib/cambio/bce";

const XML_VALIDO = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<Cube>
		<Cube time='2026-09-17'>
			<Cube currency='USD' rate='1.1730'/>
			<Cube currency='JPY' rate='163.05'/>
			<Cube currency='GBP' rate='0.8420'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

describe("parsearXmlBCE", () => {
  it("extrae la fecha de referencia y una tasa por moneda", () => {
    const resultado = parsearXmlBCE(XML_VALIDO);
    expect(resultado.fecha_referencia).toBe("2026-09-17");
    expect(resultado.tasas).toEqual({ USD: 1.173, JPY: 163.05, GBP: 0.842 });
  });

  it("lanza XmlBCEInvalido si no hay fecha de referencia", () => {
    expect(() => parsearXmlBCE("<Envelope><Cube><Cube></Cube></Cube></Envelope>")).toThrow(XmlBCEInvalido);
  });

  it("lanza XmlBCEInvalido si no hay ninguna tasa", () => {
    expect(() => parsearXmlBCE("<Cube time='2026-09-17'></Cube>")).toThrow(XmlBCEInvalido);
  });
});
