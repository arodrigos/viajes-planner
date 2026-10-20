set search_path = viajes_planner, public, extensions;

-- El producto solo toca miembros_plan con service_role (miembros.ts,
-- propiedad.ts, listar.ts). El SELECT que dio la 032 y el que concede por
-- defecto el esquema abrían una lectura por la Data API a cualquier usuario
-- autenticado del proyecto compartido sin que nada la necesite. Las dos
-- políticas de SELECT se quedan: sin privilegio no se evalúan, y quitarlas
-- sería DDL no aditivo.
revoke select on viajes_planner.miembros_plan from authenticated;
