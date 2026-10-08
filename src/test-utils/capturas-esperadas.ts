// Cada bloque con interfaz añade aquí las capturas que se compromete a
// producir en el mismo PR que las genera: declararlas antes pondría el CI en
// rojo en bloques que aún no existen. `scripts/comprobar-capturas.mjs` falla
// si alguna falta en artefactos/capturas/<bloque>/<fichero>.
export const CAPTURAS_ESPERADAS = [
  { bloque: "capturas-ui", fichero: "correo-enmascarado.png" },
  { bloque: "error-visita-ahora", fichero: "error-claro.png" },
  { bloque: "error-visita-ahora", fichero: "error-oscuro.png" },
  { bloque: "reglas-y-legal-google", fichero: "terminos.png" },
  { bloque: "reglas-y-legal-google", fichero: "privacidad.png" },
  { bloque: "ficha-google", fichero: "casada.png" },
  { bloque: "ficha-google", fichero: "cupo.png" },
  { bloque: "ficha-google", fichero: "sin-coincidencia.png" },
  { bloque: "aviso-horario-procedencia", fichero: "linea-horario.png" },
  { bloque: "aviso-horario-procedencia", fichero: "boton.png" },
] as const satisfies readonly { bloque: string; fichero: string }[];
