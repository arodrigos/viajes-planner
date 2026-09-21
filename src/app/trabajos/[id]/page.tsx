import { PantallaProgreso } from "./PantallaProgreso";

// final-ac3(c): el <h1> ya no vive aquí fijo -"Tu viaje se está generando"
// contradecía el cuerpo cuando el trabajo ya había terminado. PantallaProgreso
// es quien conoce el estado (llega por fetch en el cliente, page.tsx es un
// Server Component sin ese dato) y por eso es quien decide el título en
// cada rama, como primer hijo dentro de este mismo `.contenedor`.
export default async function PaginaTrabajo({ params }: PageProps<"/trabajos/[id]">) {
  const { id } = await params;
  return (
    <main className="contenedor">
      <PantallaProgreso id={id} />
    </main>
  );
}
