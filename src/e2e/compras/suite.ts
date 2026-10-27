// suite.ts — Runner del módulo Compras (SOLID: Dependency Inversion, abierto a N flujos)
import { Page, Browser } from 'playwright';
import { chromium } from 'playwright';
import * as path from 'path';
import { promises as fs } from 'fs';
import { ContextoCompra, EstadoSuite } from './tipos';
import { limpiarTransaccionales, seedMaestros, leerConfigs, leerIgvFiscalizado, leerTipoCambio } from './seed';
import { FLUJOS, FlujoFn } from './flujos';
import { Veredicto } from './oraculo';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../../reporte';
import { FilaReporte } from '../../types';

export interface SuiteResult {
  flujo: string;
  veredictos: Veredicto[];
  exitosos: number;
  fallidos: number;
}

export async function ejecutarFlujo(
  page: Page,
  ctx: ContextoCompra,
  estado: EstadoSuite,
  flujoId: string,
): Promise<SuiteResult> {
  const flujo = FLUJOS[flujoId];
  if (!flujo) throw new Error(`Flujo ${flujoId} no existe`);
  let veredictos: Veredicto[];
  try {
    veredictos = await flujo(page, ctx, estado);
  } catch (e) {
    // Una excepción en un flujo no debe abortar la suite: se reporta como un
    // veredicto fallido y la corrida sigue con el resto de flujos.
    veredictos = [{
      paso: flujoId + '.excepcion',
      ok: false,
      esperado: 'flujo sin excepciones',
      error: e instanceof Error ? e.message : String(e),
    }];
  }
  return {
    flujo: flujoId,
    veredictos,
    exitosos: veredictos.filter((v) => v.ok).length,
    fallidos: veredictos.filter((v) => !v.ok).length,
  };
}

export async function ejecutarSuite(
  page: Page,
  flujoIds: string[] = Object.keys(FLUJOS),
  maestros: Map<string, number> = new Map(),
): Promise<SuiteResult[]> {
  const estado: EstadoSuite = {
    maestros,
    solicitudes: new Map(),
    ordenes: new Map(),
    compras: new Map(),
    guias: new Map(),
    nc: new Map(),
  };

  const ctx: ContextoCompra = {
    page,
    estado,
    localId: 1,
    almacenId: 1,
    monedaId: 1,
    tipoCambio: 1,
    proveedorId: 1,
    igv: 18,
  };

  const resultados: SuiteResult[] = [];
  for (const id of flujoIds) {
    console.log(`\n=== Flujo ${id} ===`);
    const r = await ejecutarFlujo(page, ctx, estado, id);
    for (const v of r.veredictos) {
      console.log(`${v.ok ? '[OK]' : '[FALLO]'} ${v.paso} | esperado=${v.esperado}${v.real ? ` | real=${v.real}` : ''}${v.error ? ` | ${v.error}` : ''}`);
    }
    console.log(`Resultado: ${r.exitosos} OK, ${r.fallidos} FALLO`);
    resultados.push(r);
  }
  return resultados;
}

/**
 * Aplica la semilla de compras (idempotente): limpieza de transaccionales +
 * catálogos + maestros.
 * Necesaria porque `limpiarTransaccionales` borra también `insumo`/`producto`
 * (las tablas de maestros), con lo que el runner se quedaba sin maestros.
 */
function aplicarSeedCompras(): void {
  const { execSync } = require('child_process') as typeof import('child_process');
  const nodePath = require('path') as typeof import('path');
  const { resolverMysqlBin } = require('./seed') as { resolverMysqlBin: () => string };
  const seedPath = nodePath.resolve('data', 'seed_compras.sql');
  const mysqlBin = resolverMysqlBin();
  execSync(`"${mysqlBin}" -u root logisticaaa < "${seedPath}"`, { stdio: 'pipe', shell: true } as any);
}

/**
 * El maestro 'Carne QA' lo crea el Bloque 1 (la semilla ya no lo crea para no
 * duplicar el nombre). En el runner standalone de Compras no hay Bloques, así
 * que se crea aquí con el mismo control de stock (Central + Producción).
 */
async function asegurarMaestroCarne(page: Page, maestros: Map<string, number>): Promise<void> {
  if (maestros.has('Carne QA')) return;
  const { crearInsumo } = await import('../../bot');
  const r = await crearInsumo(page, {
    nombre: 'Carne QA',
    stockApertura: 0,
    costoApertura: 0,
    almacen: 'Almacen Principal',
    almacenes: ['18'],
  });
  if (!r.ok || r.id === undefined) {
    throw new Error('No se pudo crear el maestro "Carne QA": ' + (r.error || 'sin id'));
  }
  maestros.set('Carne QA', r.id);
  console.log('  Maestro "Carne QA" creado (id=' + r.id + ')');
}

async function main(): Promise<void> {
  console.log('=== Suite Compras E2E ===\n');

  console.log('Limpiando transaccionales...');
  await limpiarTransaccionales();

  console.log('Aplicando semilla de compras...');
  aplicarSeedCompras();

  console.log('Cargando maestros...');
  const maestros = await seedMaestros();
  console.log(`  ${maestros.size} maestros encontrados`);

  console.log('Leyendo configs...');
  const configs = await leerConfigs(1);
  console.log(`  ${configs.length} configuraciones`);

  const igv = await leerIgvFiscalizado(1);
  console.log(`  IGV: ${igv}%`);

  const tc = await leerTipoCambio(1);
  console.log(`  TC: ${tc}`);

  console.log('\nConectando navegador...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('No se encontró página del navegador');

  console.log('Asegurando maestro "Carne QA"...');
  await asegurarMaestroCarne(page, maestros);

  const flujos = process.argv.slice(2);
  const ids = flujos.length > 0 ? flujos : Object.keys(FLUJOS);
  console.log(`\nEjecutando flujos: ${ids.join(', ')}`);

  const estado: EstadoSuite = {
    maestros,
    solicitudes: new Map(),
    ordenes: new Map(),
    compras: new Map(),
    guias: new Map(),
    nc: new Map(),
  };
  const ctx: ContextoCompra = {
    page,
    estado,
    localId: 1,
    almacenId: 1,
    monedaId: 1,
    tipoCambio: tc,
    proveedorId: 1,
    igv,
  };

  const resultados: SuiteResult[] = [];
  let totalOk = 0;
  let totalFallo = 0;
  for (const id of ids) {
    console.log(`\n=== Flujo ${id} ===`);
    const r = await ejecutarFlujo(page, ctx, estado, id);
    for (const v of r.veredictos) {
      console.log(`${v.ok ? '[OK]' : '[FALLO]'} ${v.paso} | esperado=${v.esperado}${v.real ? ` | real=${v.real}` : ''}${v.error ? ` | ${v.error}` : ''}`);
    }
    console.log(`Resultado: ${r.exitosos} OK, ${r.fallidos} FALLO`);
    totalOk += r.exitosos;
    totalFallo += r.fallidos;
    resultados.push(r);
  }

  console.log('\n\n=== RESUMEN FINAL ===');
  for (const r of resultados) {
    console.log(`${r.flujo}: ${r.exitosos} OK, ${r.fallidos} FALLO`);
  }
  console.log(`\nTOTAL: ${totalOk} OK, ${totalFallo} FALLO`);

  // Generar reporte HTML + PDF
  const filas: FilaReporte[] = [];
  for (const r of resultados) {
    for (const v of r.veredictos) {
      filas.push({
        fase: r.flujo,
        paso: v.paso,
        ok: v.ok,
        pendiente: v.pendiente,
        esperado: v.esperado,
        real: v.real,
        error: v.error,
      });
    }
  }
  const resumen = resumirReporte(filas);
  const html = generarHtmlReporte(filas, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Compras.html'), html, 'utf8');
  await generarPdfReporte(filas, path.resolve('data', 'Reporte_Compras.pdf'), resumen);
  console.log('\nReporte generado: data/Reporte_Compras.html y data/Reporte_Compras.pdf');

  process.exit(totalFallo > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Error fatal:', e);
    process.exit(2);
  });
}
