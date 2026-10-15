// contraste.spec.ts — Bloque 7 de la Matriz (casos 36+): Contraste Matemático.
// Toggles de display 72/106 desde el baseline, solo LECTURAS (no mueve stock).
// Restauración garantizada con try...finally (punto 4 del requerimiento).
// Ejecutar: npm run test:bloque7. PRECONDICIÓN ligera: existen Carne QA,
// Insumo Exonerado QA y Caja de Empaque QA (cierra del Bloque 6).

import * as path from 'path';
import { Page } from 'playwright';
import { navegar, cerrarModales } from '../bot';
import { buscarInsumo } from '../kardex';
import { FilaReporte } from '../types';
import { QA, QA_CONSUMIBLE, QA_EXONERADO, QA_TRASLADO, EstadoSuite, getBaseline, setConfig } from './fixtures';
import { leerKardex, leerUltimoCostoEntrada, resolverIdsSQL } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone } from './harness';
import { promises as fs } from 'fs';

const F = 'Bloque 7: Contraste';
const TOL = 0.02;

async function restaurar(base: { c72: number; c106: number }): Promise<void> {
  await setConfig(72, base.c72 === 1 ? 1 : 0);
  await setConfig(106, base.c106 === 1 ? 1 : 0);
  console.log('[DIAG Contraste] flags restaurados a baseline c72=' + base.c72 + ' c106=' + base.c106);
}

/** Casos 36+. */
export async function runBloque7(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  void estado;
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);

  // Precondición ligera: existencia (no stocks, el contraste es relativo).
  try {
    const a = await buscarInsumo(page, QA.insumoCarne);
    const b = await buscarInsumo(page, QA_EXONERADO.nombre);
    const c = await buscarInsumo(page, QA_CONSUMIBLE.nombre);
    const ok = a !== null && b !== null && c !== null;
    log({ fase: F, paso: 'precondición existencia (Carne/Exonerado/Consumible)', ok, error: ok ? undefined : 'Faltan maestros.' });
    if (!ok) return;
    estado.insumoId = a!.id;
  } catch (e) {
    log({ fase: F, paso: 'precondición existencia', ok: false, error: String(e) });
    return;
  }

  const base = getBaseline();
  log({ fase: F, paso: '36. baseline c72=' + base.c72 + ' c106=' + base.c106, ok: true, real: 'c72=' + base.c72 + '; c106=' + base.c106 });

  try {
    // 37. Toggle 72=1: el campo `costo` debe reflejar el valor sin impuestos.
    await setConfig(72, 1);
    console.log('[DIAG Contraste] c72=1 aplicado');
    const carne = await leerKardex(page, QA.insumoCarne, QA_TRASLADO.almacenCentral);
    const okCarne = carne !== null && Math.abs(carne.costo - carne.costoSinImp) < TOL;
    log({
      fase: F, paso: '37. c72=1: costo==sin-imp (Carne)', ok: okCarne,
      esperado: 'costo == costo_sin_imp',
      real: carne ? 'costo=' + carne.costo + '; costo_sin_imp=' + carne.costoSinImp : undefined,
      error: okCarne ? undefined : 'El display no refleja sin-impuestos.',
    });
    const exo = await leerKardex(page, QA_EXONERADO.nombre, QA_TRASLADO.almacenCentral);
    const okExo = exo !== null && Math.abs(exo.costo - exo.costoSinImp) < TOL && Math.abs(exo.costo - 10) < TOL;
    log({
      fase: F, paso: '37. c72=1: exonerado idéntico (10/10)', ok: okExo,
      esperado: 'costo=10; costo_sin_imp=10',
      real: exo ? 'costo=' + exo.costo + '; costo_sin_imp=' + exo.costoSinImp : undefined,
      error: okExo ? undefined : 'Divergencia en exonerado.',
    });
    // El display (config 72) vive en el endpoint Kardex, no en la tabla espejo:
    // hay que leer por obtenerStockYCosto, igual que un insumo normal.
    const ce = await leerKardex(page, QA_CONSUMIBLE.nombre, QA_TRASLADO.almacenCentral);
    const okCons = ce !== null && Math.abs(ce.costo - ce.costoSinImp) < TOL;
    log({
      fase: F, paso: '37. c72=1: costo==sin-imp (Consumible)', ok: okCons,
      esperado: 'costo == costo_sin_imp',
      real: ce ? 'costo=' + ce.costo + '; costo_sin_imp=' + ce.costoSinImp : undefined,
      error: okCons ? undefined : 'El display no refleja sin-impuestos.',
    });

    // 38. Toggle 106=1 (72 restaurado primero): `costo` = última compra.
    await setConfig(72, base.c72 === 1 ? 1 : 0);
    await setConfig(106, 1);
    console.log('[DIAG Contraste] c106=1 aplicado (c72 restaurado)');
    const carne2 = await leerKardex(page, QA.insumoCarne, QA_TRASLADO.almacenCentral);
    const ids = await resolverIdsSQL(QA.insumoCarne, QA_TRASLADO.almacenCentral);
    const ultimo = ids ? await leerUltimoCostoEntrada(ids.insumoId, ids.almacenId, false) : null;
    const okUlt = carne2 !== null && ultimo !== null && Math.abs(carne2.costo - ultimo) < TOL;
    log({
      fase: F, paso: '38. c106=1: costo==última-compra (Carne)', ok: okUlt,
      esperado: ultimo !== null ? 'costo=ultima(' + ultimo + ')' : 'última compra legible',
      real: carne2 ? 'costo=' + carne2.costo : undefined,
      error: okUlt ? undefined : 'El display no refleja última compra.',
    });
    // El sin-imp sigue exponiéndose en paralelo aunque el display cambie.
    const okSin = carne2 !== null && carne2.costoSinImp > 0;
    log({
      fase: F, paso: '38. c106=1: sin-imp sigue expuesto', ok: okSin,
      esperado: 'costo_sin_imp>0',
      real: carne2 ? 'costo_sin_imp=' + carne2.costoSinImp : undefined,
      error: okSin ? undefined : 'Sin-imp no expuesto.',
    });
  } finally {
    await restaurar(base);
    log({ fase: F, paso: '39. flags restaurados a baseline', ok: true, real: 'c72=' + base.c72 + '; c106=' + base.c106 });
  }

  // Verificación post-restore: el display vuelve al baseline.
  try {
    const carne3 = await leerKardex(page, QA.insumoCarne, QA_TRASLADO.almacenCentral);
    val({
      paso: 'validarStock("Carne QA" @ Central) post-restore',
      ok: carne3 !== null,
      esperado: 'lectura OK',
      real: carne3 ? 'stock=' + carne3.stock + '; costo=' + carne3.costo + '; costo_sin_imp=' + carne3.costoSinImp : undefined,
      error: carne3 ? undefined : 'Sin lectura.',
    });
  } catch (e) { log({ fase: F, paso: 'post-restore', ok: false, error: String(e) }); }
}

/** Entrada standalone: npm run test:bloque7. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque7(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque7.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque7.pdf'), resumen);
  console.log('\n== Bloque 7 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
