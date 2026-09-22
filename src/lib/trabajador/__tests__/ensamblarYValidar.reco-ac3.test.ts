import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { ensamblarYValidar } from "../procesarTrabajo";

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 5,
  personas: [{ edad: 8 }, { edad: 38 }, { edad: 36 }, { edad: 9 }],
  perfil: "familiar",
  presupuesto_eur: 2000,
};

// reco-ac3(a): es la restricción más importante de la tanda -tiene que
// poder fallar por la vía por la que esto se rompe de verdad, que es
// alguien decidiendo "ya que el modelo la sabe, la guardamos". Este test
// falla si ensamblarRecomendacion alguna vez copia el campo "url" en vez
// de descartarlo.
describe("ensamblarYValidar (reco-ac3(a))", () => {
  it("descarta el campo 'url' inventado por el modelo y el plan resultante no lo incluye", () => {
    const respuestaEnvenenada = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [
        {
          tipo: "comida",
          nombre: "Sitio Envenenado",
          motivo: "El modelo dice que merece la pena.",
          url: "https://malicioso.example/x",
        },
      ],
    });

    const resultado = ensamblarYValidar(CRITERIOS, "plan-reco-ac3", respuestaEnvenenada);

    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.recomendaciones).toEqual([
      { tipo: "comida", nombre: "Sitio Envenenado", motivo: "El modelo dice que merece la pena." },
    ]);
    expect(JSON.stringify(resultado.plan)).not.toContain("url");
    expect(JSON.stringify(resultado.plan)).not.toMatch(/https?:\/\//);
  });

  it("un dominio incrustado en el nombre viaja como texto, nunca desaparece, pero el plan sigue sin campo de URL", () => {
    const respuestaConDominioEnNombre = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [
        {
          tipo: "recinto",
          nombre: "Visita https://otro-malicioso.example ahora",
          motivo: "Recomendado por el modelo.",
        },
      ],
    });

    const resultado = ensamblarYValidar(CRITERIOS, "plan-reco-ac3b", respuestaConDominioEnNombre);

    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    // reco-ac3(b) se comprueba en el render (VistaPlan.reco-ac3.test.tsx):
    // aquí solo importa que ensamblarYValidar no añada un campo de URL
    // aparte -- el nombre en sí no es responsabilidad de este ensamblador.
    expect(resultado.plan.recomendaciones?.[0]).not.toHaveProperty("url");
  });
});
