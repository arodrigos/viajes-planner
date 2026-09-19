import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "1rem", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>Viajes</h1>
      <p>Planificador de viajes turísticos, personal y familiar.</p>
      <p>
        <Link href="/criterios">Cuéntanos tu viaje</Link>
      </p>
    </main>
  );
}
