// suite.ts — Orquestador unificado: Compras (F1-F13) + Bloques existentes (1-8).
// Una limpieza, seed de compras, flujos F1-F13, bloques 1-8, PDF único con secciones.
// Ejecutar: npm run test:suite.

import * as path from 'path';
import { promises as fs } from 'fs';
import { runBloque1 } from './aprovisionamiento.spec';
import { runBloque2 } from './consumibles.spec';
import { runBloque3 } from './traslados.spec';
import { runBloque4 } from './ajustes.spec';
import { runBloque5 } from './mrp.spec';
import { runBloque6 } from './canjes.spec';
import { runBloque7 } from './contraste.spec';
import { runBloque8 } from './ediciones.spec';
import { abrirStandalone } from './harness';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { FilaReporte } from '../types';
import { ejecutarFlujo } from './compras/suite';
import { leerIgvFiscalizado, leerTipoCambio, seedMaestros } from './compras/seed';

async function main(): Promise<void> {
  const ctx = await abrirStandalone(true);

  // Seed de compras (maestros + configs)
  console.log('\n== Seed Compras ==');
  const { execSync } = await import('child_process');
  const path = await import('path');
  const seedPath = path.resolve('data', 'seed_compras.sql');
  try {
    execSync(`C:\\xampp\\mysql\\bin\\mysql.exe -u root logisticaaa < "${seedPath}"`, { stdio: 'pipe' });
    console.log('  Seed ejecutado');
  } catch (e) {
    console.warn('  Warning: seed SQL falló, usando maestros existentes', e);
  }

  // Bloques 1-8 PRIMERO: son los que dan de alta los maestros que usan los
  // flujos de Compras ('Carne QA', 'Insumo Exonerado QA', 'Caja de Empaque QA').
  // La semilla ya no crea 'Carne QA' (lo crea el Bloque 1), así que los flujos
  // F1-F13 deben correr DESPUÉS y reusar ese maestro.
  console.log('\n== Módulo: Bloque 1 (Aprovisionamiento) ==');
  await runBloque1(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 2 (Consumibles) ==');
  await runBloque2(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 3 (Traslados) ==');
  await runBloque3(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 4 (Ajustes) ==');
  await runBloque4(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 5 (MRP) ==');
  await runBloque5(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 6 (Canjes) ==');
  await runBloque6(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 7 (Contraste) ==');
  await runBloque7(ctx.page, ctx.estado, ctx.reporte);
  console.log('\n== Módulo: Bloque 8 (Ediciones) ==');
  await runBloque8(ctx.page, ctx.estado, ctx.reporte);

  // Maestros definitivos: se releen DESPUÉS de los Bloques porque 'Carne QA'
  // nace con el id que le asigne el ERP en esta corrida.
  const maestros = await seedMaestros();
  console.log(`  ${maestros.size} maestros cargados`);

  // IGV y TC se leen EN VIVO de la BD (no se hardcodean): el divisor de
  // desgravación de los flujos depende del IGV fiscalizado del local.
  const igv = await leerIgvFiscalizado(1);
  const tipoCambio = await leerTipoCambio(1);
  console.log(`  IGV fiscalizado: ${igv}% | tipo de cambio: ${tipoCambio}`);

  // Contexto para flujos de compras
  const ctxCompras = {
    page: ctx.page,
    estado: {
      maestros,
      solicitudes: new Map(),
      ordenes: new Map(),
      compras: new Map(),
      guias: new Map(),
      nc: new Map(),
    },
    localId: 1,
    almacenId: 1,
    monedaId: 1,
    tipoCambio,
    proveedorId: 1,
    igv,
  };

  // Flujos de compras F1-F13
  console.log('\n== Módulo: Compras (F1-F13) ==');
  const flujosCompras = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13'];
  for (const fid of flujosCompras) {
    console.log(`\n--- Flujo ${fid} ---`);
    const r = await ejecutarFlujo(ctx.page, ctxCompras, ctxCompras.estado, fid);
    for (const v of r.veredictos) {
      const fila: FilaReporte = { fase: `Compras.${fid}`, paso: v.paso, ok: v.ok, pendiente: v.pendiente, esperado: v.esperado, real: v.real, error: v.error };
      ctx.reporte.push(fila);
      console.log(`${v.ok ? '[OK]' : '[FALLO]'} ${v.paso} | esperado=${v.esperado}${v.real ? ` | real=${v.real}` : ''}${v.error ? ` | ${v.error}` : ''}`);
    }
    console.log(`Resultado: ${r.exitosos} OK, ${r.fallidos} FALLO`);
  }

  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Suite.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Suite.pdf'), resumen);
  console.log('\n== Suite Masiva ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos +
    ' | Pendientes (no ejecutados): ' + resumen.pendientes + ' | Total: ' + resumen.total);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
