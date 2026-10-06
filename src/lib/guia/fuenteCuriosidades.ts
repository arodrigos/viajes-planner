import "server-only";
import { userAgent } from "@/lib/lugares/fuenteAbierta";
import { relojReal, type Reloj } from "@/lib/lugares/limitador";
import type { EntidadWikidata, FuenteCuriosidades, HechoWikidata, IdiomaCuriosidad, PropiedadWikidata } from "./candidatas";

// La fuente no respondió (red, 429, 5xx): el sitio se pospone, no se da por
// «sin curiosidades».
export class FalloFuenteCuriosidades extends Error {}

export interface OpcionesFuenteCuriosidades {
  fetch?: typeof fetch;
  reloj?: Reloj;
  // Pausa entre peticiones consecutivas: son unas 60 en serie para un plan grande.
  pausaMs?: number;
}

const PROPIEDADES: PropiedadWikidata[] = ["P571", "P1619", "P84", "P2048", "P1435", "P1174"];

interface ValorSnak {
  datavalue?: { value?: unknown };
}
interface Declaracion {
  rank?: string;
  mainsnak?: ValorSnak;
  qualifiers?: Record<string, ValorSnak[]>;
}
interface EntidadBruta {
  id?: string;
  claims?: Record<string, Declaracion[]>;
  sitelinks?: Record<string, { title?: string }>;
  labels?: Record<string, { value?: string }>;
}
interface RespuestaEntidades {
  entities?: Record<string, EntidadBruta>;
}

function anioDe(valor: unknown): number | undefined {
  const tiempo = (valor as { time?: string } | undefined)?.time;
  const m = typeof tiempo === "string" ? /^([+-])(\d{1,6})-/.exec(tiempo) : null;
  return m && m[1] === "+" ? Number(m[2]) : undefined;
}

function cantidadDe(valor: unknown): number | undefined {
  const cantidad = (valor as { amount?: string } | undefined)?.amount;
  const n = typeof cantidad === "string" ? Number(cantidad) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function idDe(valor: unknown): string | undefined {
  const id = (valor as { id?: string } | undefined)?.id;
  return typeof id === "string" && /^Q\d+$/.test(id) ? id : undefined;
}

export function crearFuenteCuriosidadesWikimedia(opciones: OpcionesFuenteCuriosidades = {}): FuenteCuriosidades {
  const fetchImpl = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? relojReal;
  const pausaMs = opciones.pausaMs ?? 250;
  let ultima = false;

  async function pedir<T>(url: string): Promise<T> {
    if (ultima && pausaMs > 0) await reloj.dormir(pausaMs);
    ultima = true;
    const hacer = () => fetchImpl(url, { headers: { "User-Agent": userAgent() } });
    try {
      let respuesta = await hacer();
      if (respuesta.status === 429 || respuesta.status >= 500) {
        await reloj.dormir(30_000);
        respuesta = await hacer();
      }
      if (!respuesta.ok) throw new FalloFuenteCuriosidades(`HTTP ${respuesta.status}`);
      return (await respuesta.json()) as T;
    } catch (error) {
      throw error instanceof FalloFuenteCuriosidades ? error : new FalloFuenteCuriosidades(error instanceof Error ? error.message : "fallo de red");
    }
  }

  async function extractos(lang: IdiomaCuriosidad, titulos: string[], intro: boolean): Promise<Map<string, string>> {
    const url =
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&formatversion=2` +
      `${intro ? `&exintro=1&exlimit=${titulos.length}` : ""}&titles=${encodeURIComponent(titulos.join("|"))}`;
    const datos = await pedir<{
      query?: {
        normalized?: Array<{ from: string; to: string }>;
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<{ title?: string; missing?: boolean; extract?: string }>;
      };
    }>(url);
    const porTitulo = new Map<string, string>();
    for (const p of datos.query?.pages ?? []) if (p.title && !p.missing && p.extract) porTitulo.set(p.title, p.extract);
    // La respuesta usa el título normalizado y redirigido: se devuelve por el
    // título que pidió quien llama.
    const salida = new Map<string, string>();
    for (const pedido of titulos) {
      let titulo = pedido;
      titulo = datos.query?.normalized?.find((n) => n.from === titulo)?.to ?? titulo;
      titulo = datos.query?.redirects?.find((r) => r.from === titulo)?.to ?? titulo;
      const texto = porTitulo.get(titulo);
      if (texto) salida.set(pedido, texto);
    }
    return salida;
  }

  return {
    async entidades(qids) {
      const resultado = new Map<string, EntidadWikidata>();
      const brutas = new Map<string, EntidadBruta>();
      for (let i = 0; i < qids.length; i += 50) {
        const lote = qids.slice(i, i + 50);
        const datos = await pedir<RespuestaEntidades>(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${lote.join("|")}&props=claims|sitelinks&sitefilter=eswiki|enwiki&format=json`,
        );
        for (const [qid, e] of Object.entries(datos.entities ?? {})) brutas.set(qid, e);
      }
      // Segunda llamada: etiquetas de los valores que son entidades (arquitecto, protección).
      const valores = new Set<string>();
      for (const e of brutas.values()) {
        for (const p of ["P84", "P1435"]) for (const d of e.claims?.[p] ?? []) {
          const id = idDe(d.mainsnak?.datavalue?.value);
          if (id && d.rank !== "deprecated") valores.add(id);
        }
      }
      const etiquetas = new Map<string, string>();
      const lista = [...valores];
      for (let i = 0; i < lista.length; i += 50) {
        const datos = await pedir<RespuestaEntidades>(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${lista.slice(i, i + 50).join("|")}&props=labels&languages=es|en&format=json`,
        );
        for (const [id, e] of Object.entries(datos.entities ?? {})) {
          const etiqueta = e.labels?.es?.value ?? e.labels?.en?.value;
          if (etiqueta) etiquetas.set(id, etiqueta);
        }
      }
      for (const [qid, e] of brutas) {
        const hechos: HechoWikidata[] = [];
        for (const propiedad of PROPIEDADES) {
          const declaraciones = (e.claims?.[propiedad] ?? []).filter((d) => d.rank !== "deprecated");
          if (declaraciones.length === 0) continue;
          const valorDe = (d: Declaracion) => d.mainsnak?.datavalue?.value;
          if (propiedad === "P571" || propiedad === "P1619") {
            const anio = anioDe(valorDe(declaraciones[0]));
            if (anio !== undefined) hechos.push({ propiedad, anio });
          } else if (propiedad === "P2048") {
            const numero = cantidadDe(valorDe(declaraciones[0]));
            if (numero !== undefined) hechos.push({ propiedad, numero });
          } else if (propiedad === "P1174") {
            // La medida más reciente.
            const fechadas = declaraciones
              .map((d) => ({ numero: cantidadDe(valorDe(d)), anioMedida: anioDe(d.qualifiers?.P585?.[0]?.datavalue?.value) }))
              .filter((x): x is { numero: number; anioMedida: number | undefined } => x.numero !== undefined)
              .sort((a, b) => (b.anioMedida ?? 0) - (a.anioMedida ?? 0));
            if (fechadas[0]) hechos.push({ propiedad, numero: fechadas[0].numero, ...(fechadas[0].anioMedida !== undefined ? { anioMedida: fechadas[0].anioMedida } : {}) });
          } else {
            const nombres = declaraciones.map((d) => idDe(valorDe(d))).map((id) => (id ? etiquetas.get(id) : undefined)).filter((n): n is string => Boolean(n));
            if (nombres.length > 0) hechos.push({ propiedad, etiquetas: nombres });
          }
        }
        resultado.set(qid, {
          qid,
          titulos: { ...(e.sitelinks?.eswiki?.title ? { es: e.sitelinks.eswiki.title } : {}), ...(e.sitelinks?.enwiki?.title ? { en: e.sitelinks.enwiki.title } : {}) },
          hechos,
        });
      }
      return resultado;
    },

    async articulo(lang, titulo) {
      return (await extractos(lang, [titulo], false)).get(titulo) ?? null;
    },

    async entradillas(lang, titulos) {
      return titulos.length === 0 ? new Map() : extractos(lang, titulos, true);
    },
  };
}
