-- Bloque lugares-resolucion: coordenadas y procedencia reales por parada,
-- resueltas contra las fuentes abiertas (Nominatim/OSM y Wikipedia) en el
-- trabajador de VPS1. Puramente aditiva (ADD COLUMN, CREATE INDEX): no se
-- toca ningún CHECK existente -procedencias.fuente sigue admitiendo solo
-- 'propuesto-sin-verificar' (migración 005); la procedencia pública se
-- deriva en repositorio.ts a partir de `lugar`, no se guarda aquí.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column categoria text,
  add column lugar jsonb,
  add column foto jsonb,
  add column resolucion jsonb,
  add column foto_intentada_en timestamptz;

-- Para el barrido del bloque relleno-planes-existentes: encontrar rápido
-- las paradas que todavía no se han intentado resolver.
create index paradas_pendientes_idx on paradas (plan_version_id) where resolucion is null;
