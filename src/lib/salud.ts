// Estado del despliegue: el commit se lee de la variable que Vercel inyecta en
// build y runtime (VERCEL_GIT_COMMIT_SHA). En local/CI no hay ese entorno de
// Vercel, así que se acepta COMMIT_SHA como equivalente para poder verificar
// el mismo contrato antes de desplegar.
export interface EstadoDependencia {
  nombre: string;
  ok: boolean;
  detalle?: string;
}

export interface EstadoTrabajador {
  visto_hace_seg: number | null;
}

// lug-ac6: expone qué pila resuelve lugares y pinta el mapa -- lo lee el
// smoke_test del manifiesto para confirmar que el código desplegado es el
// de este bloque, no solo que está mergeado.
export interface Fuentes {
  lugares: string;
  mapa: string;
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
  secretosFaltantes?: string[];
  credencialesModeloEnWeb?: boolean;
  fuentes?: Fuentes;
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
      : { trabajador: { visto_hace_seg: opciones.trabajadorVistoHaceSeg } }),
    ...(opciones.secretosFaltantes === undefined ? {} : { secretos_faltantes: opciones.secretosFaltantes }),
    ...(opciones.credencialesModeloEnWeb === undefined
      ? {}
      : { credenciales_modelo_en_web: opciones.credencialesModeloEnWeb }),
    ...(opciones.fuentes === undefined ? {} : { fuentes: opciones.fuentes }),
  };
}
