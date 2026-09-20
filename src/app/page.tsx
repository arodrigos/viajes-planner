import Link from "next/link";

export default function Home() {
  return (
    <main className="contenedor">
      <h1>Viajes</h1>
      <p>Planificador de viajes turísticos, personal y familiar.</p>
      <p>
        <Link href="/criterios" className="boton boton-principal">
          Cuéntanos tu viaje
        </Link>
      </p>
    </main>
  );
}
