// Estado del despliegue: el commit se lee de la variable que Vercel inyecta en
// build y runtime (VERCEL_GIT_COMMIT_SHA). En local/CI no hay ese entorno de
// Vercel, así que se acepta COMMIT_SHA como equivalente para poder verificar
// el mismo contrato antes de desplegar.
export interface EstadoDependencia {
  nombre: string;
  ok: boolean;
  detalle?: string;
}

export interface RespuestaSalud {
  ok: boolean;
  version: string;
  commit: string;
  dependencias: EstadoDependencia[];
  crons_registrados?: number;
}

export function commitDesplegado(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? "0".repeat(40);
}

export function construirSalud(
  dependencias: EstadoDependencia[] = [],
  cronsRegistrados?: number,
): RespuestaSalud {
  const commit = commitDesplegado();
  return {
    ok: commit.length === 40 && dependencias.every((d) => d.ok),
    version: process.env.npm_package_version ?? "0.0.0",
    commit,
    dependencias,
    ...(cronsRegistrados === undefined ? {} : { crons_registrados: cronsRegistrados }),
  };
}
