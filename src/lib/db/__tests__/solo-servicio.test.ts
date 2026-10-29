import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// grt-ac3: desde la migración 35 anon y authenticated no tienen ningún
// privilegio sobre los datos del producto. Este inventario garantiza que
// ningún camino de la app o del trabajador depende de ellos: los datos solo
// pasan por clienteServicio, y los clientes de sesión (anon key) solo llaman
// a .auth.*. Recorre el árbol real en vez de una lista de ficheros que se
// quedaría vieja.
const RAIZ = path.resolve(import.meta.dirname, "../../../..");
const CONSTRUCTORES = /\b(createClient|createServerClient|createBrowserClient)\b/;

// Ficheros que pueden construir un cliente de Supabase. Los tres últimos no
// estaban en la lista del diseño (las rutas de verificar código y cerrar
// sesión necesitan escribir cookies de sesión): se admiten porque solo
// llaman a .auth.* y el test lo comprueba.
const PERMITIDOS = new Set([
  "src/lib/db/cliente.ts",
  "src/lib/db/clienteDePrueba.ts",
  "src/lib/auth/sesion.ts",
  "src/middleware.ts",
  "src/app/api/acceso/verificar-codigo/manejador.ts",
  "src/app/api/auth/cerrar-sesion/manejador.ts",
  "src/test-utils/sesiones.ts",
]);
const SOLO_AUTH = [...PERMITIDOS].filter((f) => !f.startsWith("src/lib/db/"));

function ficheros(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : ficheros(ruta);
    return /\.(ts|tsx|mjs|mts)$/.test(e.name) && !/\.(test|e2e)\.[tj]sx?$/.test(e.name) ? [ruta] : [];
  });
}

// Quita comentarios para que una mención en prosa no cuente como uso.
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function leer(ruta: string): string {
  return sinComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
}

const TODOS = [...ficheros("src"), ...ficheros("scripts")];

describe("solo clienteServicio toca datos (grt-ac3)", () => {
  it("ningún fichero fuera de la lista construye un cliente de Supabase", () => {
    const fuera = TODOS.filter((f) => CONSTRUCTORES.test(leer(f)) && !PERMITIDOS.has(f));
    expect(fuera).toEqual([]);
  });

  it("los clientes de sesión solo llaman a .auth.*, nunca a .from, .rpc ni .schema", () => {
    const usos: string[] = [];
    for (const f of SOLO_AUTH) {
      leer(f)
        .split("\n")
        .forEach((linea, i) => {
          if (/\.(from|rpc|schema)\(/.test(linea)) usos.push(`${f}:${i + 1}`);
        });
    }
    expect(usos).toEqual([]);
  });

  it("clienteAnonimo solo se pasa a código que llama a .auth.*", () => {
    const usuarios = TODOS.filter((f) => f !== "src/lib/db/cliente.ts" && /\bclienteAnonimo\b/.test(leer(f)));
    expect(usuarios).toEqual(["src/app/api/acceso/solicitar-codigo/manejador.ts"]);
    // El cliente anónimo entra en procesarSolicitudCodigo: ahí no puede haber datos.
    const consumidor = leer("src/lib/auth/solicitarCodigo.ts");
    expect(consumidor).not.toMatch(/\.(from|rpc|schema)\(/);
    expect(consumidor).toMatch(/\.auth\./);
  });

  it("el detector falla con un .from añadido a un cliente de sesión", () => {
    const sucio = sinComentarios(`const c = createServerClient(u, k, {});\nawait c.from("planes").select();`);
    expect(/\.(from|rpc|schema)\(/.test(sucio)).toBe(true);
    expect(CONSTRUCTORES.test(sucio)).toBe(true);
  });
});
