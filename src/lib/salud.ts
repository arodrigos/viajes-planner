// Estado del despliegue: el commit se lee de la variable que Vercel inyecta en
// build y runtime (VERCEL_GIT_COMMIT_SHA). En local/CI no hay ese entorno de
// Vercel, así que se acepta COMMIT_SHA como equivalente para poder verificar
// el mismo contrato antes de desplegar.
export interface EstadoDependencia {
  nombre: string;
  ok: boolean;
  detalle?: string;
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04): el resultado del ÚLTIMO
// tick ejecutado, para distinguir desde fuera "código viejo en VPS1" (sha
// desfasado), "excepción que aborta el barrido" (error presente) y
// "reintento que de verdad se hizo y salió negativo" (ok con contadores en
// cero) -- hoy las tres son indistinguibles porque el heartbeat se escribe
// antes de hacer nada.
export interface ResultadoTickTrabajador {
  ok: boolean;
  trabajos_procesados: number;
  planes_mirados: number;
  paradas_intentadas: number;
  // bar-ac4 (feedback del gatekeeper, 2026-10-04): opcionales porque los
  // ticks anteriores a este bloque no los escriben, y un literal viejo en
  // un test no tiene por qué incluirlos.
  planes_resueltos?: number;
  planes_reintentados?: number;
  planes_saltados_sellados?: number;
  planes_saltados_por_red?: number;
  // alc-ac2: lo que hicieron los barridos de alternativas en ese tick.
  alternativas_candidatas?: number;
  alternativas_intentadas?: number;
  alternativas_con_cercanos?: number;
  alternativas_sin_datos?: number;
  alternativas_sin_categoria?: number;
  alternativas_sin_coordenadas?: number;
  alternativas_categorizadas?: number;
  alternativas_fallo_fuente?: number;
  alternativas_error_interno?: number;
  error?: string;
}

// cam-ac4: lista cerrada con la que /api/salud resume por qué falló el último
// tick. El texto crudo del error puede llevar el destino de un viaje (p. ej.
// «Nominatim 503 al buscar Lisboa») y /api/salud es público.
export const CATEGORIAS_RESULTADO = [
  "ok",
  "red",
  "cuota",
  "modelo",
  "base-de-datos",
  "fuente-externa",
  "desconocido",
] as const;
export type CategoriaResultado = (typeof CATEGORIAS_RESULTADO)[number];

// El orden importa: una cuota agotada de una fuente externa es «cuota», y un
// 503 de Nominatim es «fuente-externa» aunque el mensaje mencione un fetch.
const REGLAS_CATEGORIA: ReadonlyArray<readonly [CategoriaResultado, RegExp]> = [
  ["cuota", /\b429\b|cuota|rate.?limit|quota/i],
  ["fuente-externa", /nominatim|overpass|wikipedia|wikimedia|commons|wikivoyage|wikidata|openholidays|nager/i],
  ["base-de-datos", /postgrest|pgrst|supabase|postgres|base de datos/i],
  ["modelo", /modelo|claude|anthropic/i],
  ["red", /fetch|econn|etimedout|enotfound|eai_again|socket|network|timeout|tiempo de espera/i],
];

export function categorizarResultado(resultado: unknown): CategoriaResultado {
  if (typeof resultado !== "object" || resultado === null || Array.isArray(resultado)) return "desconocido";
  const { ok, error } = resultado as { ok?: unknown; error?: unknown };
  if (error === undefined || error === null) return ok === true ? "ok" : "desconocido";
  if (typeof error !== "string") return "desconocido";
  return REGLAS_CATEGORIA.find(([, patron]) => patron.test(error))?.[0] ?? "desconocido";
}

// Lista blanca de contadores: salud.resultado es jsonb libre, así que ni el
// texto del error ni ninguna clave inesperada salen de aquí.
const CONTADORES_PUBLICOS = [
  "trabajos_procesados",
  "planes_mirados",
  "paradas_intentadas",
  "planes_resueltos",
  "planes_reintentados",
  "planes_saltados_sellados",
  "planes_saltados_por_red",
  "alternativas_candidatas",
  "alternativas_intentadas",
  "alternativas_con_cercanos",
  "alternativas_sin_datos",
  "alternativas_sin_categoria",
  "alternativas_sin_coordenadas",
  "alternativas_categorizadas",
  "alternativas_fallo_fuente",
  "alternativas_error_interno",
] as const;

export function resumirResultadoPublico(resultado: ResultadoTickTrabajador): PublicoResultadoTick {
  const origen = (typeof resultado === "object" && resultado !== null ? resultado : {}) as Record<string, unknown>;
  const contadores: Record<string, number> = {};
  for (const clave of CONTADORES_PUBLICOS) {
    const valor = origen[clave];
    if (typeof valor === "number" && Number.isInteger(valor)) contadores[clave] = valor;
  }
  return {
    ok: origen.ok === true,
    trabajos_procesados: 0,
    planes_mirados: 0,
    paradas_intentadas: 0,
    ...contadores,
    categoria: categorizarResultado(resultado),
  };
}

export type PublicoResultadoTick = Omit<ResultadoTickTrabajador, "error"> & { categoria: CategoriaResultado };

// Fila de `salud` que deja un tick con candidatas de alternativas: sobrevive
// al pisado del resultado del tick siguiente.
export const ORIGEN_PASADA_ALTERNATIVAS = "pasada-alternativas";

export interface PasadaAlternativas {
  registrada_hace_seg: number;
  commit_sha: string | null;
  // Solo enteros y la categoría cerrada del último error: el texto crudo
  // (un fallo de PostgREST o de red puede traer un fragmento de consulta o
  // una URL interna) se queda en los logs del trabajador, porque el
  // endpoint es público (hallazgo de seguridad #123).
  contadores: Record<string, number>;
  ultimo_error_categoria: CategoriaResultado | null;
}

export function resumirPasadaAlternativas(
  resultado: unknown,
  registradaHaceSeg: number,
  commitSha: string | null,
): PasadaAlternativas {
  const origen = (typeof resultado === "object" && resultado !== null ? resultado : {}) as Record<string, unknown>;
  const contadores: Record<string, number> = {};
  for (const clave of CONTADORES_PUBLICOS) {
    const valor = origen[clave];
    if (clave.startsWith("alternativas_") && typeof valor === "number" && Number.isInteger(valor)) contadores[clave] = valor;
  }
  const error = origen.ultimo_error;
  return {
    registrada_hace_seg: registradaHaceSeg,
    commit_sha: commitSha,
    contadores,
    ultimo_error_categoria: typeof error === "string" && error ? categorizarResultado({ ok: false, error }) : null,
  };
}

export interface EstadoTrabajador {
  pasada_alternativas?: PasadaAlternativas | null;
  visto_hace_seg: number | null;
  commit_sha?: string | null;
  ultimo_resultado?: PublicoResultadoTick | null;
}

// lug-ac6: expone qué pila resuelve lugares y pinta el mapa -- lo lee el
// smoke_test del manifiesto para confirmar que el código desplegado es el
// de este bloque, no solo que está mergeado.
export interface Fuentes {
  lugares: string;
  mapa: string;
  // Opcionales: los consumidores anteriores no las traen.
  guia?: string;
  eventos?: string;
}

// sal-ac1/sal-ac3: contadores AGREGADOS del relleno real en DEV, todos
// enteros -- es la lista CERRADA de claves que el modelo de amenazas exige:
// ni un destino, ni un nombre de parada, ni un correo, ni un identificador.
export interface EstadoRelleno {
  paradas_total: number;
  paradas_resueltas: number;
  paradas_no_resueltas: number;
  paradas_en_error: number;
  paradas_sin_intentar: number;
  paradas_con_foto: number;
  paradas_con_alternativas: number;
  paradas_con_categoria: number;
  paradas_con_guia: number;
  // Motivo no nulo y no vacío: la razón por la que se propuso la parada.
  paradas_con_motivo: number;
  versiones_con_eventos: number;
  // Versiones con `etapas` no vacío (viaje de varias ciudades) y trabajos
  // que el planificador dio por inviables: sin ellos no se ve si el
  // producto está usando las dos ramas nuevas.
  versiones_multiciudad: number;
  trabajos_inviables: number;
  planes_total: number;
  planes_sin_version: number;
  planes_sin_trabajo_vivo: number;
  // ciu-ac6: cuántos planes ya tienen ciudad efectiva resuelta y cuántos
  // se dieron por "sin ciudad identificable" -- la suma de los dos nunca
  // supera planes_total (quedan planes.ciudad null por resolver o con
  // fallo de red persistente).
  planes_con_ciudad: number;
  planes_sin_ciudad_identificable: number;
  // bar-ac4 (feedback del gatekeeper, 2026-10-04): desglose por categoría
  // de los planes sellados -- lista CERRADA, igual que el resto de esta
  // interfaz, para poder distinguir "182 sin candidato aceptable" (el techo
  // matemático del 85% que ya es inalcanzable) de un sellado real por otra
  // causa, sin tener que leer el texto libre de `motivo`. La suma de las
  // siete no tiene por qué igualar planes_sin_ciudad_identificable: un plan
  // sellado antes de este bloque no tiene categoria_motivo.
  planes_sellados_pocas_paradas: number;
  planes_sellados_sin_caja: number;
  planes_sellados_zona_grande: number;
  planes_sellados_sin_contencion: number;
  planes_sellados_sin_ventaja: number;
  planes_sellados_sin_candidato_claro: number;
  planes_sellados_ciudad_no_encontrada: number;
}

export interface RespuestaSalud {
  ok: boolean;
  version: string;
  commit: string;
  dependencias: EstadoDependencia[];
  crons_registrados?: number;
  supabase?: "activa" | "error";
  esquema?: string;
  esquema_version?: number;
  modelo_acceso?: string;
  trabajador?: EstadoTrabajador;
  secretos_faltantes?: string[];
  credenciales_modelo_en_web?: boolean;
  fuentes?: Fuentes;
  relleno?: EstadoRelleno;
}

// Se incrementa a mano cuando una migración cambia una forma que este
// endpoint u otro consumidor externo observan (no en cada migración: la
// mayoría son aditivas y no rompen a nadie). Sube a 2 con la incisión que
// mueve las doce tablas y las tres funciones de `public` a `viajes_planner`:
// es exactamente el tipo de cambio que un consumidor externo observa.
export const ESQUEMA_VERSION = 2;

export function commitDesplegado(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? "0".repeat(40);
}

export interface OpcionesSalud {
  dependencias?: EstadoDependencia[];
  cronsRegistrados?: number;
  supabase?: "activa" | "error";
  esquema?: string;
  esquemaVersion?: number;
  modeloAcceso?: string;
  trabajadorVistoHaceSeg?: number | null;
  trabajadorCommitSha?: string | null;
  trabajadorUltimoResultado?: ResultadoTickTrabajador | null;
  pasadaAlternativas?: PasadaAlternativas | null;
  secretosFaltantes?: string[];
  credencialesModeloEnWeb?: boolean;
  fuentes?: Fuentes;
  relleno?: EstadoRelleno;
}

// `ok` es deliberadamente estrecho (commit bien formado + las dependencias
// que se le pasen): el resto de campos (supabase, secretos_faltantes...) el
// propio smoke test del manifiesto los exige por separado, con sus propias
// condiciones en el jq -e — no son parte de lo que "ok" resume.
export function construirSalud(opciones: OpcionesSalud = {}): RespuestaSalud {
  const dependencias = opciones.dependencias ?? [];
  const commit = commitDesplegado();

  return {
    ok: commit.length === 40 && dependencias.every((d) => d.ok),
    version: process.env.npm_package_version ?? "0.0.0",
    commit,
    dependencias,
    ...(opciones.cronsRegistrados === undefined ? {} : { crons_registrados: opciones.cronsRegistrados }),
    ...(opciones.supabase === undefined ? {} : { supabase: opciones.supabase }),
    ...(opciones.esquema === undefined ? {} : { esquema: opciones.esquema }),
    ...(opciones.esquemaVersion === undefined ? {} : { esquema_version: opciones.esquemaVersion }),
    ...(opciones.modeloAcceso === undefined ? {} : { modelo_acceso: opciones.modeloAcceso }),
    ...(opciones.trabajadorVistoHaceSeg === undefined
      ? {}
      : {
          trabajador: {
            visto_hace_seg: opciones.trabajadorVistoHaceSeg,
            ...(opciones.trabajadorCommitSha === undefined ? {} : { commit_sha: opciones.trabajadorCommitSha }),
            ...(opciones.pasadaAlternativas === undefined ? {} : { pasada_alternativas: opciones.pasadaAlternativas }),
            ...(opciones.trabajadorUltimoResultado === undefined
              ? {}
              : {
                  ultimo_resultado:
                    opciones.trabajadorUltimoResultado === null
                      ? null
                      : resumirResultadoPublico(opciones.trabajadorUltimoResultado),
                }),
          },
        }),
    ...(opciones.secretosFaltantes === undefined ? {} : { secretos_faltantes: opciones.secretosFaltantes }),
    ...(opciones.credencialesModeloEnWeb === undefined
      ? {}
      : { credenciales_modelo_en_web: opciones.credencialesModeloEnWeb }),
    ...(opciones.fuentes === undefined ? {} : { fuentes: opciones.fuentes }),
    ...(opciones.relleno === undefined ? {} : { relleno: opciones.relleno }),
  };
}
