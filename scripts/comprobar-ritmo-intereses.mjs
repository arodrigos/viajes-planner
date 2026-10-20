// Lee por stdin la salida de generar-plan-real.ts (--resolver) y comprueba de
// forma determinista el ritmo y los intereses. No mira qué sitios salen.
import { readFileSync } from "node:fs";

const MARCADOS = new Set(["museos", "parques-ninos"]);
const fallos = [];

// Si el generador murió antes de imprimir nada (sin `claude`, sin
// --conditions=react-server), un JSON.parse sobre vacío escondía la causa.
const entrada = readFileSync(0, "utf-8");
if (entrada.trim() === "") {
  console.error("FALLO: el generador no imprimió nada; mira su stderr (¿tsx --conditions=react-server? ¿claude en el PATH?)");
  process.exit(1);
}
const { plan } = JSON.parse(entrada);
if (!plan) {
  console.error("FALLO: la salida no trae plan");
  process.exit(1);
}

if (plan.dias.length !== 3) fallos.push(`dias.length = ${plan.dias.length}, esperado 3`);

let conInteres = 0;
plan.dias.forEach((dia, i) => {
  const porFranja = new Map();
  for (const parada of dia.paradas) {
    porFranja.set(parada.franja_id, (porFranja.get(parada.franja_id) ?? 0) + 1);
    if (!parada.nombre || parada.nombre.trim() === "") fallos.push(`día ${i + 1}: parada sin nombre`);
    if (parada.interes !== undefined) {
      if (MARCADOS.has(parada.interes)) conInteres += 1;
      else fallos.push(`día ${i + 1}: «${parada.nombre}» con interés no marcado (${parada.interes})`);
    }
  }
  for (const [franja, n] of porFranja) {
    if (n > 1) fallos.push(`día ${i + 1}, franja ${franja}: ${n} paradas (tope 1)`);
  }
});
if (conInteres < 2) fallos.push(`solo ${conInteres} paradas con interés marcado, esperado al menos 2`);

if (fallos.length > 0) {
  for (const f of fallos) console.error(`FALLO: ${f}`);
  process.exit(1);
}
console.log(`OK: ritmo tranquilo (≤1 parada por franja) y ${conInteres} paradas con interés marcado`);
