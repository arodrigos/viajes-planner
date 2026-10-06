import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO } from "../index";
import type { Texto } from "../tipos";

const PROHIBIDAS = ["única forma de volver", "por favor", "haz clic", "haga clic"];

// Lista cerrada de verbos con los que puede empezar un botón (guía de estilo,
// «Botones y enlaces»). Ampliarla es una decisión, no un descuido.
const VERBOS_BOTON = ["Cuéntanos", "Pedir", "Reintentar", "Cerrar", "Eliminar", "Cancelar", "Continuar", "Guardar", "Añadir", "Regenerar", "Marcar", "Usar", "Ver", "Abrir", "Descargar"];

const MAX_AYUDA = 140;
const MAX_BOTON = 40;

const textos: Array<{ ruta: string; texto: Texto }> = Object.entries(CATALOGO).flatMap(([pantalla, entradas]) =>
  Object.entries(entradas as Record<string, Texto>).map(([clave, texto]) => ({ ruta: `${pantalla}.${clave}`, texto })),
);

describe("catálogo de textos", () => {
  it("no está vacío", () => {
    expect(textos.length).toBeGreaterThan(10);
  });

  it.each(textos)("$ruta no contiene frases prohibidas", ({ texto }) => {
    for (const prohibida of PROHIBIDAS) expect(texto.texto.toLowerCase()).not.toContain(prohibida);
  });

  it.each(textos.filter((x) => x.texto.tipo === "boton"))("$ruta (botón) empieza por un verbo y es corto", ({ texto }) => {
    expect(VERBOS_BOTON.some((v) => texto.texto.startsWith(v))).toBe(true);
    expect(texto.texto.length).toBeLessThanOrEqual(MAX_BOTON);
  });

  it.each(textos.filter((x) => ["ayuda", "error", "vacio"].includes(x.texto.tipo)))(
    "$ruta (ayuda, error o vacío) no pasa de 140 caracteres",
    ({ texto }) => {
      expect(texto.texto.length).toBeLessThanOrEqual(MAX_AYUDA);
    },
  );

  it.each(textos.filter((x) => x.texto.tipo === "error"))("$ruta (error) dice qué hacer", ({ texto }) => {
    expect(texto.texto).toMatch(/vuelve a intentarlo|revisa|prueba/i);
  });
});

describe("docs/guia-de-estilo.md", () => {
  const guia = readFileSync(join(process.cwd(), "docs", "guia-de-estilo.md"), "utf8");

  it.each(["Principios", "Botones y enlaces", "Encabezados", "Avisos y procedencia", "Errores y estados vacíos", "Números, fechas y horas"])(
    "tiene la sección «%s»",
    (seccion) => {
      expect(guia).toMatch(new RegExp(`^#{1,3} ${seccion}$`, "m"));
    },
  );
});
