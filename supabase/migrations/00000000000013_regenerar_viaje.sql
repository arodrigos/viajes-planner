-- Bloque regenerar-viaje: una columna para saber cuándo se reencoló el
-- trabajo propietario de un plan para pedirle una nueva versión -- permite
-- distinguir una primera generación de una regeneración y limitarla a una
-- vez por hora (reg-ac3). Solo ADD COLUMN: aditiva, el código más viejo que
-- aún no la conoce sigue funcionando igual.
set search_path = viajes_planner, public, extensions;

alter table trabajos add column regenerado_en timestamptz;
