// Catálogo de tablas con datos del producto (excluye extensiones de
// Postgres). persistencia-ac2 recorre esta lista para comprobar RLS: una
// tabla nueva sin política de acceso hace fallar el test automáticamente
// en vez de depender de que alguien se acuerde de añadirla a mano.
export const TABLAS = [
  "planes",
  "plan_versiones",
  "procedencias",
  "paradas",
  "visitas",
  "trabajos",
  "cache_sitios",
  "cache_fichas",
  "tipos_cambio",
  "uso_suscripcion",
  "salud",
  "cerrojo_trabajador",
] as const;

export type Tabla = (typeof TABLAS)[number];
