import * as path from 'path';
import * as ExcelJS from 'exceljs';
import {
  conectarNavegador,
  obtenerPaginaApp,
  crearInsumo,
  consultarInsumo,
  agregarPresentacion,
  navegar,
} from '../bot';
import {
  registrarCompra,
  consultarCompra,
  modificarCompra,
  anularCompra,
  registrarNotaCredito,
} from '../compras';
import { registrarGuia, consultarGuia, modificarGuia, anularGuia } from '../guias';
import { obtenerEstadoGlobal, validarStock } from '../kardex';
import { limpiarBaseDatos } from '../db';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { promises as fs } from 'fs';
import { FilaReporte } from '../types';

interface Estado {
  insumoA?: number;
  insumoB?: number;
  compra1?: number;
  compra2?: number;
  guia?: number;
}

const reporte: FilaReporte[] = [];

function log(fila: FilaReporte): void {
  reporte.push(fila);
  const marca = fila.ok ? '[OK]' : '[FALLO]';
  console.log(
    marca + ' [' + fila.fase + '] ' + fila.paso +
      (fila.esperado ? ' | esperado=' + fila.esperado : '') +
      (fila.real ? ' | real=' + fila.real : '') +
      (fila.error ? ' | ' + fila.error : ''),
  );
}

function logOperacion(fase: string, paso: string, r: { ok: boolean; id?: number; error?: string }): boolean {
  log({
    fase,
    paso,
    ok: r.ok,
    error: r.error,
    real: r.id !== undefined ? 'id=' + r.id : undefined,
  });
  return r.ok;
}

function logValidacion(fase: string, r: {
  paso: string;
  ok: boolean;
  esperado: { cantidad: number; costo: number };
  real: { stock: number; costo: number } | null;
  error?: string;
}): void {
  log({
    fase,
    paso: r.paso,
    ok: r.ok,
    esperado: 'stock=' + r.esperado.cantidad + '; costo=' + r.esperado.costo,
    real: r.real ? 'stock=' + r.real.stock + '; costo=' + r.real.costo : undefined,
    error: r.error,
  });
}

async function main(): Promise<void> {
  console.log('\nLimpiando base de datos...');
  await limpiarBaseDatos();

  const browser = await conectarNavegador();
  const page = await obtenerPaginaApp(browser);
  console.log('Conectado a: ' + page.url());

  // Iniciar siempre en el escritorio, con el DOM limpio, antes de la Fase 1.
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(1500);
  console.log('Navegado a escritorio.');

  const estado: Estado = {};

  // =====================================================================
  // FASE 1: Insumos
  // =====================================================================
  const F1 = 'Fase 1: Insumos';
  try {
    const g = await obtenerEstadoGlobal(page);
    log({ fase: F1, paso: 'kardex.obtenerEstadoGlobal()', ok: true, real: JSON.stringify(g) });
  } catch (e) {
    log({ fase: F1, paso: 'kardex.obtenerEstadoGlobal()', ok: false, error: String(e) });
  }

  // test A
  try {
    const r = await crearInsumo(page, {
      nombre: 'test A',
      stockApertura: 10,
      costoApertura: 2,
      almacen: 'Almacen Principal',
    });
    if (logOperacion(F1, "bot.crearInsumo('test A') 10u @ 2", r)) estado.insumoA = r.id;
  } catch (e) {
    log({ fase: F1, paso: "bot.crearInsumo('test A')", ok: false, error: String(e) });
  }

  try {
    const id = await consultarInsumo(page, 'test A');
    estado.insumoA = estado.insumoA ?? (id ?? undefined);
    log({ fase: F1, paso: "bot.consultarInsumo('test A')", ok: id != null, real: 'id=' + id });
  } catch (e) {
    log({ fase: F1, paso: "bot.consultarInsumo('test A')", ok: false, error: String(e) });
  }

  try {
    logValidacion(F1, await validarStock(page, 'test A', 10, 2));
  } catch (e) {
    log({ fase: F1, paso: "kardex.validarStock('test A')", ok: false, error: String(e) });
  }

  // test B
  try {
    const r = await crearInsumo(page, {
      nombre: 'test B',
      stockApertura: 20,
      costoApertura: 0.83,
      mermaCompra: 50,
      equivalencia: { cantidad: 300, unidadMedida: 'GRAMOS' },
      almacen: 'Almacen Principal',
    });
    if (logOperacion(F1, "bot.crearInsumo('test B') 20u @ 0.83 merma50%", r)) estado.insumoB = r.id;
  } catch (e) {
    log({ fase: F1, paso: "bot.crearInsumo('test B')", ok: false, error: String(e) });
  }

  try {
    const id = await consultarInsumo(page, 'test B');
    estado.insumoB = estado.insumoB ?? (id ?? undefined);
    log({ fase: F1, paso: "bot.consultarInsumo('test B')", ok: id != null, real: 'id=' + id });
  } catch (e) {
    log({ fase: F1, paso: "bot.consultarInsumo('test B')", ok: false, error: String(e) });
  }

  try {
    logValidacion(F1, await validarStock(page, 'test B', 20, 0.83));
  } catch (e) {
    log({ fase: F1, paso: "kardex.validarStock('test B')", ok: false, error: String(e) });
  }

  try {
    const r = await agregarPresentacion(page, 'test B', 'Caja de 24', 24, 20);
    logOperacion(F1, "bot.agregarPresentacion('test B', 'Caja de 24', 24, 20)", r);
  } catch (e) {
    log({ fase: F1, paso: "bot.agregarPresentacion('test B')", ok: false, error: String(e) });
  }

  // =====================================================================
  // FASE 2: Compras
  // =====================================================================
  const F2 = 'Fase 2: Compras';
  try {
    const g = await obtenerEstadoGlobal(page);
    log({ fase: F2, paso: 'kardex.obtenerEstadoGlobal()', ok: true, real: JSON.stringify(g) });
  } catch (e) {
    log({ fase: F2, paso: 'kardex.obtenerEstadoGlobal()', ok: false, error: String(e) });
  }

  try {
    const r = await registrarCompra(page, {
      serie: 'F001',
      numero: 'E2E-1',
      detalle: [
        { nombre: 'test A', insumoId: estado.insumoA, cantidad: 10, precio: 3 },
        { nombre: 'test B', insumoId: estado.insumoB, cantidad: 2, precio: 22, presentacion: 'Caja de 24' },
      ],
    });
    if (logOperacion(F2, 'compras.registrarCompra(1) A(10u@3) B(2cajas@22) total=74', r)) estado.compra1 = r.id;
  } catch (e) {
    log({ fase: F2, paso: 'compras.registrarCompra(1)', ok: false, error: String(e) });
  }

  try {
    const r = await consultarCompra(page, estado.compra1!);
    log({ fase: F2, paso: 'compras.consultarCompra(1)', ok: r.ok, real: r.ok ? 'compra=' + estado.compra1 : undefined, error: r.error });
  } catch (e) {
    log({ fase: F2, paso: 'compras.consultarCompra(1)', ok: false, error: String(e) });
  }

  // A: 10@2 + 10@3 -> stock 20, costo 2.5
  // B: 20@0.83 + 2 cajas (24u con merma 50%, total 44) -> stock 44, costo (16.6+44)/44=1.377
  try { logValidacion(F2, await validarStock(page, 'test A', 20, 2.5)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }
  try { logValidacion(F2, await validarStock(page, 'test B', 44, 1.377)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test B')", ok: false, error: String(e) }); }

  try {
    const r = await modificarCompra(page, estado.compra1!, [
      { nombre: 'test A', insumoId: estado.insumoA, cantidad: 5, precio: 3.5 },
      { nombre: 'test B', insumoId: estado.insumoB, cantidad: 3, precio: 24, presentacion: 'Caja de 24' },
    ]);
    logOperacion(F2, 'compras.modificarCompra(1) A(5u@3.5) B(3cajas@24) total=89.5', r);
  } catch (e) {
    log({ fase: F2, paso: 'compras.modificarCompra(1)', ok: false, error: String(e) });
  }

  // A: 10@2 + 5@3.5 -> stock 15, costo 2.5
  // B: 20@0.83 + 3 cajas (36u con merma 50%, total 72) -> stock 56, costo (16.6+72)/56=1.582
  try { logValidacion(F2, await validarStock(page, 'test A', 15, 2.5)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }
  try { logValidacion(F2, await validarStock(page, 'test B', 56, 1.582)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test B')", ok: false, error: String(e) }); }

  try {
    const r = await registrarCompra(page, {
      serie: 'F001',
      numero: 'E2E-2',
      detalle: [
        { nombre: 'test A', insumoId: estado.insumoA, cantidad: 10, precio: 2.75 },
        { nombre: 'test B', insumoId: estado.insumoB, cantidad: 1, precio: 24, presentacion: 'Caja de 24' },
      ],
    });
    if (logOperacion(F2, 'compras.registrarCompra(2) A(10u@2.75) B(1caja@24) total=51.5', r)) estado.compra2 = r.id;
  } catch (e) {
    log({ fase: F2, paso: 'compras.registrarCompra(2)', ok: false, error: String(e) });
  }

  try {
    const r = await consultarCompra(page, estado.compra2!);
    log({ fase: F2, paso: 'compras.consultarCompra(2)', ok: r.ok, real: r.ok ? 'compra=' + estado.compra2 : undefined, error: r.error });
  } catch (e) {
    log({ fase: F2, paso: 'compras.consultarCompra(2)', ok: false, error: String(e) });
  }

  // A: 10@2 + 5@3.5 + 10@2.75 -> stock 25, costo 2.6
  // B: 56 + 1 caja (12u, total 24) -> stock 68, costo (88.6+24)/68=1.656
  try { logValidacion(F2, await validarStock(page, 'test A', 25, 2.6)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }
  try { logValidacion(F2, await validarStock(page, 'test B', 68, 1.656)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test B')", ok: false, error: String(e) }); }

  try {
    const r = await anularCompra(page, estado.compra1!, true);
    logOperacion(F2, 'compras.anularCompra(1) devolverStock', r);
  } catch (e) {
    log({ fase: F2, paso: 'compras.anularCompra(1)', ok: false, error: String(e) });
  }

  // A tras anular compra1: 10@2 + 10@2.75 -> stock 20, costo 2.375
  // B tras anular compra1: 68 - 36u -> stock 32, costo (112.6-72)/32=1.269
  try { logValidacion(F2, await validarStock(page, 'test A', 20, 2.375)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }
  try { logValidacion(F2, await validarStock(page, 'test B', 32, 1.269)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test B')", ok: false, error: String(e) }); }

  try {
    const r = await registrarNotaCredito(page, estado.compra2!, [{ nombre: 'test A', insumoId: estado.insumoA, cantidad: 2 }]);
    logOperacion(F2, "compras.registrarNotaCredito(2) devolver 2u de A", r);
  } catch (e) {
    log({ fase: F2, paso: 'compras.registrarNotaCredito(2)', ok: false, error: String(e) });
  }

  // A tras nota credito: stock 18, costo sin cambio 2.375
  try { logValidacion(F2, await validarStock(page, 'test A', 18, 2.375)); } catch (e) { log({ fase: F2, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }

  // =====================================================================
  // FASE 3: Guías de Ingreso
  // =====================================================================
  const F3 = 'Fase 3: Guías';
  try {
    const g = await obtenerEstadoGlobal(page);
    log({ fase: F3, paso: 'kardex.obtenerEstadoGlobal()', ok: true, real: JSON.stringify(g) });
  } catch (e) {
    log({ fase: F3, paso: 'kardex.obtenerEstadoGlobal()', ok: false, error: String(e) });
  }

  try {
    const r = await registrarGuia(page, {
      serie: 'G001',
      numero: 'E2E-G1',
      vehiculo: 'ABC666',
      partida: 'A',
      llegada: 'B',
      detalle: [{ nombre: 'test A', insumoId: estado.insumoA, cantidad: 5, precio: 2.75 }],
    });
    if (logOperacion(F3, 'guias.registrarGuia() A(5u@2.75)', r)) estado.guia = r.id;
  } catch (e) {
    log({ fase: F3, paso: 'guias.registrarGuia()', ok: false, error: String(e) });
  }

  try {
    const r = await consultarGuia(page, estado.guia!);
    log({ fase: F3, paso: 'guias.consultarGuia()', ok: r.ok, real: r.ok ? 'guia=' + estado.guia : undefined, error: r.error });
  } catch (e) {
    log({ fase: F3, paso: 'guias.consultarGuia()', ok: false, error: String(e) });
  }

  // A tras guia: 18 + 5 -> stock 23, costo (42.75+13.75)/23=2.457 (promedio ponderado; anular no revierte costo)
  try { logValidacion(F3, await validarStock(page, 'test A', 23, 2.457)); } catch (e) { log({ fase: F3, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }

  try {
    const r = await modificarGuia(page, estado.guia!, [{ nombre: 'test A', insumoId: estado.insumoA, cantidad: 10, precio: 2.75 }]);
    logOperacion(F3, 'guias.modificarGuia() A(10u@2.75)', r);
  } catch (e) {
    log({ fase: F3, paso: 'guias.modificarGuia()', ok: false, error: String(e) });
  }

  // A tras modificar guia: 18 + 10 -> stock 28, costo (42.75+27.5)/28=2.509
  try { logValidacion(F3, await validarStock(page, 'test A', 28, 2.509)); } catch (e) { log({ fase: F3, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }

  try {
    const r = await anularGuia(page, estado.guia!, true);
    logOperacion(F3, 'guias.anularGuia()', r);
  } catch (e) {
    log({ fase: F3, paso: 'guias.anularGuia()', ok: false, error: String(e) });
  }

  // A tras anular guia: stock 18, costo queda 2.375 (anular devuelve stock pero no recalcula costo promedio)
  try { logValidacion(F3, await validarStock(page, 'test A', 18, 2.375)); } catch (e) { log({ fase: F3, paso: "kardex.validarStock('test A')", ok: false, error: String(e) }); }

  // =====================================================================
  // Reporte
  // =====================================================================
  const rutaReporte = path.resolve('data', 'Reporte_Bot.xlsx');
  let rutaFinal = rutaReporte;
  try {
    await generarReporte(reporte, rutaReporte);
  } catch (e) {
    const fallback = path.resolve(
      'data',
      'Reporte_Bot_' + Date.now() + '.xlsx',
    );
    await generarReporte(reporte, fallback);
    rutaFinal = fallback;
    console.log('Reporte_Bot.xlsx estaba bloqueado; se escribió en: ' + fallback);
  }

  const exitosos = reporte.filter((r) => r.ok).length;
  const fallidos = reporte.filter((r) => !r.ok).length;
  console.log('\n== Resumen E2E ==');
  console.log('Exitosos: ' + exitosos + ' | Fallidos: ' + fallidos);
  console.log('Reporte generado: ' + rutaFinal);

  // Entregables visuales (misma data del Excel, listos para presentar).
  // PDF 100% Node vía PDFKit: no depende del navegador.
  try {
    const resumen = resumirReporte(reporte);
    const rutaHtml = path.resolve('data', 'Reporte_Bot.html');
    await fs.writeFile(rutaHtml, generarHtmlReporte(reporte, resumen), 'utf8');
    console.log('HTML generado: ' + rutaHtml);
    const rutaPdf = path.resolve('data', 'Reporte_Bot.pdf');
    await generarPdfReporte(reporte, rutaPdf, resumen);
    console.log('PDF generado: ' + rutaPdf);
  } catch (e) {
    console.log('No se pudo generar HTML/PDF (se mantiene el Excel): ' + String(e));
  }

  await browser.close();
  process.exit(fallidos ? 1 : 0);
}

async function generarReporte(reporte: FilaReporte[], ruta: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RESULTADOS');

  ws.columns = [
    { header: 'FASE', key: 'fase', width: 22 },
    { header: 'PASO', key: 'paso', width: 60 },
    { header: 'OK', key: 'ok', width: 10 },
    { header: 'ESPERADO', key: 'esperado', width: 40 },
    { header: 'REAL', key: 'real', width: 40 },
    { header: 'ERROR', key: 'error', width: 80 },
  ];

  ws.getRow(1).font = { bold: true };

  for (const r of reporte) {
    ws.addRow({
      fase: r.fase,
      paso: r.paso,
      ok: r.ok ? 'SI' : 'NO',
      esperado: r.esperado || '',
      real: r.real || '',
      error: r.error || '',
    });
  }

  await wb.xlsx.writeFile(ruta);
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(2);
});
