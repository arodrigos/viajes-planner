set search_path = viajes_planner, public, extensions;

-- Bloque mis-viajes: RLS como segunda capa sobre trabajos (viajes-ac3).
-- La defensa real es el filtro por usuario_id en el servidor (listarViajes,
-- que usa la clave de servicio y por tanto NUNCA pasa por esta política);
-- esta política solo cubre el día en que algo lea la tabla con la clave
-- anónima o un JWT de usuario. No la presentes como si fuera la primera
-- línea de defensa: no lo es.
create policy "un usuario autenticado solo ve sus propios trabajos"
  on trabajos
  for select
  to authenticated
  using (usuario_id = auth.uid());

-- Sin índice nuevo: DESVIACIÓN declarada respecto al diseño, que pedía
-- "índice y política". trabajos_usuario_creado_idx (usuario_id, creado_en),
-- creado en la migración 2, ya cubre exactamente esta consulta -un btree se
-- recorre en los dos sentidos, así que también sirve al ORDER BY ... DESC
-- del listado. Un segundo índice idéntico sería ruido, no una mejora.
