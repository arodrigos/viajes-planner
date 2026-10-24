import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Reserva, ReservaEntrada } from "./tipos";

interface Fila {
  id: string;
  tipo: Reserva["tipo"];
  sentido: "ida" | "vuelta" | null;
  fecha_inicio: string;
  hora_inicio: string | null;
  zona_inicio: string | null;
  fecha_fin: string | null;
  hora_fin: string | null;
  zona_fin: string | null;
  origen: string | null;
  destino: string | null;
  nombre: string | null;
  direccion: string | null;
  localizador: string | null;
  notas: string | null;
  lat: number | null;
  lon: number | null;
}

const COLUMNAS = "id, tipo, sentido, fecha_inicio, hora_inicio, zona_inicio, fecha_fin, hora_fin, zona_fin, origen, destino, nombre, direccion, localizador, notas, lat, lon";

// La base devuelve time como HH:MM:SS; el producto trabaja con HH:MM.
const hm = (hora: string | null) => (hora ? hora.slice(0, 5) : undefined);
const o = <T>(valor: T | null): T | undefined => (valor === null ? undefined : valor);

export function deFila(f: Fila): Reserva {
  return {
    id: f.id,
    tipo: f.tipo,
    ...(f.sentido ? { sentido: f.sentido } : {}),
    fecha_inicio: f.fecha_inicio,
    ...(f.hora_inicio ? { hora_inicio: hm(f.hora_inicio) } : {}),
    ...(f.zona_inicio ? { zona_inicio: f.zona_inicio } : {}),
    ...(f.fecha_fin ? { fecha_fin: f.fecha_fin } : {}),
    ...(f.hora_fin ? { hora_fin: hm(f.hora_fin) } : {}),
    ...(f.zona_fin ? { zona_fin: f.zona_fin } : {}),
    ...(f.origen ? { origen: o(f.origen) } : {}),
    ...(f.destino ? { destino: o(f.destino) } : {}),
    ...(f.nombre ? { nombre: o(f.nombre) } : {}),
    ...(f.direccion ? { direccion: o(f.direccion) } : {}),
    ...(f.localizador ? { localizador: o(f.localizador) } : {}),
    ...(f.notas ? { notas: o(f.notas) } : {}),
    ...(f.lat !== null && f.lon !== null ? { ubicacion: { lat: f.lat, lon: f.lon } } : {}),
  };
}

// Todas las columnas van explícitas (null si no vienen): un PATCH sustituye la
// reserva entera, así que un campo que el formulario vació se borra de verdad.
function aFila(r: ReservaEntrada) {
  return {
    tipo: r.tipo,
    sentido: r.sentido ?? null,
    fecha_inicio: r.fecha_inicio,
    hora_inicio: r.hora_inicio ?? null,
    zona_inicio: r.zona_inicio ?? null,
    fecha_fin: r.fecha_fin ?? null,
    hora_fin: r.hora_fin ?? null,
    zona_fin: r.zona_fin ?? null,
    origen: r.origen ?? null,
    destino: r.destino ?? null,
    nombre: r.nombre ?? null,
    direccion: r.direccion ?? null,
    localizador: r.localizador ?? null,
    notas: r.notas ?? null,
    lat: r.ubicacion?.lat ?? null,
    lon: r.ubicacion?.lon ?? null,
  };
}

export async function listarReservas(supabase: SupabaseClient, planId: string): Promise<Reserva[]> {
  const { data, error } = await supabase
    .from("reservas")
    .select(COLUMNAS)
    .eq("plan_id", planId)
    .order("fecha_inicio", { ascending: true })
    .order("hora_inicio", { ascending: true, nullsFirst: true })
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`No se pudieron leer las reservas: ${error.message}`);
  return ((data ?? []) as Fila[]).map(deFila);
}

export async function contarReservas(supabase: SupabaseClient, planId: string): Promise<number> {
  const { count, error } = await supabase.from("reservas").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron contar las reservas: ${error.message}`);
  return count ?? 0;
}

export async function crearReserva(supabase: SupabaseClient, planId: string, reserva: ReservaEntrada): Promise<Reserva> {
  const { data, error } = await supabase.from("reservas").insert({ plan_id: planId, ...aFila(reserva) }).select(COLUMNAS).single();
  if (error) throw new Error(`No se pudo guardar la reserva: ${error.message}`);
  return deFila(data as Fila);
}

// El filtro por plan_id impide tocar una reserva de otro viaje con su id.
export async function actualizarReserva(supabase: SupabaseClient, planId: string, id: string, reserva: ReservaEntrada): Promise<Reserva | null> {
  const { data, error } = await supabase
    .from("reservas")
    .update({ ...aFila(reserva), actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .eq("plan_id", planId)
    .select(COLUMNAS)
    .maybeSingle();
  if (error) throw new Error(`No se pudo actualizar la reserva: ${error.message}`);
  return data ? deFila(data as Fila) : null;
}

export async function borrarReserva(supabase: SupabaseClient, planId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("reservas").delete().eq("id", id).eq("plan_id", planId).select("id").maybeSingle();
  if (error) throw new Error(`No se pudo borrar la reserva: ${error.message}`);
  return data !== null;
}

export async function borrarReservasDelPlan(supabase: SupabaseClient, planId: string): Promise<void> {
  const { error } = await supabase.from("reservas").delete().eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron borrar las reservas del viaje: ${error.message}`);
}

// Las reservas son un extra de la vista: si su lectura falla, el plan sale igual
// (sin ellas) en vez de dejar la pantalla en «Cargando…».
export async function reservasOpcionales(supabase: SupabaseClient, planId: string): Promise<Reserva[]> {
  return listarReservas(supabase, planId).catch(() => []);
}
