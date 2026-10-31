import { describe, expect, it } from "vitest";
import { peticion } from "@/test-utils/sesiones";
import { DELETE, POST } from "../[...ruta]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const UUID = "00000000-0000-4000-8000-000000000000";

// Sin sesión, una ruta servida llega al endpoint y da 401; una que la tabla
// del despachador ya no reparte da 404. Así las pruebas de orden, mover-dia y
// reservas no se quedan protegiendo una ruta que dejó de existir.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("la tabla del despachador sigue sirviendo las rutas de edición (reg-ac5)", () => {
  const rutas: { nombre: string; metodo: "POST" | "DELETE"; ruta: string[] }[] = [
    { nombre: "orden", metodo: "POST", ruta: ["orden"] },
    { nombre: "paradas/[paradaId]/mover-dia", metodo: "POST", ruta: ["paradas", "p1", "mover-dia"] },
    { nombre: "reservas", metodo: "POST", ruta: ["reservas"] },
    { nombre: "reservas/[reservaId]", metodo: "DELETE", ruta: ["reservas", UUID] },
  ];

  it.each(rutas)("$metodo $nombre", async ({ nombre, metodo, ruta }) => {
    const id = "plan-prot-tabla";
    const url = `/api/plan/${id}/${ruta.join("/")}`;
    const r = await (metodo === "POST" ? POST : DELETE)(peticion(url, metodo, undefined, metodo === "POST" ? {} : undefined));
    expect(r.status, `la tabla del despachador ya no sirve ${metodo} ${nombre}`).toBe(401);
  });
});
