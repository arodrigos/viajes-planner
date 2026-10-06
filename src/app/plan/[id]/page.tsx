import { Suspense } from "react";
import { VistaPlan } from "./VistaPlan";

export default async function PaginaPlan({ params }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  return (
    <main className="contenedor">
      {/* useSearchParams exige un límite de Suspense para no impedir el prerenderizado. */}
      <Suspense fallback={<h1>Tu plan de viaje</h1>}>
        <VistaPlan id={id} />
      </Suspense>
    </main>
  );
}
