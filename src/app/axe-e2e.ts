import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

// Solo serious y critical bloquean: minor y moderate son avisos que el
// gatekeeper ve en las capturas, no motivo para tumbar el CI.
// `excluir`: selectores ajenos a nuestro código (el interior del elemento de
// Google), que no podemos corregir.
export async function comprobarAccesibilidad(page: Page, excluir: string[] = []): Promise<void> {
  const constructor = new AxeBuilder({ page }).withTags(ETIQUETAS);
  for (const selector of excluir) constructor.exclude(selector);
  const { violations } = await constructor.analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (graves.length === 0) return;
  const resumen = graves.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} nodo(s), p. ej. ${v.nodes[0]?.target.join(" ")}`).join("\n");
  throw new Error(`Violaciones de accesibilidad serious o critical:\n${resumen}`);
}
