-- Feedback del gatekeeper sobre barrido-todos-los-planes (bar-ac4, 2026-10-04):
-- hoy no hay NINGUNA forma de saber desde fuera qué commit ejecuta el
-- trabajador de VPS1 ni cómo acabó su último tick -- /api/salud informa del
-- commit de VERCEL, no del suyo, y una excepción en el barrido mata el tick
-- entero sin dejar rastro mientras el heartbeat sigue latiendo igual. Estas
-- dos columnas, puramente aditivas, dejan de hacer indistinguibles "código
-- viejo en VPS1", "excepción que aborta el barrido" y "reintento hecho que
-- salió negativo".
set search_path = viajes_planner, public, extensions;

alter table salud
  add column commit_sha text,
  add column resultado jsonb;
