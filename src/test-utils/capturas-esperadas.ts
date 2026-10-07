// Cada bloque con interfaz añade aquí las capturas que se compromete a
// producir en el mismo PR que las genera: declararlas antes pondría el CI en
// rojo en bloques que aún no existen. `scripts/comprobar-capturas.mjs` falla
// si alguna falta en artefactos/capturas/<bloque>/<fichero>.
export const CAPTURAS_ESPERADAS = [
  { bloque: "capturas-ui", fichero: "correo-enmascarado.png" },
  { bloque: "error-visita-ahora", fichero: "error-claro.png" },
  { bloque: "error-visita-ahora", fichero: "error-oscuro.png" },
] as const satisfies readonly { bloque: string; fichero: string }[];
