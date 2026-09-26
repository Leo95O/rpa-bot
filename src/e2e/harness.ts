// harness.ts — Arneses compartidos de la suite masiva.
// Cada spec expone `runBloqueN(page, estado, reporte)` (sin browser ni limpieza).
// - Standalone: `npm run test:bloqueN` (limpia + navegador + reporte propios).
// - Suite: `npm run test:suite` (una limpieza, un navegador, un reporte global).

import { Browser, Page } from 'playwright';
import { conectarNavegador, obtenerPaginaApp, navegar } from '../bot';
import { limpiarBaseDatos } from '../db';
import { FilaReporte } from '../types';
import { EstadoSuite, cargarIgvFiscalizado } from './fixtures';
import { Veredicto } from './oracle';

export interface ContextoSuite {
  browser: Browser;
  page: Page;
  estado: EstadoSuite;
  reporte: FilaReporte[];
}

/** Diagnóstico opt-in: solo imprime con DEBUG=1. Lo verde no debe pagar I/O. */
export const DEBUG = process.env.DEBUG === '1';

export function diag(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

export function logFila(reporte: FilaReporte[], f: FilaReporte): void {
  reporte.push(f);
  console.log((f.ok ? '[OK]' : '[FALLO]') + ' [' + f.fase + '] ' + f.paso +
    (f.esperado ? ' | esperado=' + f.esperado : '') +
    (f.real ? ' | real=' + f.real : '') +
    (f.error ? ' | ' + f.error : ''));
}

export function logVeredicto(reporte: FilaReporte[], fase: string, v: Veredicto): void {
  logFila(reporte, { fase, paso: v.paso, ok: v.ok, esperado: v.esperado, real: v.real, error: v.error });
}

/** Apertura standalone de un bloque (limpieza + navegador + estado vacío). */
export async function abrirStandalone(limpiar: boolean): Promise<ContextoSuite> {
  if (limpiar) {
    console.log('\nLimpiando base de datos...');
    await limpiarBaseDatos();
  }
  const igv = await cargarIgvFiscalizado();
  console.log('IGV fiscalizado (divisor desgravación): ' + igv);
  const browser = await conectarNavegador();
  const page = await obtenerPaginaApp(browser);
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  return { browser, page, estado: {}, reporte: [] };
}
