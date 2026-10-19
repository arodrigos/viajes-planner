// Lógica pura de scripts/diagnosticar-relleno.ts: la consulta de solo lectura y
// el saneado de su salida. Vive aquí para poder probarse sin base de datos.

import type { CategoriaMotivoSellado } from "@/lib/lugares/ciudad";

const ESTADOS_CIUDAD = ["resuelta", "pendiente-manual", "sin-ciudad-identificable", "multiciudad", "sin-intentar"] as const;
const CATEGORIAS: ReadonlyArray<CategoriaMotivoSellado | "ninguna"> = [
  "pocas-paradas",
  "sin-caja",
  "zona-grande",
  "sin-contencion",
  "sin-ventaja",
  "sin-candidato-claro",
  "ciudad-no-encontrada",
  "ninguna",
];

// Una sola sentencia que devuelve un JSON con dos listas de recuentos. Solo
// proyecta claves de jsonb y count(*): ni destino, ni nombre de parada, ni id
// salen de la base. La última versión de cada plan es la única que el barrido
// toca, así que es la única que se cuenta.
export const CONSULTA_DIAGNOSTICO = `
begin read only;
with ultima as (
  select distinct on (plan_id) id, plan_id from viajes_planner.plan_versiones order by plan_id, version desc
),
por_ciudad as (
  select coalesce(p.ciudad->>'estado', 'sin-intentar') as estado,
         coalesce(p.ciudad->>'categoria_motivo', 'ninguna') as categoria_motivo,
         coalesce(p.ciudad->>'version_resolutor', 'sin-version') as version_resolutor,
         count(*) as n
  from viajes_planner.planes p join ultima u on u.plan_id = p.id
  group by 1, 2, 3
),
pendientes as (
  select coalesce(p.ciudad->>'estado', 'sin-intentar') as estado_plan, count(*) as n
  from viajes_planner.paradas pa
  join ultima u on u.id = pa.plan_version_id
  join viajes_planner.planes p on p.id = u.plan_id
  where pa.resolucion is null or pa.resolucion->>'estado' = 'error'
  group by 1
)
select json_build_object(
  'planes_por_ciudad', coalesce((select json_agg(row_to_json(c)) from por_ciudad c), '[]'::json),
  'paradas_pendientes_por_estado_plan', coalesce((select json_agg(row_to_json(d)) from pendientes d), '[]'::json)
);
rollback;
`;

export interface ResumenRelleno {
  planes_por_ciudad: Array<{ estado: string; categoria_motivo: string; version_resolutor: number | "sin-version"; planes: number }>;
  paradas_pendientes_por_estado_plan: Array<{ estado_plan: string; paradas: number }>;
}

function entero(valor: unknown): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function dentroDe(valor: unknown, permitidos: ReadonlyArray<string>, porDefecto: string): string {
  return typeof valor === "string" && permitidos.includes(valor) ? valor : porDefecto;
}

// Lo que no está en las listas cerradas se agrupa como «otro»: la salida
// nunca refleja texto libre que venga de la base.
export function construirResumen(crudo: unknown): ResumenRelleno {
  const origen = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<string, unknown>;
  const lista = (clave: string): Array<Record<string, unknown>> => {
    const valor = origen[clave];
    return Array.isArray(valor) ? (valor.filter((f) => typeof f === "object" && f !== null) as Array<Record<string, unknown>>) : [];
  };
  return {
    planes_por_ciudad: lista("planes_por_ciudad").map((f) => ({
      estado: dentroDe(f.estado, ESTADOS_CIUDAD, "otro"),
      categoria_motivo: dentroDe(f.categoria_motivo, CATEGORIAS, "otro"),
      version_resolutor: f.version_resolutor === "sin-version" ? "sin-version" : entero(f.version_resolutor),
      planes: entero(f.n),
    })),
    paradas_pendientes_por_estado_plan: lista("paradas_pendientes_por_estado_plan").map((f) => ({
      estado_plan: dentroDe(f.estado_plan, ESTADOS_CIUDAD, "otro"),
      paradas: entero(f.n),
    })),
  };
}

// psql imprime una línea por sentencia; la que importa es la que empieza por «{».
export function extraerJson(salida: string): unknown {
  const linea = salida.split("\n").find((l) => l.trim().startsWith("{"));
  return linea ? JSON.parse(linea) : {};
}
