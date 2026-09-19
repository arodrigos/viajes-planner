-- Bloque esquema-y-persistencia (recorte a fase 1): la parada pasa de un
-- "sitio" con coordenadas obligatorias a nombre + descripción obligatorios y
-- coordenadas opcionales -en fase 1 el modelo no resuelve contra ninguna
-- ficha con ubicación real todavía (F2-02)-, y la procedencia se reduce a un
-- único valor posible. No se toca la tabla procedencias en sí (el diseño
-- recortado la da por fundida en paradas, pero ya existe, ya cumple RLS y
-- cache_fichas -tabla de fase 2 construida en la iteración anterior- la
-- referencia; sustituirla por columnas en paradas sería una migración
-- destructiva para ahorrar una tabla que ya funciona, no un requisito real
-- de ningún criterio de aceptación).
set search_path = viajes_planner, public, extensions;

alter table paradas rename column sitio_nombre to nombre;
alter table paradas add column descripcion text not null default '';
alter table paradas alter column descripcion drop default;

alter table paradas rename column sitio_lat to lat;
alter table paradas rename column sitio_lon to lon;
alter table paradas alter column lat drop not null;
alter table paradas alter column lon drop not null;

-- Único valor posible en fase 1 (ver src/lib/plan/tipos.ts). F2-08 añadirá
-- los orígenes reales y ampliará este check en una migración propia.
alter table procedencias drop constraint procedencias_fuente_check;
alter table procedencias add constraint procedencias_fuente_check
  check (fuente in ('propuesto-sin-verificar'));
