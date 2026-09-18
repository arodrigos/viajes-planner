-- Bloque acceso: cada trabajo queda atado a quien lo pidió, que es lo que
-- hace posible el límite por usuario y por hora (acceso-ac3).
alter table trabajos add column usuario_id uuid references auth.users (id);
create index trabajos_usuario_creado_idx on trabajos (usuario_id, creado_en);
