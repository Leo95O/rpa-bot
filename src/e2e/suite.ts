// suite.ts — Orquestador de la Matriz Masiva (35 casos).
// Una limpieza, un navegador, un estado y un reporte global.
// Ejecutar: npm run test:suite. Bloques 4-6 se agregan aquí al programarlos.

import * as path from 'path';
import { runBloque1 } from './aprovisionamiento.spec';
import { runBloque2 } from './consumibles.spec';
import { runBloque3 } from './traslados.spec';
import { runBloque4 } from './ajustes.spec';
import { runBloque5 } from './mrp.spec';
import { runBloque6 } from './canjes.spec';
import { abrirStandalone } from './harness';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { promises as fs } from 'fs';

async function main(): Promise<void> {
  const ctx = await abrirStandalone(true);
  console.log('\n== Suite Masiva: Bloque 1 (casos 1-9) ==');
  await runBloque1(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Suite Masiva: Bloque 2 (casos 10-12) ==');
  await runBloque2(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Suite Masiva: Bloque 3 (casos 13-18) ==');
  await runBloque3(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Suite Masiva: Bloque 4 (casos 19-20) ==');
  await runBloque4(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Suite Masiva: Bloque 5 (casos 21-28) ==');
  await runBloque5(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Suite Masiva: Bloque 6 (casos 29-35) ==');
  await runBloque6(ctx.page, ctx.estado, ctx.reporte);

  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Suite.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Suite.pdf'), resumen);
  console.log('\n== Suite Masiva ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
