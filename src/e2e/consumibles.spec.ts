// consumibles.spec.ts — Bloque 2 de la Matriz Masiva (casos 10-12).
// Ejecutar: npm run test:bloque2  (después del Bloque 1; estado acumulativo).
// Oráculo en TABLA ESPEJO (REPORTE_ARQUITECTURA_KARDEX.md §1.1).

import * as path from 'path';
import { Page } from 'playwright';
import { crearConsumible, navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { registrarCompra } from '../compras';
import { FilaReporte } from '../types';
import { QA, QA_CONSUMIBLE, EstadoSuite } from './fixtures';
import { assertStockConsumible } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 2: Consumibles';

// ---------------------------------------------------------------------------
// Caso 12: salida directa como merma (POST merma/agregarMerma).
// Shape de nuevamerma.controller.js:332-367: {detallemerma, merma, movimientoEmulacion}.
// El detalle backend sale de Merma.obtenerFormatoDetalleMermaBackend(fila estilo compra).
// ---------------------------------------------------------------------------

/**
 * Salida de un consumible por merma (POST merma/agregarMerma).
 * Shape de nuevamerma.controller.js:332-367: {detallemerma, merma, movimientoEmulacion}.
 * El detalle backend sale de Merma.obtenerFormatoDetalleMermaBackend(fila estilo compra).
 * Exportada: la usa también el flujo F13 del módulo de Compras.
 */
export async function registrarSalidaConsumible(
  page: Page, nombre: string, cantidad: number, razon: string,
): Promise<{ ok: boolean; id?: number; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'merma/agregarMerma', 45000).catch(() => null);
  let r: { ok: boolean; id?: number; error?: string; raw?: unknown };
  try {
    r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const MermaRes = injector.get('MermaResource');
        const Merma = injector.get('Merma');
        const Compra = injector.get('Compra');
        const CommonCollection = injector.get('CommonCollection');
        const SecurityService = injector.get('SecurityService');
        const PARAM = injector.get('PARAM');
        const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
        const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
        const busq = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (busq && busq.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return { ok: false, error: 'Item no encontrado para salida: ' + args.nombre };
        const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
        const almacenes = (respAlm && respAlm.data) || [];
        const almacen = almacenes[0] || { almacen_id: 1, almacen_descripcion: '' };
        const respCat = await CommonCollection.obtenerCategoriasalidasListByEstado().catch(() => null);
        const cats = (respCat && respCat.data) || [];
        if (!cats.length) return { ok: false, error: 'Sin categorías de salida.' };
        // Fila estilo compra (ver bot.ts resolverItem) para el formateador de merma.
        const fila = {
          item_id: item.item_id,
          item_tipo: item.item_tipo,
          item_subtipo: item.item_subtipo,
          item_codigo: item.item_codigo,
          item_descripcion: item.item_descripcion,
          item_cantidad: args.cantidad,
          item_precio: 0,
          item_descuento: 0,
          item_total: 0,
          item_afectoigv: false,
          unidadmedidainsumo: item.unidadmedidainsumo_descripcion || '',
          unidadmedidainsumo_id: item.unidadmedidainsumo_id || null,
          presentacion_id: item.item_presentacionid || null,
          presentacion_nombre: item.item_presentacion || '',
          presentacioninsumo_cantidad: 1,
          almacen,
          impuestocompraproductogeneralinsumoList: item.impuestocompraproductogeneralinsumoList || null,
        };
        let detallemerma: any;
        try {
          // En nuevamerma.controller.js:332 se invoca como estático de la factory.
          const M = Merma;
          if (typeof M.obtenerFormatoDetalleMermaBackend !== 'function') {
            return { ok: false, error: 'Formateador merma no es función (tipo=' + typeof M.obtenerFormatoDetalleMermaBackend + ').' };
          }
          detallemerma = M.obtenerFormatoDetalleMermaBackend([fila]);
        } catch (e) {
          return { ok: false, error: 'Formateador merma falló: ' + (e instanceof Error ? e.message : String(e)) };
        }
        const ahora = new Date();
        const f = (n: number): string => String(n).padStart(2, '0');
        const obj = {
          detallemerma,
          merma: {
            local_id: local.local_id,
            merma_estado: '1',
            merma_razon: args.razon,
            merma_importe: 0,
            merma_hora: f(ahora.getHours()) + ':' + f(ahora.getMinutes()) + ':' + f(ahora.getSeconds()),
            merma_fecha: ahora.getFullYear() + '-' + f(ahora.getMonth() + 1) + '-' + f(ahora.getDate()),
            categoriasalida_id: cats[0].categoriasalida_id,
            categoriasalida_descripcion: cats[0].categoriasalida_descripcion,
            merma_responsableid: null,
          },
          movimientoEmulacion: null,
        };
        void Compra;
        const resp = await MermaRes.agregar(obj);
        const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
        if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw };
        return { ok: false, error: (resp.mensajes || []).join('; '), raw };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { nombre, cantidad, razon });
  } catch (e) {
    r = { ok: false, error: 'Fallo page.evaluate: ' + String(e) };
  }
  diag('[DIAG Salida] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
  try {
    const resp = await endpoint;
    const net = await leerRespuesta(resp);
    diag('[DIAG Salida] red=' + JSON.stringify(net.json));
  } catch (e) {
    diag('[DIAG Salida] sin respuesta de red (timeout?): ' + String(e));
  }
  return r;
}

/** Casos 10-12. Reutilizable por la suite (sin browser/limpieza/reporte propios). */
export async function runBloque2(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);

  // Caso 10: alta de consumible con 0 stock.
  try {
    const r = await crearConsumible(page, { nombre: QA_CONSUMIBLE.nombre, stockApertura: 0, costoApertura: 0, almacen: QA.almacenCentral });
    log({ fase: F, paso: "10. crearConsumible('Caja de Empaque QA') 0u", ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.consumibleId = r.id;
  } catch (e) { log({ fase: F, paso: '10. crearConsumible', ok: false, error: String(e) }); }
  try {
    val(await assertStockConsumible(QA_CONSUMIBLE.nombre, estado.consumibleId!, QA_CONSUMIBLE.almacenId, 0, 0));
  } catch (e) { log({ fase: F, paso: '10. validarStock espejo 0/0', ok: false, error: String(e) }); }

  // Caso 11: compra 200 @0.50 → espejo 200/0.5.
  try {
    const r = await registrarCompra(page, {
      serie: 'F001', numero: 'QA-C1', proveedor: QA.proveedor,
      detalle: [{ nombre: QA_CONSUMIBLE.nombre, insumoId: estado.consumibleId, cantidad: QA_CONSUMIBLE.compra.cantidad, precio: QA_CONSUMIBLE.compra.precio }],
    });
    log({ fase: F, paso: '11. registrarCompra consumible (200@0.5)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '11. registrarCompra', ok: false, error: String(e) }); }
  try {
    val(await assertStockConsumible(QA_CONSUMIBLE.nombre, estado.consumibleId!, QA_CONSUMIBLE.almacenId, 200, 0.5));
  } catch (e) { log({ fase: F, paso: '11. validarStock espejo 200/0.5', ok: false, error: String(e) }); }

  // Caso 12: salida 50 → espejo 150, costo congelado 0.5.
  try {
    const r = await registrarSalidaConsumible(page, QA_CONSUMIBLE.nombre, QA_CONSUMIBLE.salida, QA_CONSUMIBLE.razon);
    log({ fase: F, paso: '12. salidaDirecta consumible (50u)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.mermaId = r.id;
  } catch (e) { log({ fase: F, paso: '12. salidaDirecta', ok: false, error: String(e) }); }
  try {
    val(await assertStockConsumible(QA_CONSUMIBLE.nombre, estado.consumibleId!, QA_CONSUMIBLE.almacenId, 150, 0.5));
  } catch (e) { log({ fase: F, paso: '12. validarStock espejo 150/0.5', ok: false, error: String(e) }); }

}

/** Entrada standalone: npm run test:bloque2. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(true);
  await runBloque2(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque2.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque2.pdf'), resumen);
  console.log('\n== Bloque 2 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
