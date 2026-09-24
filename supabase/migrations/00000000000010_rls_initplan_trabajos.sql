set search_path = viajes_planner, public, extensions;

alter policy "un usuario autenticado solo ve sus propios trabajos" on trabajos using ((select auth.uid()) = usuario_id);
