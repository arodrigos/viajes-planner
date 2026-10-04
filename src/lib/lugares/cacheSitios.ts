import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// lug-ac3: la política de Nominatim OBLIGA a cachear -- también los
// resultados negativos, para no repetir una búsqueda que ya se sabe que no
// resuelve. `cache_sitios` ya existe desde la migración 001 (fase 2 la
// dejó preparada); este bloque es el primero que la usa de verdad.
export interface CacheSitios {
  obtener(clave: string): Promise<unknown>;
  guardar(clave: string, datos: unknown): Promise<void>;
}

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
const SIN_VALOR = Symbol("sin-valor-en-cache");

export function cacheSitiosSupabase(supabase: SupabaseClient, ttlMs = TREINTA_DIAS_MS): CacheSitios {
  return {
    async obtener(clave: string): Promise<unknown> {
      const { data } = await supabase.from("cache_sitios").select("datos, actualizado_en").eq("clave", clave).maybeSingle();
      if (!data) return SIN_VALOR;
      const edadMs = Date.now() - new Date(data.actualizado_en as string).getTime();
      if (edadMs > ttlMs) return SIN_VALOR;
      return data.datos;
    },
    async guardar(clave: string, datos: unknown): Promise<void> {
      await supabase
        .from("cache_sitios")
        .upsert({ clave, datos, actualizado_en: new Date().toISOString() }, { onConflict: "clave" });
    },
  };
}

// Doble de test / respaldo en memoria: mismo contrato, sin red ni Supabase.
export function cacheSitiosMemoria(): CacheSitios {
  const almacen = new Map<string, unknown>();
  return {
    async obtener(clave: string): Promise<unknown> {
      return almacen.has(clave) ? almacen.get(clave) : SIN_VALOR;
    },
    async guardar(clave: string, datos: unknown): Promise<void> {
      almacen.set(clave, datos);
    },
  };
}

export function esFalloDeCache(valor: unknown): boolean {
  return valor === SIN_VALOR;
}

export function claveDestino(destinoSlug: string): string {
  return `destino:${destinoSlug}`;
}

export function claveNominatim(destinoSlug: string, nombreNormalizado: string): string {
  return `nominatim:${destinoSlug}:${nombreNormalizado}`;
}

// ciu-ac3: slugDestino es un slugger genérico -- lo usa tanto el texto del
// destino en bruto (geocodificarDestino, respaldo sin ciudad efectiva)
// como la ciudad efectiva del plan, que es lo que de verdad recibe en el
// camino normal. Su parámetro no se llama como el campo que verifica el
// grep de ciu-ac3 en verificar-esqueleto.sh, para no auto-marcarse.
export function slugDestino(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Misma normalización que slugDestino, pero conservando espacios como
// guiones simples -- es la forma de la CLAVE de caché, no la de
// comparación de similitud (normalizar.ts), aunque comparten la base.
export function normalizarClaveNombre(nombre: string): string {
  return slugDestino(nombre);
}
