// canjes.spec.ts — Bloque 6 de la Matriz Masiva (casos 29-35). CIERRA LA SUITE.
// Ejecutar: npm run test:bloque6. PRECONDICIÓN: cierre del Bloque 5
// (Central 33/25, Sucursal 20/27, Importado 80/15). NO limpia BD.

import * as path from 'path';
import { Page } from 'playwright';
import { navegar, cerrarModales } from '../bot';
import { registrarGuia } from '../guias';
import { FilaReporte } from '../types';
import { QA, QA_TRASLADO, QA_CANJES, EstadoSuite } from './fixtures';
import { assertStockInsumoEnAlmacen } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { registrarOrdenCompra } from './aprovisionamiento.spec';
import { registrarReqStock, registrarOrdenMovimiento, registrarMovimiento } from './traslados.spec';
import { crearOP, consultarOP } from './mrp.spec';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 6: Canjes';

/** Casos 29-35. */
export async function runBloque6(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);

  // Precondición Bloque 5. Fail-fast: sin esto todo el bloque pagaría timeouts.
  try {
    const pc1 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 33, 25);
    val(pc1);
    const pc2 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 20, 27);
    val(pc2);
    if (!pc1.ok || !pc2.ok) {
      log({ fase: F, paso: 'Bloque 6 abortado: sin estado del Bloque 5', ok: false, error: 'Precondición fallida.' });
      return;
    }
  } catch (e) {
    log({ fase: F, paso: 'precondición Bloque 5', ok: false, error: String(e) });
    return;
  }

  // Caso 29: OC-2 30kg @22.
  try {
    const r = await registrarOrdenCompra(page, QA.insumoCarne, estado.insumoId!, QA_CANJES.oc2.cantidad, QA_CANJES.oc2.costo, QA.proveedor);
    log({ fase: F, paso: '29. registrarOC-2(30@22)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.oc2Id = r.id;
  } catch (e) { log({ fase: F, paso: '29. registrarOC-2', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 33, 25));
  } catch (e) { log({ fase: F, paso: '29. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 30: guía canjeando OC-2 (30@22). PPP=(33*25+30*22)/63=23.571.
  try {
    const r = await registrarGuia(page, {
      serie: QA_CANJES.guiaSerie, numero: 'QA-G2',
      detalle: [{ nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA_CANJES.oc2.cantidad, precio: QA_CANJES.oc2.costo }],
      ordencompraList: estado.oc2Id !== undefined ? [estado.oc2Id] : undefined,
    });
    log({ fase: F, paso: '30. guiaCanjeOC-2(30@22)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.guia2Id = r.id;
    if (r.ok) {
      const oc: { compra_id?: number; guia_id?: number } | null = await page.evaluate(async (id) => {
        try {
          const injector = angular.element(document.body).injector();
          const R = injector.get('OrdencompraResource');
          const resp = await R.obtenerOrdencompra(id);
          const d = resp && resp.data ? resp.data : null;
          const cab = d && d.ordencompra ? d.ordencompra : d;
          return cab ? { compra_id: cab.compra_id, guia_id: cab.guia_id } : null;
        } catch { return null; }
      }, estado.oc2Id!);
      diag('[DIAG CanjeGuia] OC-2 tras guía=' + JSON.stringify(oc));
    }
  } catch (e) { log({ fase: F, paso: '30. guiaCanjeOC-2', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 63, 23.571));
  } catch (e) { log({ fase: F, paso: '30. validarStock 63/23.571', ok: false, error: String(e) }); }

  // Caso 31: requerimiento 10kg.
  try {
    const r = await registrarReqStock(page, QA_CANJES.req2Cantidad);
    log({ fase: F, paso: '31. requerimientoStock(10kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.req2Id = r.id;
  } catch (e) { log({ fase: F, paso: '31. requerimientoStock', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 63, 23.571));
  } catch (e) { log({ fase: F, paso: '31. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 32: orden de movimiento 10kg.
  try {
    const r = await registrarOrdenMovimiento(page, QA_CANJES.traslado2Cantidad);
    log({ fase: F, paso: '32. ordenMovimiento(10kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.om2Id = r.id;
  } catch (e) { log({ fase: F, paso: '32. ordenMovimiento', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 63, 23.571));
  } catch (e) { log({ fase: F, paso: '32. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 33: traslado 10kg. Central 63→53 (23.571). Sucursal: (20*27+10*23.571)/30=25.857.
  try {
    const r = await registrarMovimiento(page, QA_CANJES.traslado2Cantidad);
    log({ fase: F, paso: '33. trasladoLote2(10kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.mov2Id = r.id;
  } catch (e) { log({ fase: F, paso: '33. trasladoLote2', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 53, 23.571));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 30, 25.857));
  } catch (e) { log({ fase: F, paso: '33. validarStock 53/30', ok: false, error: String(e) }); }

  // Caso 34: requerimiento para producción (15kg, motivo Plato QA).
  try {
    const r = await registrarReqStock(page, QA_CANJES.reqProdCantidad);
    log({ fase: F, paso: '34. requerimientoProd(15kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.reqProdId = r.id;
  } catch (e) { log({ fase: F, paso: '34. requerimientoProd', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 30, 25.857));
  } catch (e) { log({ fase: F, paso: '34. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 35: canje directo a OP (Sucursal tiene 30 ≥ 15).
  try {
    const r = await crearOP(page, estado.platoId!, QA_CANJES.reqProdCantidad, QA_TRASLADO.almacenSucursalId, { requerimientoId: estado.reqProdId! });
    log({ fase: F, paso: '35. OP canjeReq(15platos)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.opReqId = r.id;
  } catch (e) { log({ fase: F, paso: '35. OP canjeReq', ok: false, error: String(e) }); }
  try {
    const c = await consultarOP(page, estado.opReqId!);
    const raw = c.raw as { requerimientomovimiento_id?: number } | null | undefined;
    const ok = raw != null && Number(raw.requerimientomovimiento_id) === estado.reqProdId;
    log({ fase: F, paso: '35. OP referencia requerimiento', ok, real: 'reqMovId=' + (raw ? raw.requerimientomovimiento_id : undefined), error: ok ? undefined : (c.error || 'Sin vínculo.') });
  } catch (e) { log({ fase: F, paso: '35. verificarCanje', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 30, 25.857));
  } catch (e) { log({ fase: F, paso: '35. validarStock sin cambio', ok: false, error: String(e) }); }
}

/** Entrada standalone: npm run test:bloque6. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque6(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque6.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque6.pdf'), resumen);
  console.log('\n== Bloque 6 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
