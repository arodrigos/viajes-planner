import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { claveMapa, clasificar, destinoSinConexion, esGuardable, esHostGoogle, idDeClavePlan, textoAviso } from "../reglas";

const ORIGEN = "https://viajes.example.org";
const UUID = fc.uuid();
// El navegador resuelve los segmentos «..» antes de que la petición llegue al
// SW: «/api/plan/<id>/../-» llega ya como «/api/plan/-», que sí es una clave
// válida. Generarlos haría que el test afirmase algo falso.
const RESTO_RUTA = fc.stringMatching(/^[a-z0-9/_.-]{0,30}$/).filter((r) => !r.split("/").some((s) => s === ".." || s === "."));
const SUBDOMINIOS = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), { maxLength: 3 }).map((p) => p.join("."));
const DOMINIOS_GOOGLE = ["googleapis.com", "gstatic.com", "google.com", "googleusercontent.com", "ggpht.com"];
const METODOS = fc.constantFrom("GET", "POST", "PUT", "DELETE", "HEAD");
const MODOS = fc.constantFrom("navigate", "cors", "no-cors", "same-origin");

describe("clasificar", () => {
  it("cualquier host de Google es «red», sea cual sea la ruta, el método o el modo", () => {
    fc.assert(
      fc.property(SUBDOMINIOS, fc.constantFrom(...DOMINIOS_GOOGLE), fc.stringMatching(/^[a-z0-9/_.-]{0,30}$/), METODOS, MODOS, (sub, dominio, ruta, metodo, modo) => {
        const host = sub ? `${sub}.${dominio}` : dominio;
        expect(clasificar({ url: `https://${host}/${ruta}`, metodo, modo }, ORIGEN)).toBe("red");
      }),
    );
  });

  it("cualquier /api/ del mismo origen que no sea /api/plan/<id> exacto, y cualquier método que no sea GET, es «red»", () => {
    fc.assert(
      fc.property(RESTO_RUTA, UUID, METODOS, (resto, id, metodo) => {
        expect(clasificar({ url: `${ORIGEN}/api/${resto}`, metodo: "GET", modo: "cors" }, ORIGEN)).not.toBe("foto");
        // Subrutas del plan: infografia.png, calendario.ics, paradas...
        expect(clasificar({ url: `${ORIGEN}/api/plan/${id}/${resto || "x"}`, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("red");
        if (metodo !== "GET") expect(clasificar({ url: `${ORIGEN}/api/plan/${id}`, metodo, modo: "cors" }, ORIGEN)).toBe("red");
      }),
    );
    for (const ruta of ["google/ficha", "viajes", "salud", "trabajos/1", "auth/x", "plan"]) {
      expect(clasificar({ url: `${ORIGEN}/api/${ruta}`, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("red");
    }
  });

  it("clasifica lo que sí intercepta", () => {
    const id = "12345678-1234-4234-8234-123456789abc";
    expect(clasificar({ url: `${ORIGEN}/api/plan/${id}`, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("api-plan");
    expect(clasificar({ url: `${ORIGEN}/api/plan/plan-fotos-1760000000`, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("api-plan");
    expect(clasificar({ url: `${ORIGEN}/plan/${id}?dia=2`, metodo: "GET", modo: "navigate" }, ORIGEN)).toBe("navegacion-plan");
    expect(clasificar({ url: `${ORIGEN}/viajes`, metodo: "GET", modo: "navigate" }, ORIGEN)).toBe("navegacion");
    expect(clasificar({ url: `${ORIGEN}/sin-conexion?plan=${id}`, metodo: "GET", modo: "navigate" }, ORIGEN)).toBe("navegacion-sin-conexion");
    expect(clasificar({ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg", metodo: "GET", modo: "cors" }, ORIGEN)).toBe("foto");
  });

  it("lo demás va a red: otro origen, peticiones internas de Next y documentos que no son navegación", () => {
    for (const url of ["https://tile.openfreemap.org/x", "https://nominatim.openstreetmap.org/search", "https://xyz.supabase.co/rest/v1/a", "http://upload.wikimedia.org/a.jpg", "https://evil.upload.wikimedia.org.example/a.jpg"]) {
      expect(clasificar({ url, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("red");
    }
    expect(clasificar({ url: `${ORIGEN}/_next/static/chunks/a.js`, metodo: "GET", modo: "no-cors" }, ORIGEN)).toBe("red");
    expect(clasificar({ url: `${ORIGEN}/viajes?_rsc=1`, metodo: "GET", modo: "cors" }, ORIGEN)).toBe("red");
    expect(clasificar({ url: "no es una url", metodo: "GET", modo: "navigate" }, ORIGEN)).toBe("red");
  });

  it("esHostGoogle no confunde dominios parecidos", () => {
    expect(esHostGoogle("maps.googleapis.com")).toBe(true);
    expect(esHostGoogle("fonts.gstatic.com")).toBe(true);
    expect(esHostGoogle("notgoogle.com")).toBe(false);
    expect(esHostGoogle("google.com.evil.example")).toBe(false);
  });
});

describe("esGuardable", () => {
  it("es true solo con 200, sin redirección, JSON y cabecera de lectura; false con cualquier otra combinación", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(200, 201, 204, 301, 401, 404, 500),
        fc.boolean(),
        fc.constantFrom("application/json", "application/json; charset=utf-8", "text/html", "text/html; charset=utf-8", null),
        fc.constantFrom("2026-10-18T10:00:00.000Z", "", null),
        (status, redirected, contentType, leidoEn) => {
          const esperado = status === 200 && !redirected && (contentType?.startsWith("application/json") ?? false) && Boolean(leidoEn);
          expect(esGuardable({ status, redirected, contentType, leidoEn })).toBe(esperado);
        },
      ),
    );
  });
});

describe("destinoSinConexion", () => {
  it("conserva el id y el día, y nunca produce otro origen", () => {
    fc.assert(
      fc.property(UUID, fc.oneof(fc.integer({ min: 1, max: 99 }).map(String), fc.constant("resumen")), fc.webUrl(), (id, dia, otra) => {
        const destino = destinoSinConexion(`${ORIGEN}/plan/${id}?dia=${dia}&x=1`, ORIGEN);
        const url = new URL(destino, ORIGEN);
        expect(url.origin).toBe(ORIGEN);
        expect(url.pathname).toBe("/sin-conexion");
        expect(url.searchParams.get("plan")).toBe(id);
        expect(url.searchParams.get("dia")).toBe(dia);
        expect(new URL(destinoSinConexion(otra, ORIGEN), ORIGEN).origin).toBe(ORIGEN);
      }),
    );
  });

  it("un día que no es un día se descarta y una URL sin plan cae en la lista", () => {
    const id = "12345678-1234-4234-8234-123456789abc";
    expect(destinoSinConexion(`${ORIGEN}/plan/${id}?dia=<script>`, ORIGEN)).toBe(`/sin-conexion?plan=${id}`);
    expect(destinoSinConexion(`${ORIGEN}/viajes`, ORIGEN)).toBe("/sin-conexion");
  });
});

describe("textoAviso", () => {
  it("siempre lleva el día y la hora de la copia y nunca «offline»", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2020-01-01"), max: new Date("2040-01-01"), noInvalidDate: true }), (fecha) => {
        const texto = textoAviso(fecha);
        expect(texto).not.toMatch(/offline/i);
        expect(texto).toMatch(/^Sin conexión · Estás viendo la copia guardada el .+ a las \d{2}:\d{2}\./);
        expect(texto).toContain(String(fecha.getDate()));
      }),
    );
  });
});

describe("idDeClavePlan", () => {
  it("solo acepta claves /api/plan/<id> exactas", () => {
    const id = "12345678-1234-4234-8234-123456789abc";
    fc.assert(
      fc.property(RESTO_RUTA.filter((r) => r.length > 0), (resto) => {
        expect(idDeClavePlan(`${ORIGEN}/api/plan/${id}/${resto}`)).toBeNull();
        expect(idDeClavePlan(`${ORIGEN}/plan/${id}`)).toBeNull();
      }),
    );
    expect(idDeClavePlan(`${ORIGEN}/api/plan/${id}`)).toBe(id);
    expect(idDeClavePlan("basura")).toBeNull();
  });
});

describe("clase «mapa» y claveMapa (p4m-ac6)", () => {
  const T = "https://tiles.openfreemap.org";
  it("tabla: OpenFreeMap es «mapa»; Google, la API, las páginas y el POST siguen como antes", () => {
    const get = (url: string, modo = "cors") => clasificar({ url, metodo: "GET", modo }, ORIGEN);
    for (const u of [`${T}/styles/liberty`, `${T}/planet`, `${T}/planet/2026/10/5/6.pbf`, `${T}/fonts/Noto%20Sans/0-255.pbf`, `${T}/sprites/ofm_f384/ofm.png`]) {
      expect(get(u)).toBe("mapa");
    }
    expect(get("https://maps.googleapis.com/maps/api/js")).toBe("red");
    expect(get(`${ORIGEN}/api/plan/x`)).toBe("api-plan");
    expect(get(`${ORIGEN}/plan/x`, "navigate")).toBe("navegacion-plan");
    expect(clasificar({ url: `${T}/planet`, metodo: "POST", modo: "cors" }, ORIGEN)).toBe("red");
    expect(get("http://tiles.openfreemap.org/planet")).toBe("red");
    expect(get("https://tiles.openfreemap.org.evil.example/planet")).toBe("red");
  });

  it("«mapa» solo para GET a https del host exacto; Google nunca deja de ser «red»", () => {
    fc.assert(
      fc.property(METODOS, MODOS, fc.stringMatching(/^[a-z0-9/_.-]{0,30}$/), (metodo, modo, ruta) => {
        const c = clasificar({ url: `https://tiles.openfreemap.org/${ruta}`, metodo, modo }, ORIGEN);
        expect(c === "mapa").toBe(metodo === "GET");
        expect(clasificar({ url: `https://tiles.openfreemap.org.googleapis.com/${ruta}`, metodo, modo }, ORIGEN)).toBe("red");
      }),
    );
  });

  it("claveMapa es idempotente y no distingue la versión de la tesela", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-z_]{1,16}$/), fc.stringMatching(/^[0-9a-z_]{1,16}$/), fc.nat(14), fc.nat(5000), fc.nat(5000), (v1, v2, z, x, y) => {
        const a = `${T}/planet/${v1}/${z}/${x}/${y}.pbf`;
        const b = `${T}/planet/${v2}/${z}/${x}/${y}.pbf`;
        expect(claveMapa(a)).toBe(claveMapa(b));
        expect(claveMapa(claveMapa(a))).toBe(claveMapa(a));
      }),
    );
    expect(claveMapa(`${T}/styles/liberty`)).toBe(`${T}/styles/liberty`);
    expect(claveMapa(`${T}/fonts/A%2CB/0-255.pbf`)).toBe(claveMapa(`${T}/fonts/A,B/0-255.pbf`));
  });
});
