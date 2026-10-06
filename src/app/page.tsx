import Link from "next/link";
import { TEXTOS_PORTADA as T } from "@/lib/textos/portada";

// guia-ac7(a): el enlace a la guía tiene que ser alcanzable desde aquí sin
// escribir ninguna dirección a mano y verse sin hacer scroll -por eso va
// justo debajo del único camino para empezar, no escondido más abajo.
export default function Home() {
  return (
    <main className="contenedor">
      <h1>{T.titulo.texto}</h1>
      <p>{T.presentacion.texto}</p>
      <p>
        <Link href="/criterios" className="boton boton-principal">
          {T.empezar.texto}
        </Link>
      </p>
      <p>
        <Link href="/viajes" className="enlace-discreto">
          {T.misViajes.texto}
        </Link>
      </p>
      <p>
        <Link href="/guia" className="enlace-discreto">
          {T.guia.texto}
        </Link>
      </p>
    </main>
  );
}
