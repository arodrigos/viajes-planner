// curiosidades-verificadas: comprueba contra Wikipedia/Wikidata y el modelo
// de verdad que el camino de producción (construirCandidatas →
// seleccionarCuriosidades con ejecutorClaudeCode) elige curiosidades que se
// pueden comprobar en la fuente. Sin base de datos ni variables de Supabase.
// Código de salida 2 si el modelo no llegó a elegir (límite de uso o
// respuesta inválida): el respaldo heurístico nunca da por buena la prueba.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Las dependencias de producción importan `server-only`, que solo se deja
// importar con la condición react-server; así el comando funciona con un
// simple `npx tsx`.
if (!process.execArgv.some((a) => a.includes("react-server")) && !process.env.CURIOSIDADES_REAL_RELANZADO) {
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, CURIOSIDADES_REAL_RELANZADO: "1" },
  });
  process.exit(r.status ?? 1);
}

interface SitioFixture {
  clave: string;
  tipo: "parada" | "alternativa";
  nombre: string;
  qid: string;
  es?: string;
  en?: string;
}

// Mismo saneado que el trabajador: los invisibles de la fuente no cuentan.
const compacto = (t: string) => t.replace(/[\u200b\u200c\u200d\u2060\u00ad\ufeff]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const { construirCandidatas, textoDeHecho } = await import("../src/lib/guia/candidatas");
  type Idioma = "es" | "en";
  const { crearFuenteCuriosidadesWikimedia } = await import("../src/lib/guia/fuenteCuriosidades");
  const { seleccionarCuriosidades } = await import("../src/lib/guia/seleccionarCuriosidades");
  const { sanearItems } = await import("../src/lib/guia/sanear");
  const { ejecutorClaudeCode } = await import("../src/lib/trabajador/ejecutorClaudeCode");
  const { MODELO_GENERACION } = await import("../src/lib/trabajador/config");

  const ruta = process.argv[2];
  if (!ruta) throw new Error("Uso: curiosidades-real.ts <fixture.json>");
  const { sitios } = JSON.parse(readFileSync(ruta, "utf8")) as { sitios: SitioFixture[] };

  // Lo descargado se guarda para volver a comprobar cada texto contra la
  // misma fuente, no contra lo que dice el selector.
  const descargado: Record<Idioma, string[]> = { es: [], en: [] };
  const entidadesVistas = new Map<string, import("../src/lib/guia/candidatas").EntidadWikidata>();
  const real = crearFuenteCuriosidadesWikimedia();
  const fuente: import("../src/lib/guia/candidatas").FuenteCuriosidades = {
    async entidades(qids) {
      const r = await real.entidades(qids);
      for (const [k, v] of r) entidadesVistas.set(k, v);
      return r;
    },
    async articulo(lang, titulo) {
      const t = await real.articulo(lang, titulo);
      if (t) descargado[lang].push(compacto(t));
      return t;
    },
    async entradillas(lang, titulos) {
      const r = await real.entradillas(lang, titulos);
      for (const t of r.values()) descargado[lang].push(compacto(t));
      return r;
    },
  };

  const sitiosCuriosidades = sitios.map((s) => ({
    id: s.clave,
    tipo: s.tipo,
    nombre: s.nombre,
    lugar: {
      fuente: "osm",
      id: `fixture/${s.clave}`,
      url: "https://www.openstreetmap.org/",
      nombre_fuente: s.nombre,
      etiquetas: { wikidata: s.qid, ...(s.en ? { wikipedia: `en:${s.en}` } : {}) },
      resuelto_en: new Date().toISOString(),
    },
  })) as unknown as import("../src/lib/guia/candidatas").SitioCuriosidades[];

  const candidatas = await construirCandidatas(sitiosCuriosidades, fuente);
  const directorio = mkdtempSync(join(tmpdir(), "curiosidades-real-"));
  try {
    const seleccion = await seleccionarCuriosidades(candidatas, ejecutorClaudeCode, { directorio, modelo: MODELO_GENERACION });
    const salida = {
      invocaciones_modelo: seleccion.invocaciones,
      seleccion: seleccion.seleccion,
      ...(seleccion.error ? { error: seleccion.error } : {}),
      sitios: sitios.map((s) => {
        const entidad = entidadesVistas.get(s.qid);
        const hechos = new Set((entidad?.hechos ?? []).map((h) => textoDeHecho(h, entidad?.clases)).filter(Boolean));
        const items = sanearItems(seleccion.porSitio.get(s.clave)?.items ?? []);
        return {
          clave: s.clave,
          tipo: s.tipo,
          curiosidades: items.map((i) => ({
            texto: i.texto,
            idioma: i.idioma,
            fuente: i.fuente,
            url: i.url,
            seleccion: i.seleccion,
            verificada: i.fuente === "wikipedia" ? descargado[i.idioma].some((t) => t.includes(i.texto)) : hechos.has(i.texto),
          })),
        };
      }),
    };
    console.log(JSON.stringify(salida, null, 2));
    if (seleccion.seleccion !== "modelo") process.exit(2);
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
