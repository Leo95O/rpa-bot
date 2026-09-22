import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { leerExcel } from './parser';
import { conectarNavegador, obtenerPaginaApp, ejecutarInsumos, ejecutarCompras } from './bot';
import { limpiarBaseDatos } from './db';
import { ResultadoOperacion } from './types';

async function main(): Promise<void> {
  const rutaExcel = process.argv[2] || process.env.EXCEL_PATH;
  if (!rutaExcel) {
    console.error('Uso: npm start <ruta-del-excel.xlsx>');
    console.error('  o   set EXCEL_PATH=C:\\ruta\\archivo.xlsx && npm start');
    process.exit(1);
  }

  const rutaAbsoluta = path.resolve(rutaExcel);

  console.log('== Bot RPA logisticaview ==');
  console.log('CDP endpoint : ' + (process.env.CDP_ENDPOINT || 'http://localhost:9222'));
  console.log('Excel        : ' + rutaAbsoluta);

  const datos = await leerExcel(rutaAbsoluta);
  console.log(
    'Leídos ' + datos.insumos.length + ' insumos y ' + datos.compras.length + ' compras.',
  );

  console.log('\nLimpiando base de datos...');
  await limpiarBaseDatos();

  const browser = await conectarNavegador();
  const page = await obtenerPaginaApp(browser);
  console.log('Conectado a la pestaña: ' + page.url());

  const resultados: ResultadoOperacion[] = [];

  if (datos.insumos.length) {
    console.log('\n-- Creación de Insumos --');
    const r = await ejecutarInsumos(page, datos.insumos);
    r.forEach(imprimirResultado);
    resultados.push(...r);
  }

  if (datos.compras.length) {
    console.log('\n-- Registro de Compras --');
    const r = await ejecutarCompras(page, datos.compras);
    r.forEach(imprimirResultado);
    resultados.push(...r);
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  const fallidos = resultados.filter((r) => !r.ok).length;

  const rutaReporte = path.resolve('data', 'Reporte_Bot.xlsx');
  await generarReporte(resultados, rutaReporte);

  console.log('\n== Resumen ==');
  console.log('Exitosos: ' + exitosos + ' | Fallidos: ' + fallidos);
  if (fallidos) {
    console.log('Fallidos:');
    resultados
      .filter((r) => !r.ok)
      .forEach((r) => console.log('  - [' + r.tipo + '] ' + r.idOperacion + ': ' + r.error));
  }
  console.log('Reporte generado: ' + rutaReporte);

  await browser.close();
  process.exit(fallidos ? 1 : 0);
}

function generarReporte(resultados: ResultadoOperacion[], ruta: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RESULTADOS');

  ws.columns = [
    { header: 'TIPO', key: 'tipo', width: 12 },
    { header: 'ID_OPERACION', key: 'idOperacion', width: 18 },
    { header: 'ESTADO', key: 'estado', width: 12 },
    { header: 'DETALLE', key: 'detalle', width: 70 },
    { header: 'ERROR', key: 'error', width: 70 },
  ];

  ws.getRow(1).font = { bold: true };

  for (const r of resultados) {
    ws.addRow({
      tipo: r.tipo,
      idOperacion: r.idOperacion,
      estado: r.ok ? 'EXITOSO' : 'FALLIDO',
      detalle: r.detalle || '',
      error: r.error || '',
    });
  }

  return wb.xlsx.writeFile(ruta);
}

function imprimirResultado(r: ResultadoOperacion): void {
  const marca = r.ok ? '[OK]' : '[FALLO]';
  console.log(marca + ' [' + r.tipo + '] ' + r.idOperacion + (r.detalle ? ' -> ' + r.detalle : ''));
  if (!r.ok && r.error) console.log('      ' + r.error);
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(2);
});
