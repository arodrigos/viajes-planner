// Tipos de enchufe por país (ISO 3166-1 alfa-2), tabla estática: nunca se
// consulta en ejecución. Datos de Wikidata P2853 (CC0).
// atajo: tabla manual de los destinos más habituales, no el volcado completo de
// Wikidata; regenerarla con scripts/generar-enchufes.ts cuando se quiera cobertura total.
export const ENCHUFES_POR_PAIS: Readonly<Record<string, readonly string[]>> = {
  AR: ["I"], AU: ["I"], BR: ["N"], CA: ["A", "B"], CH: ["J"], CL: ["C", "L"],
  CN: ["A", "C", "I"], CO: ["A", "B"], CU: ["A", "B", "C", "L"], DK: ["C", "E", "F", "K"],
  EG: ["C"], GB: ["G"], IE: ["G"], IL: ["C", "H"], IN: ["C", "D", "M"], IS: ["C", "F"],
  JP: ["A", "B"], MA: ["C", "E"], MX: ["A", "B"], NZ: ["I"], PE: ["A", "B", "C"],
  TH: ["A", "B", "C", "F", "O"], TR: ["C", "F"], US: ["A", "B"], UY: ["C", "F", "I", "L"],
  ZA: ["C", "D", "M", "N"],
  // Países con enchufe C/F como España: no hace falta adaptador.
  AT: ["C", "F"], BE: ["C", "E"], DE: ["C", "F"], ES: ["C", "F"], FR: ["C", "E"],
  GR: ["C", "F"], HR: ["C", "F"], IT: ["C", "F", "L"], NL: ["C", "F"], PL: ["C", "E"],
  PT: ["C", "F"], SE: ["C", "F"],
};
