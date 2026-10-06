import { TEXTOS_VIAJES } from "@/lib/textos/viajes";
import { PanelViajes } from "./PanelViajes";

export default function PaginaViajes() {
  return (
    <main className="contenedor">
      <h1>{TEXTOS_VIAJES.titulo.texto}</h1>
      <PanelViajes />
    </main>
  );
}
