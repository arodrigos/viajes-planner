import { PantallaProgreso } from "./PantallaProgreso";

export default async function PaginaTrabajo({ params }: PageProps<"/trabajos/[id]">) {
  const { id } = await params;
  return (
    <main className="contenedor">
      <h1>Tu viaje se está generando</h1>
      <PantallaProgreso id={id} />
    </main>
  );
}
