import { franjasComoArray } from "../config-franjas";
import type { Alternativa, Dia, Plan } from "../tipos";

// Plan del tamaño del de Londres (4 días × 6 paradas × 3 alternativas) para
// medir cuántas peticiones hace guardarPlan: lo que importa es el volumen,
// no el contenido.
export function planGrande(id: string, dias = 4, paradasPorDia = 6, alternativasPorParada = 3): Plan {
  const franjas = franjasComoArray("Londres");
  const diasPlan: Dia[] = Array.from({ length: dias }, (_, d) => ({
    fecha: `2027-03-${String(5 + d).padStart(2, "0")}`,
    franjas,
    paradas: Array.from({ length: paradasPorDia }, (_, p) => ({
      id: `p-${d}-${p}`,
      franja_id: franjas[p % franjas.length].id,
      nombre: `Sitio ${d}-${p}`,
      descripcion: `Descripción ${d}-${p}`,
      coordenadas: { lat: 51.5 + p * 0.001, lon: -0.12 + d * 0.001 },
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" as const },
      categoria: "monumento" as const,
      alternativas: Array.from({ length: alternativasPorParada }, (_, a): Alternativa => ({
        nombre: `Alternativa ${d}-${p}-${a}`,
        descripcion: "Otra opción",
        motivo: "mismo tipo, misma franja",
        duracion_min: 60,
        categoria: "monumento",
        origen: "modelo",
      })),
    })),
  }));
  return { id, version: 1, destino: "Londres", personas: 2, dias: diasPlan, avisos: [], recomendaciones: [] };
}
