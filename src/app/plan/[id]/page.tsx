import { VistaPlan } from "./VistaPlan";

export default async function PaginaPlan({ params }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  return (
    <main style={{ padding: "1rem", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>Tu plan de viaje</h1>
      <VistaPlan id={id} />
    </main>
  );
}
