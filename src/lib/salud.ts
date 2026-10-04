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
  error?: string;
}

export interface EstadoTrabajador {
  visto_hace_seg: number | null;
  commit_sha?: string | null;
  ultimo_resultado?: ResultadoTickTrabajador | null;
}

// lug-ac6: expone qué pila resuelve lugares y pinta el mapa -- lo lee el
// smoke_test del manifiesto para confirmar que el código desplegado es el
// de este bloque, no solo que está mergeado.
export interface Fuentes {
  lugares: string;
  mapa: string;
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
  planes_total: number;
  planes_sin_version: number;
  planes_sin_trabajo_vivo: number;
  // ciu-ac6: cuántos planes ya tienen ciudad efectiva resuelta y cuántos
  // se dieron por "sin ciudad identificable" -- la suma de los dos nunca
  // supera planes_total (quedan planes.ciudad null por resolver o con
  // fallo de red persistente).
  planes_con_ciudad: number;
  planes_sin_ciudad_identificable: number;
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
            ...(opciones.trabajadorUltimoResultado === undefined
              ? {}
              : { ultimo_resultado: opciones.trabajadorUltimoResultado }),
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
