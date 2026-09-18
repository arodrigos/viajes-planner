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

export interface RespuestaSalud {
  ok: boolean;
  version: string;
  commit: string;
  dependencias: EstadoDependencia[];
  crons_registrados?: number;
  supabase?: "activa" | "error";
  esquema_version?: number;
  modelo_acceso?: string;
  trabajador?: EstadoTrabajador;
  secretos_faltantes?: string[];
  credenciales_modelo_en_web?: boolean;
}

// Se incrementa a mano cuando una migración cambia una forma que este
// endpoint u otro consumidor externo observan (no en cada migración: la
// mayoría son aditivas y no rompen a nadie). Hoy solo existe la migración
// inicial (00000000000001_esquema_inicial.sql), de ahí el 1.
export const ESQUEMA_VERSION = 1;

export function commitDesplegado(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? "0".repeat(40);
}

export interface OpcionesSalud {
  dependencias?: EstadoDependencia[];
  cronsRegistrados?: number;
  supabase?: "activa" | "error";
  esquemaVersion?: number;
  modeloAcceso?: string;
  trabajadorVistoHaceSeg?: number | null;
  secretosFaltantes?: string[];
  credencialesModeloEnWeb?: boolean;
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
    ...(opciones.esquemaVersion === undefined ? {} : { esquema_version: opciones.esquemaVersion }),
    ...(opciones.modeloAcceso === undefined ? {} : { modelo_acceso: opciones.modeloAcceso }),
    ...(opciones.trabajadorVistoHaceSeg === undefined
      ? {}
      : { trabajador: { visto_hace_seg: opciones.trabajadorVistoHaceSeg } }),
    ...(opciones.secretosFaltantes === undefined ? {} : { secretos_faltantes: opciones.secretosFaltantes }),
    ...(opciones.credencialesModeloEnWeb === undefined
      ? {}
      : { credenciales_modelo_en_web: opciones.credencialesModeloEnWeb }),
  };
}
