// Solo para e2e: procesa UN trabajo con el doble del modelo (cuenta
// invocaciones) y Nominatim grabado, en un proceso aparte porque Playwright no
// resuelve `server-only` y esto sí con --conditions=react-server. Imprime en
// la última línea el número de invocaciones del modelo.
import { clienteServicio } from "../src/lib/db/cliente";
import type { CriteriosViaje } from "../src/lib/criterios/tipos";
import { fuenteZonasGrabada } from "../src/lib/testing/nominatimGrabado";
import { procesarTrabajo } from "../src/lib/trabajador/procesarTrabajo";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Falta el id del trabajo");
  const supabase = clienteServicio();
  const { data, error } = await supabase.from("trabajos").select("id, plan_id, criterios").eq("id", id).single();
  if (error || !data) throw new Error(`No se encontró el trabajo ${id}: ${error?.message}`);

  let invocaciones = 0;
  const ejecutor = {
    async invocar() {
      invocaciones += 1;
      return { texto: "{}" };
    },
  };
  await procesarTrabajo(
    supabase,
    { id: data.id, plan_id: data.plan_id, criterios: data.criterios as CriteriosViaje },
    { ejecutor, directorio: process.cwd(), fuenteLugares: fuenteZonasGrabada().fuente },
  );
  console.log(`INVOCACIONES=${invocaciones}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
