// Formato del XML diario del BCE (eurofxref-daily.xml): un único <Cube
// time="YYYY-MM-DD"> con una tasa por moneda respecto al euro. Se parsea con
// una expresión regular en vez de añadir una dependencia de XML: el formato
// lleva sin cambiar desde que existe el feed y es más barato de auditar que
// una librería nueva para tres etiquetas.
export interface TasasBCE {
  fecha_referencia: string;
  tasas: Record<string, number>;
}

export class XmlBCEInvalido extends Error {}

export function parsearXmlBCE(xml: string): TasasBCE {
  const fecha = xml.match(/<Cube\s+time=['"]([\d-]+)['"]/);
  if (!fecha) {
    throw new XmlBCEInvalido("El XML del BCE no trae la fecha de referencia (<Cube time=...>)");
  }

  const tasas: Record<string, number> = {};
  const patronTasa = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  for (const coincidencia of xml.matchAll(patronTasa)) {
    tasas[coincidencia[1]] = Number(coincidencia[2]);
  }
  if (Object.keys(tasas).length === 0) {
    throw new XmlBCEInvalido("El XML del BCE no trae ninguna tasa de cambio");
  }

  return { fecha_referencia: fecha[1], tasas };
}
