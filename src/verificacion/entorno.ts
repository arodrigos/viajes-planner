import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Dentro de artefactos/, que .gitignore ya excluye: la sesión guardada lleva
// cookies válidas y no puede acabar en un commit de un repo público.
export const DIRECTORIO = process.env.VERIFICACION_DIR ?? "artefactos/verificacion";
export const RUTA_SESION = join(DIRECTORIO, "sesion.json");
export const RUTA_PLAN = join(DIRECTORIO, "plan.json");

export function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Las specs no crean el plan: lo deja el global setup, y aquí solo se lee.
export function planDePrueba(): string {
  const delEntorno = process.env.PLAN_PRUEBA_ID;
  if (delEntorno) return delEntorno;
  if (!existsSync(RUTA_PLAN)) throw new Error("No hay plan de prueba: el global setup no ha escrito plan.json");
  return (JSON.parse(readFileSync(RUTA_PLAN, "utf8")) as { id: string }).id;
}
