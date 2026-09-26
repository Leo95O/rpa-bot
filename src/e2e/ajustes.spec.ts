// ajustes.spec.ts — Bloque 4 de la Matriz Masiva (casos 19-20).
// Ejecutar: npm run test:bloque4. PRECONDICIÓN: cierre del Bloque 3
// (Central 50/25, Sucursal 5/25). NO limpia BD (matriz acumulativa).

import * as path from 'path';
import { Page } from 'playwright';
import { navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { FilaReporte } from '../types';
import { QA, QA_TRASLADO, QA_CUADRE, EstadoSuite } from './fixtures';
import { assertStockInsumoEnAlmacen } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 4: Ajustes';

/** Lee el stock actual del almacén para armar cantidad2 (sistema) real. */
async function stockActual(page: Page, almacenDesc: string): Promise<number> {
  const v = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, almacenDesc, -1, -1).catch(() => null);
  if (v && v.real) {
    const m = /stock=([-\d.]+)/.exec(v.real);
    if (m) return Number(m[1]);
  }
  return NaN;
}

/** Caso 19: faltante en Central (físico < sistema). Costo congelado. */
export async function runBloque4(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  void estado;
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);

  // Precondición Bloque 3. Fail-fast: sin esto todo el bloque pagaría timeouts.
  try {
    const pc1 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 50, 25);
    val(pc1);
    const pc2 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 5, 25);
    val(pc2);
    if (!pc1.ok || !pc2.ok) {
      log({ fase: F, paso: 'Bloque 4 abortado: sin estado del Bloque 3', ok: false, error: 'Precondición fallida.' });
      return;
    }
  } catch (e) {
    log({ fase: F, paso: 'precondición Bloque 3', ok: false, error: String(e) });
    return;
  }

  // Caso 19: físico 45 vs sistema 50 → faltante 5, pérdida 125, costo fijo.
  try {
    const sistema = await stockActual(page, QA_TRASLADO.almacenCentral);
    const endpoint = esperarEndpoint(page, 'cuadremanual/guardarCuadreManualStock', 60000).catch(() => null);
    const r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('CuadremanualResource');
        const CommonCollection = injector.get('CommonCollection');
        const SecurityService = injector.get('SecurityService');
        const PARAM = injector.get('PARAM');
        const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
        const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
        const busq = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const item = ((busq && busq.data) || []).find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase());
        if (!item) return { ok: false, error: 'Item no encontrado: ' + args.nombre };
        const ahora = new Date();
        const f = (n: number): string => String(n).padStart(2, '0');
        const payload = {
          razon: args.razon,
          fecha: ahora.getFullYear() + '-' + f(ahora.getMonth() + 1) + '-' + f(ahora.getDate()) + ' ' + f(ahora.getHours()) + ':' + f(ahora.getMinutes()) + ':' + f(ahora.getSeconds()),
          local_id: local.local_id,
          result: [{
            insumo_id: item.item_id, producto_id: null, item_descripcion: item.item_descripcion,
            almacenes: [{
              almacen_id: args.almacenId, cantidad2: args.sistema, inventario_cantidad: args.fisico,
              costoNuevo: null, costo: 25,
              almacen_variacion: args.fisico - args.sistema,
              detallecuadremanual_cantidaddisminuyo: args.sistema - args.fisico,
              detallecuadremanual_cantidadaumento: 0,
            }],
          }],
        };
        const resp = await R.guardarCuadreManualStock(payload);
        const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
        if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw };
        return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { nombre: QA.insumoCarne, almacenId: QA_TRASLADO.almacenCentralId, sistema, fisico: QA_CUADRE.centralFisico, razon: QA_CUADRE.razonFaltante });
    diag('[DIAG Cuadre19] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
    try {
      const resp = await endpoint;
      diag('[DIAG Cuadre19] red=' + JSON.stringify((await leerRespuesta(resp)).json));
    } catch (e) { diag('[DIAG Cuadre19] sin red: ' + String(e)); }
    // El guardar deja el cuadre PENDIENTE (el front abre el modal de procesados):
    // hay que procesarlo para que toque Kardex.
    if (r.ok) {
      const pr = await page.evaluate(async (id) => {
        try {
          const injector = angular.element(document.body).injector();
          const R = injector.get('CuadremanualResource');
          const resp = await R.procesarCuadrePendiente(id);
          return { ok: Number(resp.tipo) === 1, raw: { tipo: resp.tipo, mensajes: resp.mensajes } };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }, (r as { id?: number }).id);
      diag('[DIAG Cuadre19-procesar] ' + JSON.stringify(pr));
    }
    log({ fase: F, paso: '19. cuadreFaltante Central (50→45)', ok: r.ok, real: r.id !== undefined ? 'id=' + (r as { id?: number }).id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '19. cuadreFaltante', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 45, 25));
  } catch (e) { log({ fase: F, paso: '19. validarStock 45/25', ok: false, error: String(e) }); }

  // Caso 20: sobrante en Sucursal (físico 8 vs sistema 5, costo digitado 30).
  try {
    const endpoint = esperarEndpoint(page, 'cuadremanual/guardarCuadreManualStock', 60000).catch(() => null);
    const r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('CuadremanualResource');
        const CommonCollection = injector.get('CommonCollection');
        const SecurityService = injector.get('SecurityService');
        const PARAM = injector.get('PARAM');
        const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
        const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
        const busq = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const item = ((busq && busq.data) || []).find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase());
        if (!item) return { ok: false, error: 'Item no encontrado: ' + args.nombre };
        const ahora = new Date();
        const f = (n: number): string => String(n).padStart(2, '0');
        const payload = {
          razon: args.razon,
          fecha: ahora.getFullYear() + '-' + f(ahora.getMonth() + 1) + '-' + f(ahora.getDate()) + ' ' + f(ahora.getHours()) + ':' + f(ahora.getMinutes()) + ':' + f(ahora.getSeconds()),
          local_id: local.local_id,
          result: [{
            insumo_id: item.item_id, producto_id: null, item_descripcion: item.item_descripcion,
            almacenes: [{
              almacen_id: args.almacenId, cantidad2: args.sistema, inventario_cantidad: args.fisico,
              costoNuevo: args.costoNuevo, costo: 25,
              almacen_variacion: args.fisico - args.sistema,
              detallecuadremanual_cantidadaumento: args.fisico - args.sistema,
              detallecuadremanual_cantidaddisminuyo: 0,
            }],
          }],
        };
        const resp = await R.guardarCuadreManualStock(payload);
        const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
        if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw };
        return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { nombre: QA.insumoCarne, almacenId: QA_TRASLADO.almacenSucursalId, sistema: 5, fisico: QA_CUADRE.sucursalFisico, costoNuevo: QA_CUADRE.sobranteCosto, razon: QA_CUADRE.razonSobrante });
    diag('[DIAG Cuadre20] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
    try {
      const resp = await endpoint;
      diag('[DIAG Cuadre20] red=' + JSON.stringify((await leerRespuesta(resp)).json));
    } catch (e) { diag('[DIAG Cuadre20] sin red: ' + String(e)); }
    if (r.ok) {
      const pr = await page.evaluate(async (id) => {
        try {
          const injector = angular.element(document.body).injector();
          const R = injector.get('CuadremanualResource');
          const resp = await R.procesarCuadrePendiente(id);
          return { ok: Number(resp.tipo) === 1, raw: { tipo: resp.tipo, mensajes: resp.mensajes } };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }, (r as { id?: number }).id);
      diag('[DIAG Cuadre20-procesar] ' + JSON.stringify(pr));
    }
    log({ fase: F, paso: '20. cuadreSobrante Sucursal (5→8 @30)', ok: r.ok, real: r.id !== undefined ? 'id=' + (r as { id?: number }).id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '20. cuadreSobrante', ok: false, error: String(e) }); }
  // Comportamiento real verificado: el cuadre sobrante REVALORIZA todo el stock
  // al costo digitado (TIPO_CUADRE: costopromedioactual = costooperacion,
  // MovimientoalmaceninsumoV2.php:229-250), no promedia. 8kg @30.
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 8, 30));
  } catch (e) { log({ fase: F, paso: '20. validarStock 8/30', ok: false, error: String(e) }); }
}

/** Entrada standalone: npm run test:bloque4. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque4(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque4.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque4.pdf'), resumen);
  console.log('\n== Bloque 4 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
