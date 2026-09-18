import { describe, expect, it } from "vitest";
import { auditarHtml, contieneParametrosAfiliacion, contieneScriptPublicitario } from "@/lib/sin-afiliacion";

describe("contieneParametrosAfiliacion", () => {
  it("detecta los parámetros de afiliación conocidos", () => {
    expect(contieneParametrosAfiliacion("https://booking.com/hotel?aid=123")).toBe(true);
    expect(contieneParametrosAfiliacion("https://example.com?tag=abc-21")).toBe(true);
    expect(contieneParametrosAfiliacion("https://example.com/hotel?ref=xyz")).toBe(true);
  });

  it("no marca URLs normales", () => {
    expect(contieneParametrosAfiliacion("https://es.wikivoyage.org/wiki/Sevilla")).toBe(false);
  });
});

describe("contieneScriptPublicitario", () => {
  it("detecta dominios publicitarios conocidos", () => {
    expect(contieneScriptPublicitario('<script src="https://pagead2.googlesyndication.com/x.js">')).toBe(true);
  });

  it("no marca HTML limpio", () => {
    expect(contieneScriptPublicitario("<html><body>hola</body></html>")).toBe(false);
  });
});

describe("auditarHtml", () => {
  it("falla si hay una URL de afiliación en el HTML", () => {
    const html = '<a href="https://booking.com/hotel?aid=123">reservar</a>';
    const resultado = auditarHtml(html);
    expect(resultado.ok).toBe(false);
    expect(resultado.motivos.length).toBeGreaterThan(0);
  });

  it("pasa con HTML sin afiliación ni publicidad", () => {
    const html = '<a href="https://es.wikivoyage.org/wiki/Sevilla">Sevilla</a>';
    expect(auditarHtml(html)).toEqual({ ok: true, motivos: [] });
  });
});
