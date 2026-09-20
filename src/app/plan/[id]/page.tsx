import { VistaPlan } from "./VistaPlan";

export default async function PaginaPlan({ params }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  return (
    <main className="contenedor">
      <h1>Tu plan de viaje</h1>
      <VistaPlan id={id} />
    </main>
  );
}
