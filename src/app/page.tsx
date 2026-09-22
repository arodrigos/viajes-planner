import Link from "next/link";

// guia-ac7(a): el enlace a la guía tiene que ser alcanzable desde aquí sin
// escribir ninguna dirección a mano y verse sin hacer scroll -por eso va
// justo debajo del único camino para empezar, no escondido más abajo.
export default function Home() {
  return (
    <main className="contenedor">
      <h1>Viajes</h1>
      <p>Le cuentas cómo quieres el viaje y un agente prepara un plan día a día para ti.</p>
      <p>
        <Link href="/criterios" className="boton boton-principal">
          Cuéntanos tu viaje
        </Link>
      </p>
      <p>
        <Link href="/viajes" className="enlace-discreto">
          Mis viajes
        </Link>
      </p>
      <p>
        <Link href="/guia" className="enlace-discreto">
          ¿Cómo funciona esta aplicación?
        </Link>
      </p>
    </main>
  );
}
