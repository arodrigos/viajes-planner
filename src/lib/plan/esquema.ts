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
    // bloque generacion (ac2): explicación de exclusiones por categoría de
    // riesgo. No la produce el modelo (candidato se ensambla sin ella en
    // procesarTrabajo); la añade el post-proceso determinista después de
    // validar contra este mismo esquema.
    avisos: { type: "array", items: { type: "string" } },
    // bloque recomendaciones-de-sitios: opcional -un plan sin recomendaciones
    // sigue siendo un plan válido (reco-ac7).
    recomendaciones: { type: "array", items: { $ref: "#/$defs/recomendacion" } },
  },
  $defs: {
    dia: {
      type: "object",
      additionalProperties: false,
      required: ["fecha", "franjas", "paradas"],
      properties: {
        fecha: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        // Opcional en fase 1: el modelo no propone alojamiento todavía (F2-06).
        ancla_alojamiento: { $ref: "#/$defs/anclaAlojamiento" },
        franjas: { type: "array", minItems: 1, items: { $ref: "#/$defs/franja" } },
        // trabajador-ac1 (real, 2026-09-21): sin minItems, un día sin
        // ninguna parada validaba igual que uno completo -- el fix que deja
        // que el sistema rellene id/franjas/procedencia (procesarTrabajo.ts)
        // siempre emite la clave "paradas", así que un modelo que no
        // proponga ninguna colaba un "completado" vacío en vez de
        // reintentar con el hueco señalado.
        paradas: { type: "array", minItems: 1, items: { $ref: "#/$defs/parada" } },
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
        // Un único valor posible en fase 1 (ver tipos.ts): el esquema no
        // admite "url" todavía, que es la propia comprobación de que
        // ninguna URL generada por el modelo llega al plan guardado.
        fuente: { const: "propuesto-sin-verificar" },
      },
    },
    // bloque recomendaciones-de-sitios: SIN ninguna propiedad de URL a
    // propósito -es la comprobación estructural de que una dirección
    // inventada por el modelo no puede colarse, la misma técnica que ya usa
    // "procedencia" arriba. La dirección la construye urlBusquedaSitio.ts,
    // fuera del alcance del modelo, en el render.
    recomendacion: {
      type: "object",
      additionalProperties: false,
      required: ["tipo", "nombre", "motivo"],
      properties: {
        tipo: { enum: ["comida", "recinto"] },
        nombre: { type: "string", minLength: 1 },
        motivo: { type: "string", minLength: 1 },
      },
    },
    parada: {
      type: "object",
      additionalProperties: false,
      required: ["id", "franja_id", "nombre", "descripcion", "duracion_min", "prioridad", "procedencia"],
      properties: {
        id: { type: "string", minLength: 1 },
        franja_id: { type: "string", minLength: 1 },
        nombre: { type: "string", minLength: 1 },
        descripcion: { type: "string", minLength: 1 },
        duracion_min: { type: "number", exclusiveMinimum: 0 },
        prioridad: { type: "number", minimum: 0, maximum: 100 },
        procedencia: { $ref: "#/$defs/procedencia" },
        // lug-ac4: opcional a propósito -un plan sin categoria sigue siendo
        // válido- y enum cerrado: el ensamblador descarta cualquier valor
        // fuera de esta lista antes de que llegue aquí, pero el esquema es
        // la segunda red, no la única.
        categoria: {
          enum: [
            "monumento",
            "museo",
            "parque",
            "mirador",
            "barrio",
            "plaza",
            "mercado",
            "playa",
            "naturaleza",
            "ocio-infantil",
            "espectaculo",
            "comida",
            "compras",
            "otro",
          ],
        },
        coordenadas: {
          type: "object",
          additionalProperties: false,
          required: ["lat", "lon"],
          properties: { lat: { type: "number" }, lon: { type: "number" } },
        },
      },
    },
  },
} as const;
