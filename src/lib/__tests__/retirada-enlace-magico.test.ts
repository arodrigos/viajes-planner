import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "../../..");

// pantalla-ac7(b): la vía del enlace mágico no puede sobrevivir ni como
// fichero huérfano ni como referencia suelta en un fichero que sí se queda.
// Corre como test unitario (sin pila de Supabase) para que el árbol del
// repositorio se compruebe también en local, no solo en el job de e2e.
describe("retirada del enlace mágico (pantalla-ac7b)", () => {
  it("no quedan los ficheros retirados por el bloque codigo-en-la-misma-pantalla", () => {
    for (const ruta of ["src/app/auth", "src/lib/auth/destinoSeguro.ts", "src/lib/criterios/envioPendiente.ts"]) {
      expect(existsSync(path.join(RAIZ, ruta)), `todavía existe ${ruta}`).toBe(false);
    }
  });

  // "token_hash" queda fuera a propósito: es un campo legítimo del SDK de
  // administración de Supabase (generateLink/verifyOtp), que
  // requireSesion.integration.test.ts sigue usando para fabricar una sesión
  // de prueba sin pasar por correo -nada que ver con la ruta retirada, que
  // solo compartía el nombre. Comprobarlo aquí sería un falso positivo
  // permanente, no una señal de código huérfano.
  it("no quedan referencias sueltas a destinoSeguro, envioPendiente, acceso=confirmado ni acceso=error", () => {
    for (const patron of ["destinoSeguro", "envioPendiente", "acceso=confirmado", "acceso=error"]) {
      let salida = "";
      try {
        // --include=*.ts* : el árbol de comentarios históricos (este mismo
        // fichero, CHANGELOG, etc.) no cuenta como código; solo TypeScript.
        // El código de salida 1 de grep (sin coincidencias) es el caso
        // bueno, así que se captura en vez de dejar que tumbe el test.
        salida = execFileSync(
          "grep",
          ["-R", "--include=*.ts", "--include=*.tsx", "-n", patron, path.join(RAIZ, "src")],
          { encoding: "utf-8" },
        );
      } catch (error) {
        const conCodigo = error as { status?: number };
        if (conCodigo.status === 1) continue; // sin coincidencias: correcto
        throw error;
      }
      // Una única excepción legítima: el propio test que documenta la
      // retirada, que necesariamente nombra los patrones retirados.
      const lineas = salida
        .split("\n")
        .filter((l) => l.length > 0)
        .filter((l) => !l.startsWith(path.join(RAIZ, "src/lib/__tests__/retirada-enlace-magico.test.ts")));
      expect(lineas, `referencias sueltas a "${patron}":\n${lineas.join("\n")}`).toHaveLength(0);
    }
  });
});
