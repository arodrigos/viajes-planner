-- ciu-ac1/ciu-ac4: la ciudad efectiva del plan (destino -> paradas ->
-- sin-ciudad-identificable), persistida tal cual la devuelve
-- resolverCiudadEfectiva. Puramente aditiva: solo una columna nueva y un
-- índice nuevo, sin quitar ni renombrar nada existente.
set search_path = viajes_planner, public, extensions;

alter table planes add column ciudad jsonb;

-- ciu-ac6: el barrido y /api/salud necesitan encontrar rápido los planes
-- sin ciudad resuelta todavía, sin recorrer la tabla entera.
create index planes_sin_ciudad_idx on planes (id) where ciudad is null;
