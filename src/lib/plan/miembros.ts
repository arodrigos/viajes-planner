import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { correoPermitido } from "@/lib/auth/allowlist";

export const MAX_MIEMBROS = 10;

export const MENSAJES_MIEMBROS = {
  correo: "Escribe un correo válido.",
  noPermitido: "Ese correo no puede entrar en viajes. Solo se puede compartir con correos que ya tienen acceso.",
  propio: "Ese es tu propio correo.",
  lleno: `Este plan ya está compartido con ${MAX_MIEMBROS} personas, que es el máximo.`,
} as const;

export interface Miembro {
  id: string;
  correo: string;
  creado_en: string;
}

const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function contarMiembros(supabase: SupabaseClient, planId: string): Promise<number> {
  const { count, error } = await supabase.from("miembros_plan").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  if (error) throw new Error(`No se pudo contar los miembros del plan: ${error.message}`);
  return count ?? 0;
}

export async function listarMiembros(supabase: SupabaseClient, planId: string): Promise<Miembro[]> {
  const { data, error } = await supabase.from("miembros_plan").select("id, correo, creado_en").eq("plan_id", planId).order("creado_en", { ascending: true });
  if (error) throw new Error(`No se pudo listar los miembros del plan: ${error.message}`);
  return (data ?? []) as Miembro[];
}

export type ResultadoInvitar =
  | { estado: "creado" | "ya-existia"; miembro: { id: string; correo: string } }
  | { estado: "invalido" | "no-permitido" | "propio" | "lleno"; error: string };

// El correo se normaliza igual que la lista de permitidos y que la columna
// (minúsculas, sin espacios), así «B@Example.com » y «b@example.com» son una sola invitación.
export async function invitarMiembro(supabase: SupabaseClient, planId: string, invitadoPor: { usuarioId: string; email: string }, correoCrudo: unknown): Promise<ResultadoInvitar> {
  const correo = typeof correoCrudo === "string" ? correoCrudo.trim().toLowerCase() : "";
  if (correo.length < 3 || correo.length > 254 || !FORMATO_CORREO.test(correo)) return { estado: "invalido", error: MENSAJES_MIEMBROS.correo };
  if (!correoPermitido(correo)) return { estado: "no-permitido", error: MENSAJES_MIEMBROS.noPermitido };
  if (correo === invitadoPor.email.trim().toLowerCase()) return { estado: "propio", error: MENSAJES_MIEMBROS.propio };

  const { data: existente, error: errorExistente } = await supabase.from("miembros_plan").select("id, correo").eq("plan_id", planId).eq("correo", correo).maybeSingle();
  if (errorExistente) throw new Error(`No se pudo comprobar la invitación: ${errorExistente.message}`);
  if (existente) return { estado: "ya-existia", miembro: existente as { id: string; correo: string } };

  if ((await contarMiembros(supabase, planId)) >= MAX_MIEMBROS) return { estado: "lleno", error: MENSAJES_MIEMBROS.lleno };

  const { data, error } = await supabase.from("miembros_plan").insert({ plan_id: planId, correo, invitado_por: invitadoPor.usuarioId }).select("id, correo").single();
  if (error) {
    // Dos invitaciones simultáneas al mismo correo: gana la unique, la otra es un repetido.
    if (error.code === "23505") {
      const { data: carrera } = await supabase.from("miembros_plan").select("id, correo").eq("plan_id", planId).eq("correo", correo).maybeSingle();
      if (carrera) return { estado: "ya-existia", miembro: carrera as { id: string; correo: string } };
    }
    throw new Error(`No se pudo guardar la invitación: ${error.message}`);
  }
  return { estado: "creado", miembro: data as { id: string; correo: string } };
}

// Filtra por plan_id además de por id: un miembroId de otro plan no borra nada (404).
export async function quitarMiembro(supabase: SupabaseClient, planId: string, miembroId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(miembroId)) return false;
  const { data, error } = await supabase.from("miembros_plan").delete().eq("id", miembroId).eq("plan_id", planId).select("id");
  if (error) throw new Error(`No se pudo quitar al miembro: ${error.message}`);
  return (data ?? []).length > 0;
}
