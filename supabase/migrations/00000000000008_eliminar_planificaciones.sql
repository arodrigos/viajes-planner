-- Bloque eliminar-planificaciones: borrado MARCADO, no físico -- el brief
-- dice que no hay copia ni papelera, así que la acción destructiva del
-- producto nace reversible por la base de datos (Adrián puede poner esta
-- columna a null a mano) aunque la aplicación no ofrezca deshacerla.
set search_path = viajes_planner, public, extensions;

alter table trabajos add column eliminado_en timestamptz;
