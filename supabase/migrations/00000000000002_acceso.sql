-- Bloque acceso: cada trabajo queda atado a quien lo pidió, que es lo que
-- hace posible el límite por usuario y por hora (acceso-ac3).
--
-- search_path fijado en cada fichero de migración (no solo en el primero):
-- cada migración puede aplicarse en su propia sesión/transacción, y sin
-- esto `trabajos` no se resolvería contra `viajes_planner`.
set search_path = viajes_planner, public, extensions;

alter table trabajos add column usuario_id uuid references auth.users (id);
create index trabajos_usuario_creado_idx on trabajos (usuario_id, creado_en);
