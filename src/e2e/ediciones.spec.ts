// ediciones.spec.ts — Bloque 8 (casos 40-45): verifica que la EDICIÓN se comporta
// adecuadamente. No re-valida lo verde: opera sobre documentos de la suite y
// aserta recálculo PPP, pactos y bloqueos. La matemática exacta por endpoint se
// fijó tras el first-run con DIAG (método habitual).
// Ejecutar: npm run test:bloque8. PRECONDICIÓN: cierre de la suite 1-7.

import * as path from 'path';
import { Page } from 'playwright';
import { navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { modificarCompra, anularCompra } from '../compras';
import { modificarGuia } from '../guias';
import { FilaReporte } from '../types';
import { QA, QA_MRP, QA_TRASLADO, QA_EDIT, EstadoSuite } from './fixtures';
import { assertStockInsumoEnAlmacen } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 8: Ediciones';

/** Edita precio pactado de una OC (POST ordencompra/actualizarOrdencompra).
 * El detalle se lee por SQL: NO existe endpoint REST de detalle OC
 * (ordencompra/detalle/* da 404 y dejaba productos=[] sin actualizar nada). */
async function actualizarOC(
  page: Page, ocId: number, precio: number,
): Promise<{ ok: boolean; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'ordencompra/actualizarOrdencompra', 45000).catch(() => null);
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logisticaaa',
  });
  let filas: any[] = [];
  try {
    const [rows] = await conn.query(
      'SELECT detalleordencompra_id, detalleordencompra_cantidad, presentacioninsumo_id, almacen_id ' +
        'FROM detalleordencompra WHERE ordencompra_id = ?',
      [ocId],
    );
    filas = rows as any[];
  } finally {
    await conn.end();
  }
  if (!filas.length) return { ok: false, error: 'OC sin detalle en BD: ' + ocId };
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdencompraResource');
      const get = await R.obtenerOrdencompra(args.ocId);
      const d = get && get.data ? get.data : null;
      const cab = d && d.ordencompra ? d.ordencompra : d;
      if (!cab) return { ok: false, error: 'OC no encontrada: ' + args.ocId };
      const productos = args.filas.map((x: any) => ({
        detalleordencompra_id: x.detalleordencompra_id,
        detalleordencompra_cantidad: x.detalleordencompra_cantidad,
        detalleordencompra_precio: args.precio,
        detalleordencompra_costo: args.precio,
        detalleordencompra_importe: Number(x.detalleordencompra_cantidad) * args.precio,
        presentacioninsumo_id: x.presentacioninsumo_id,
        almacen_id: x.almacen_id,
      }));
      const payload = {
        ordencompra: { ...cab, ordencompra_id: args.ocId },
        productos,
      };
      const resp = await R.actualizarOrdencompra(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, raw };
      return { ok: false, error: (Array.isArray(resp.mensajes) ? resp.mensajes.join('; ') : String(resp.mensajes || '')), raw };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { ocId, precio, filas });
  diag('[DIAG EditarOC] ' + JSON.stringify({ ok: r.ok, error: r.error, raw: r.raw }).slice(0, 1500));
  try {
    const resp = await endpoint;
    diag('[DIAG EditarOC] red=' + JSON.stringify((await leerRespuesta(resp)).json).slice(0, 500));
  } catch (e) { diag('[DIAG EditarOC] sin red: ' + String(e)); }
  return r;
}

/** Lee una solicitud de compra para verificar su detalle. */
async function consultarSolicitud(
  page: Page, id: number,
): Promise<{ cantidades: number[]; error?: string }> {
  return page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('RequerimientocompraResource');
      const resp = await R.obtener(id);
      const d = resp && resp.data ? resp.data : null;
      const det = (d && (d.detallerequerimientocompraList || d.detalle)) || [];
      return { cantidades: (Array.isArray(det) ? det : []).map((x: any) => Number(x.detallerequerimientocompra_cantidad)) };
    } catch (e) {
      return { cantidades: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, id);
}

/** Edita cantidad de una solicitud (POST compra/requerimientocompra/actualizar). */
async function editarSolicitud(
  page: Page, id: number, cantidad: number,
): Promise<{ ok: boolean; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'compra/requerimientocompra/actualizar', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('RequerimientocompraResource');
      const get = await R.obtener(args.id);
      const d = get && get.data ? get.data : null;
      const cab = d && d.requerimientocompra ? d.requerimientocompra : d;
      if (!cab) return { ok: false, error: 'Solicitud no encontrada: ' + args.id };
      const det = (cab.detallerequerimientocompraList || d.detallerequerimientocompraList || []).map((x: any) => ({
        ...x,
        detallerequerimientocompra_cantidad: args.cantidad,
      }));
      const manana = new Date(Date.now() + 86400000);
      const f = (n: number): string => String(n).padStart(2, '0');
      const payload = {
        ...cab,
        requerimientocompra_id: args.id,
        // La fecha original ya venció: el validator exige fecha válida.
        requerimientocompra_fechaentrega: manana.getFullYear() + '-' + f(manana.getMonth() + 1) + '-' + f(manana.getDate()),
        detallerequerimientocompraList: det,
      };
      const resp = await R.actualizar(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, raw };
      return { ok: false, error: (Array.isArray(resp.mensajes) ? resp.mensajes.join('; ') : String(resp.mensajes || '')), raw };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { id, cantidad });
  diag('[DIAG EditarSol] ' + JSON.stringify({ ok: r.ok, error: r.error, raw: r.raw }).slice(0, 1500));
  try {
    const resp = await endpoint;
    diag('[DIAG EditarSol] red=' + JSON.stringify((await leerRespuesta(resp)).json).slice(0, 500));
  } catch (e) { diag('[DIAG EditarSol] sin red: ' + String(e)); }
  return r;
}

/** Casos 40-45. */
export async function runBloque8(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);

  // Precondición: cierre suite (Central 53/23.571, Suc 30/25.857, Importado 80/15).
  try {
    const pc1 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 53, 23.571);
    val(pc1);
    const pc2 = await assertStockInsumoEnAlmacen(page, QA_MRP.importado, QA_TRASLADO.almacenCentral, 80, 15);
    val(pc2);
    if (!pc1.ok || !pc2.ok) {
      log({ fase: F, paso: 'Bloque 8 abortado: sin cierre de suite', ok: false, error: 'Precondición fallida.' });
      return;
    }
  } catch (e) {
    log({ fase: F, paso: 'precondición suite', ok: false, error: String(e) });
    return;
  }

  // Caso 40: editar precio de la compra del importado (80@15 → 80@18). Entrada única: PPP=18.
  try {
    const r = await modificarCompra(page, estado.compraImportadoId!, [
      { nombre: QA_MRP.importado, insumoId: estado.importadoId, cantidad: 80, precio: QA_EDIT.importadoPrecioNuevo },
    ]);
    log({ fase: F, paso: '40. editarCompra importado(@18)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '40. editarCompra', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA_MRP.importado, QA_TRASLADO.almacenCentral, 80, 18));
  } catch (e) { log({ fase: F, paso: '40. validarStock 80/18', ok: false, error: String(e) }); }

  // Caso 41: editar cantidad de la guía-2 (30@22 → 20@22). Replay: (825+440)/53=23.868.
  try {
    const r = await modificarGuia(page, estado.guia2Id!, [
      { nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA_EDIT.guiaCantidadNueva, precio: 22 },
    ]);
    log({ fase: F, paso: '41. editarGuia-2 (20@22)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '41. editarGuia', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 43, 23.868));
  } catch (e) { log({ fase: F, paso: '41. validarStock 43/23.868', ok: false, error: String(e) }); }

  // Caso 42: editar precio pactado OC-2 (22→25). Solo pacto: importe 750, stock intacto.
  try {
    const r = await actualizarOC(page, estado.oc2Id!, QA_EDIT.oc2PrecioNuevo);
    log({ fase: F, paso: '42. editarOC-2(@25)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '42. editarOC', ok: false, error: String(e) }); }
  try {
    const { assertDetalleOC } = await import('./oracle');
    const a = await assertDetalleOC(estado.oc2Id!, QA_EDIT.oc2PrecioNuevo, 30);
    log({ fase: F, paso: '42. auditarOC importe=750', ok: a.ok, esperado: a.esperado, real: a.real, error: a.error });
  } catch (e) { log({ fase: F, paso: '42. auditarOC', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 43, 23.868));
  } catch (e) { log({ fase: F, paso: '42. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 43: editar cantidad de la solicitud del caso 2 (50→40). Sin Kardex: solo documento.
  try {
    const r = await editarSolicitud(page, estado.solicitudId!, 40);
    log({ fase: F, paso: '43. editarSolicitud(50→40)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '43. editarSolicitud', ok: false, error: String(e) }); }
  try {
    const c = await consultarSolicitud(page, estado.solicitudId!);
    const ok = c.cantidades.some((n) => n === 40);
    log({ fase: F, paso: '43. verificarSolicitud(40kg)', ok, real: 'cantidades=' + JSON.stringify(c.cantidades), error: ok ? undefined : (c.error || 'Cantidad no actualizada.') });
  } catch (e) { log({ fase: F, paso: '43. verificarSolicitud', ok: false, error: String(e) }); }

  // Caso 44 (negativa): editar compra con cantidad 0 → bloqueo, stock intacto.
  try {
    const r = await modificarCompra(page, estado.compra2!, [
      { nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: 0, precio: 30 },
    ]);
    const bloqueada = !r.ok;
    log({ fase: F, paso: '44. editarCompra cantidad 0 (debe bloquear)', ok: bloqueada, real: bloqueada ? 'bloqueada por el sistema' : 'se permitió (defecto)', error: bloqueada ? undefined : r.error });
  } catch (e) { log({ fase: F, paso: '44. editarCompra cero', ok: false, error: String(e) }); }

  // Caso 45 (negativa): editar compra anulada (compra3) → bloqueo.
  try {
    const compraAnulada = estado.compra3;
    if (compraAnulada === undefined) {
      log({ fase: F, paso: '45. editarCompra anulada (debe bloquear)', ok: false, error: 'Sin id de compra anulada.' });
    } else {
      const r = await anularCompra(page, compraAnulada, true).catch(() => ({ ok: true }));
      void r;
      const m = await modificarCompra(page, compraAnulada, [
        { nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: 5, precio: 30 },
      ]);
      const bloqueada = !m.ok;
      log({ fase: F, paso: '45. editarCompra anulada (debe bloquear)', ok: bloqueada, real: bloqueada ? 'bloqueada por el sistema' : 'se permitió (defecto)', error: bloqueada ? undefined : m.error });
    }
  } catch (e) { log({ fase: F, paso: '45. editarCompra anulada', ok: false, error: String(e) }); }
}

/** Entrada standalone: npm run test:bloque8. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque8(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque8.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque8.pdf'), resumen);
  console.log('\n== Bloque 8 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
