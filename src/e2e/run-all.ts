// run-all.ts — Corre todos los bloques y flujos de compras de forma resiliente.
// Uso: npx ts-node src/e2e/run-all.ts [--bloques] [--compras] [--flujo F1,F2,...]
// Por defecto corre todo (bloques 1-8 + compras F1-F26).
// Cada unidad se ejecuta en un proceso hijo para que un fallo no aborte las demás.

import { spawn } from 'child_process';
import * as path from 'path';

const args = process.argv.slice(2);
const soloBloques = args.includes('--bloques');
const soloCompras = args.includes('--compras');
const correrTodo = !soloBloques && !soloCompras;
const flujoArg = args.find((a) => a.startsWith('--flujo='));
const flujos = flujoArg ? flujoArg.split('=')[1].split(',') : null;

interface Unidad {
  nombre: string;
  cmd: string;
  args: string[];
}

const unidades: Unidad[] = [];

if (correrTodo || soloBloques) {
  for (let i = 1; i <= 8; i++) {
    unidades.push({ nombre: `Bloque ${i}`, cmd: 'npx', args: ['ts-node', `src/e2e/${['aprovisionamiento','consumibles','traslados','ajustes','mrp','canjes','contraste','ediciones'][i-1]}.spec.ts`] });
  }
}

if (correrTodo || soloCompras) {
  const comprasArgs = flujos ? flujos : ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','F13','F14','F15','F16','F17','F18','F19','F20','F21','F22','F23','F24','F25','F26'];
  // Run compras suite once with all flows (it's already resilient per-flow)
  unidades.push({ nombre: 'Compras (F1-F26)', cmd: 'npx', args: ['ts-node', 'src/e2e/compras/suite.ts', ...comprasArgs] });
}

async function runUnidad(u: Unidad): Promise<{ nombre: string; code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(u.cmd, u.args, { shell: true, cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d.toString(); process.stderr.write(d); });
    child.on('close', (code) => resolve({ nombre: u.nombre, code: code ?? 1, output }));
  });
}

async function main(): Promise<void> {
  console.log(`\n=== RUN-ALL: ${unidades.length} unidades ===\n`);
  const resultados: { nombre: string; code: number }[] = [];
  for (const u of unidades) {
    console.log(`\n========== ${u.nombre} ==========`);
    const r = await runUnidad(u);
    resultados.push({ nombre: r.nombre, code: r.code });
    console.log(`\n--- ${u.nombre}: exit code ${r.code} ${r.code === 0 ? 'OK' : 'FALLO'} ---`);
  }
  console.log('\n\n=== RESUMEN RUN-ALL ===');
  for (const r of resultados) {
    console.log(`${r.code === 0 ? '[OK]' : '[FALLO]'} ${r.nombre} (exit ${r.code})`);
  }
  const fallos = resultados.filter((r) => r.code !== 0).length;
  console.log(`\nTOTAL: ${resultados.length - fallos} OK, ${fallos} FALLO`);
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });