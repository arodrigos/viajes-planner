// El nº de dígitos del código de acceso lo decide Supabase Auth (ajuste del
// proyecto), no este producto -- issue #181, tercer caso real del día: el
// proyecto DEV real emite 8, la documentación de Supabase (y esta pila local)
// cita 6 como valor por defecto. Un solo sitio de verdad para cliente y
// servidor, en vez de dos regex iguales que alguien puede dejar de sincronizar.
export const CODIGO_VALIDO = /^\d{6,10}$/;
