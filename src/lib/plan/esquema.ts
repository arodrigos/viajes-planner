// Esquema JSON del plan. Es doble contrato: aquí valida lo que construye la
// mitad web, y el mismo esquema es el que el trabajador de VPS1 usará para
// validar la respuesta de texto del modelo (bloque trabajador-vps1) antes de
// escribir nada en la base de datos.
export const esquemaPlan = {
  $id: "https://viajes-planner/esquema-plan.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "destino", "personas", "dias"],
  properties: {
    id: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    destino: { type: "string", minLength: 1 },
    personas: { type: "integer", minimum: 1 },
    dias: { type: "array", minItems: 1, items: { $ref: "#/$defs/dia" } },
  },
  $defs: {
    dia: {
      type: "object",
      additionalProperties: false,
      required: ["fecha", "ancla_alojamiento", "franjas", "paradas"],
      properties: {
        fecha: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        ancla_alojamiento: { $ref: "#/$defs/anclaAlojamiento" },
        franjas: { type: "array", minItems: 1, items: { $ref: "#/$defs/franja" } },
        paradas: { type: "array", items: { $ref: "#/$defs/parada" } },
      },
    },
    anclaAlojamiento: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "centroide", "radio_m"],
          properties: {
            tipo: { const: "zona-propuesta" },
            centroide: {
              type: "object",
              additionalProperties: false,
              required: ["lat", "lon"],
              properties: { lat: { type: "number" }, lon: { type: "number" } },
            },
            radio_m: { type: "number", exclusiveMinimum: 0 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "direccion"],
          properties: { tipo: { const: "usuario" }, direccion: { type: "string", minLength: 1 } },
        },
      ],
    },
    franja: {
      type: "object",
      additionalProperties: false,
      required: ["id", "etiqueta", "hora_inicio", "hora_fin"],
      properties: {
        id: { type: "string", minLength: 1 },
        etiqueta: { type: "string", minLength: 1 },
        hora_inicio: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        hora_fin: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
      },
    },
    procedencia: {
      type: "object",
      additionalProperties: false,
      required: ["fuente"],
      properties: {
        fuente: { enum: ["oficial", "secundaria", "estimado"] },
        url: { type: "string" },
      },
    },
    parada: {
      type: "object",
      additionalProperties: false,
      required: ["id", "franja_id", "sitio", "duracion_min", "prioridad", "procedencia"],
      properties: {
        id: { type: "string", minLength: 1 },
        franja_id: { type: "string", minLength: 1 },
        sitio: {
          type: "object",
          additionalProperties: false,
          required: ["nombre", "lat", "lon"],
          properties: {
            nombre: { type: "string", minLength: 1 },
            lat: { type: "number" },
            lon: { type: "number" },
          },
        },
        duracion_min: { type: "number", exclusiveMinimum: 0 },
        prioridad: { type: "number", minimum: 0, maximum: 100 },
        procedencia: { $ref: "#/$defs/procedencia" },
      },
    },
  },
} as const;
