// El alojamiento nunca es "required": esa es literalmente la respuesta de
// Adrián hecha esquema.
export const esquemaCriterios = {
  $id: "https://viajes-planner/esquema-criterios.json",
  type: "object",
  additionalProperties: false,
  required: ["destino_o_tipo", "fechas", "dias", "personas", "perfil", "presupuesto_eur"],
  properties: {
    destino_o_tipo: { type: "string", minLength: 1 },
    fechas: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["modo", "inicio", "fin"],
          properties: {
            modo: { const: "fechas" },
            inicio: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["modo", "epoca"],
          properties: { modo: { const: "epoca" }, epoca: { type: "string", minLength: 1 } },
        },
      ],
    },
    dias: { type: "integer", minimum: 1, maximum: 60 },
    personas: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["edad"],
        properties: { edad: { type: "integer", minimum: 0, maximum: 120 } },
      },
    },
    perfil: { enum: ["familiar", "amigos", "pareja", "solo"] },
    presupuesto_eur: { type: "number", exclusiveMinimum: 0 },
    alojamiento: {
      type: "object",
      additionalProperties: false,
      required: ["direccion"],
      properties: { direccion: { type: "string", minLength: 1 } },
    },
  },
} as const;
