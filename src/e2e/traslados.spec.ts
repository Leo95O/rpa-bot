// traslados.spec.ts — Bloque 3 de la Matriz Masiva (casos 13-18).
// Ejecutar: npm run test:bloque3. PRECONDICIÓN: estado final del Bloque 1
// (Carne QA 90kg@25 en Central). NO limpia BD (matriz acumulativa).
// Sucursal (Cocina) = almacén 18 "Producción".

import * as path from 'path';
import { Page } from 'playwright';
import { navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { FilaReporte } from '../types';
import { QA, QA_TRASLADO, EstadoSuite } from './fixtures';
import { assertStockInsumoEnAlmacen } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 3: Traslados';

function ahora(dias = 0): string {
  const d = new Date(Date.now() + dias * 86400000);
  const f = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + f(d.getMonth() + 1) + '-' + f(d.getDate()) + ' ' + f(d.getHours()) + ':' + f(d.getMinutes()) + ':' + f(d.getSeconds());
}

/** Fila HOT común (compra/OC/movimiento comparten el formato item_*). */
async function resolverItem(page: Page, nombre: string): Promise<any> {
  return page.evaluate(async (nombre) => {
    const injector = angular.element(document.body).injector();
    const CommonCollection = injector.get('CommonCollection');
    const SecurityService = injector.get('SecurityService');
    const PARAM = injector.get('PARAM');
    const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
    const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
    const busq = await CommonCollection.busquedaSensitivaSegunTipos(
      nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
      PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
    );
    const lista = (busq && busq.data) || [];
    const item = lista.find(
      (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(nombre).trim().toLowerCase(),
    );
    if (!item) return null;
    return { local, item };
  }, nombre);
}

// ---------------------------------------------------------------------------
// Caso 13: requerimiento de stock (POST requerimientomovimiento/agregarSolicitudAbastecimiento)
// ---------------------------------------------------------------------------
export async function registrarReqStock(page: Page, cantidad: number): Promise<{ ok: boolean; id?: number; error?: string }> {
  const endpoint = esperarEndpoint(page, 'requerimientomovimiento/agregarSolicitudAbastecimiento', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('RequerimientomovimientoResource');
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
      const ahora = new Date(Date.now() + 5 * 60000);
      const f = (n: number): string => String(n).padStart(2, '0');
      const payload = {
        requerimiento: {
          local_id: local.local_id,
          // Validator: Y-m-d H:i:s y NO anterior a la actual (usa +5min de margen).
          requerimientomovimiento_fecha: ahora.getFullYear() + '-' + f(ahora.getMonth() + 1) + '-' + f(ahora.getDate()) + ' ' + f(ahora.getHours()) + ':' + f(ahora.getMinutes()) + ':' + f(ahora.getSeconds()),
        },
        productos: [{
          insumo_id: item.item_id, producto_id: null, producto_codigo: item.item_codigo,
          presentacioninsumo_id: item.item_presentacionid || null, presentacioninsumo_cantidad: 1,
          detallerequerimiento_cantidad: args.cantidad,
          detallerequerimiento_descripcion: item.item_descripcion,
          detallerequerimiento_almacendestinoid: args.destinoId,
          unidadmedidainsumo: item.unidadmedidainsumo_id || null,
        }],
      };
      const resp = await R.agregar(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
      return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { nombre: QA.insumoCarne, cantidad, destinoId: QA_TRASLADO.almacenSucursalId, fecha: ahora() });
  diag('[DIAG ReqStock] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
  try {
    const resp = await endpoint;
    diag('[DIAG ReqStock] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG ReqStock] sin red: ' + String(e)); }
  return r;
}

// ---------------------------------------------------------------------------
// Casos 14-15: orden de movimiento y movimiento interno.
// ---------------------------------------------------------------------------
function filaMovimiento(item: any, cantidad: number, origen: { almacen_id: number }, destino: { almacen_id: number }): unknown {
  return {
    detallemovimiento_descripcion: item.item_descripcion,
    detallemovimiento_unidadmedida: item.unidadmedidainsumo_descripcion || '',
    detallemovimiento_cantidad: cantidad,
    detallemovimiento_cantidadsolicitada: cantidad,
    movimiento_id: '-1',
    tipo: item.item_tipo,
    unidadmedidainsumo: item.unidadmedidainsumo_id || null,
    almacenSeleccionado: origen,
    almacen_id: origen.almacen_id,
    detallemovimiento_almacenorigenid: origen.almacen_id,
    detallemovimiento_almacendestinoid: destino.almacen_id,
    detallemovimiento_observacion: null,
    insumo_id: item.item_tipo === 2 ? null : item.item_id,
    producto_id: item.item_tipo === 2 ? item.item_id : null,
    producto_codigo: item.item_codigo,
    presentacioninsumo_id: item.item_presentacionid || null,
    presentacioninsumo_cantidad: 1,
  };
}

export async function registrarOrdenMovimiento(page: Page, cantidad: number): Promise<{ ok: boolean; id?: number; error?: string }> {
  const endpoint = esperarEndpoint(page, 'movimiento/agregarOrdenmovimiento', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('MovimientoResource');
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
      const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
      const almacenes = (respAlm && respAlm.data) || [];
      const origen = almacenes.find((a: any) => a.almacen_id === args.origenId) || { almacen_id: args.origenId };
      const destino = almacenes.find((a: any) => a.almacen_id === args.destinoId) || { almacen_id: args.destinoId };
      const fila = {
        detallemovimiento_descripcion: item.item_descripcion,
        detallemovimiento_unidadmedida: item.unidadmedidainsumo_descripcion || '',
        detallemovimiento_cantidad: args.cantidad,
        detallemovimiento_cantidadsolicitada: args.cantidad,
        movimiento_id: '-1',
        tipo: item.item_tipo,
        unidadmedidainsumo: item.unidadmedidainsumo_id || null,
        almacenSeleccionado: origen,
        almacen_id: origen.almacen_id,
        detallemovimiento_almacenorigenid: origen.almacen_id,
        detallemovimiento_almacendestinoid: destino.almacen_id,
        detallemovimiento_observacion: null,
        insumo_id: item.item_tipo === 2 ? null : item.item_id,
        producto_id: item.item_tipo === 2 ? item.item_id : null,
        producto_codigo: item.item_codigo,
        presentacioninsumo_id: item.item_presentacionid || null,
        presentacioninsumo_cantidad: 1,
      };
      const payload = {
        movimiento: {
          local_id: local.local_id,
          almacen_id: args.origenId, // FK solitudmovimiento.almacen_id (origen)
          solitudmovimiento_fechaestimada: args.fecha,
          solitudmovimiento_solicitante: 'BOT QA',
        },
        productos: [fila],
      };
      const resp = await R.agregarOrden(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
      return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { nombre: QA.insumoCarne, cantidad, origenId: QA_TRASLADO.almacenCentralId, destinoId: QA_TRASLADO.almacenSucursalId, fecha: ahora() });
  diag('[DIAG OrdenMov] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
  try {
    const resp = await endpoint;
    diag('[DIAG OrdenMov] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG OrdenMov] sin red: ' + String(e)); }
  return r;
}

export async function registrarMovimiento(page: Page, cantidad: number): Promise<{ ok: boolean; id?: number; error?: string }> {
  const endpoint = esperarEndpoint(page, 'movimiento/agregar', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('MovimientoResource');
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
      const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
      const almacenes = (respAlm && respAlm.data) || [];
      const origen = almacenes.find((a: any) => a.almacen_id === args.origenId) || { almacen_id: args.origenId };
      const destino = almacenes.find((a: any) => a.almacen_id === args.destinoId) || { almacen_id: args.destinoId };
      const fila = {
        detallemovimiento_descripcion: item.item_descripcion,
        detallemovimiento_unidadmedida: item.unidadmedidainsumo_descripcion || '',
        detallemovimiento_cantidad: args.cantidad,
        detallemovimiento_cantidadsolicitada: args.cantidad,
        movimiento_id: '-1',
        tipo: item.item_tipo,
        unidadmedidainsumo: item.unidadmedidainsumo_id || null,
        almacenSeleccionado: origen,
        almacen_id: origen.almacen_id,
        detallemovimiento_almacenorigenid: origen.almacen_id,
        detallemovimiento_almacendestinoid: destino.almacen_id,
        detallemovimiento_observacion: null,
        insumo_id: item.item_tipo === 2 ? null : item.item_id,
        producto_id: item.item_tipo === 2 ? item.item_id : null,
        producto_codigo: item.item_codigo,
        presentacioninsumo_id: item.item_presentacionid || null,
        presentacioninsumo_cantidad: 1,
      };
      const payload = {
        movimiento: { local_id: local.local_id, movimiento_fecha: args.fecha },
        productos: [fila],
      };
      const resp = await R.agregar(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
      return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { nombre: QA.insumoCarne, cantidad, origenId: QA_TRASLADO.almacenCentralId, destinoId: QA_TRASLADO.almacenSucursalId, fecha: ahora() });
  diag('[DIAG Movimiento] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
  try {
    const resp = await endpoint;
    diag('[DIAG Movimiento] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG Movimiento] sin red: ' + String(e)); }
  return r;
}

// ---------------------------------------------------------------------------
// Caso 17: emulación con exceso (jamás se envía). Espera flag true.
// ---------------------------------------------------------------------------
async function emularExceso(page: Page, cantidad: number): Promise<{ restringido?: boolean; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'emulador/emularCambioStockEnMovimientos', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('MovimientoResource');
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
      if (!item) return { error: 'Item no encontrado: ' + args.nombre };
      const origen = { almacen_id: args.origenId };
      const destino = { almacen_id: args.destinoId };
      const fila = {
        detallemovimiento_descripcion: item.item_descripcion,
        detallemovimiento_cantidad: args.cantidad,
        movimiento_id: '-1', tipo: item.item_tipo,
        unidadmedidainsumo: item.unidadmedidainsumo_id || null,
        almacenSeleccionado: origen, almacen_id: origen.almacen_id,
        detallemovimiento_almacenorigenid: origen.almacen_id,
        detallemovimiento_almacendestinoid: destino.almacen_id,
        insumo_id: item.item_id, producto_id: null,
        presentacioninsumo_id: item.item_presentacionid || null,
        presentacioninsumo_cantidad: 1,
      };
      const resp = await R.emularMovimientoMovimiento(1, 4, {
        movimiento: { local_id: local.local_id, movimiento_fecha: args.fecha },
        productos: [fila],
      });
      const d = resp && resp.data ? resp.data : {};
      return {
        restringido: d.operacionRestringidaPorStockNegativo === true || d.operacionRestringidaPorStockNegativo === '1',
        raw: { config: d.configuracionRestringirSalidasConStockNegativo, flag: d.operacionRestringidaPorStockNegativo },
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, { nombre: QA.insumoCarne, cantidad, origenId: QA_TRASLADO.almacenCentralId, destinoId: QA_TRASLADO.almacenSucursalId, fecha: ahora() });
  diag('[DIAG Emular] ' + JSON.stringify(r));
  try {
    const resp = await endpoint;
    diag('[DIAG Emular] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG Emular] sin red: ' + String(e)); }
  return r;
}

// ---------------------------------------------------------------------------
// Caso 18: salida 35kg en Sucursal (merma, almacén 18).
// ---------------------------------------------------------------------------
async function registrarSalidaSucursal(page: Page, cantidad: number): Promise<{ ok: boolean; id?: number; error?: string }> {
  const endpoint = esperarEndpoint(page, 'merma/agregarMerma', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const MermaRes = injector.get('MermaResource');
      const Merma = injector.get('Merma');
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
      const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
      const almacen = ((respAlm && respAlm.data) || []).find((a: any) => a.almacen_id === args.almacenId) || { almacen_id: args.almacenId };
      const respCat = await CommonCollection.obtenerCategoriasalidasListByEstado().catch(() => null);
      const cats = (respCat && respCat.data) || [];
      if (!cats.length) return { ok: false, error: 'Sin categorías de salida.' };
      const fila = {
        item_id: item.item_id, item_tipo: item.item_tipo, item_codigo: item.item_codigo,
        item_descripcion: item.item_descripcion, item_cantidad: args.cantidad,
        item_precio: 0, item_descuento: 0, item_total: 0, item_afectoigv: false,
        unidadmedidainsumo: item.unidadmedidainsumo_descripcion || '',
        unidadmedidainsumo_id: item.unidadmedidainsumo_id || null,
        presentacion_id: item.item_presentacionid || null,
        presentacion_nombre: item.item_presentacion || '',
        presentacioninsumo_cantidad: 1, almacen,
        impuestocompraproductogeneralinsumoList: item.impuestocompraproductogeneralinsumoList || null,
      };
      const detallemerma = (Merma as { obtenerFormatoDetalleMermaBackend: (f: unknown[]) => unknown }).obtenerFormatoDetalleMermaBackend([fila]);
      const ahora = new Date();
      const f = (n: number): string => String(n).padStart(2, '0');
      const obj = {
        detallemerma,
        merma: {
          local_id: local.local_id, merma_estado: '1', merma_razon: 'Consumo cocina QA',
          merma_importe: 0,
          merma_hora: f(ahora.getHours()) + ':' + f(ahora.getMinutes()) + ':' + f(ahora.getSeconds()),
          merma_fecha: ahora.getFullYear() + '-' + f(ahora.getMonth() + 1) + '-' + f(ahora.getDate()),
          categoriasalida_id: cats[0].categoriasalida_id,
          categoriasalida_descripcion: cats[0].categoriasalida_descripcion,
          merma_responsableid: null,
        },
        movimientoEmulacion: null,
      };
      const resp = await MermaRes.agregar(obj);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw };
      return { ok: false, error: (resp.mensajes || []).join('; '), raw };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { nombre: QA.insumoCarne, cantidad, almacenId: QA_TRASLADO.almacenSucursalId });
  diag('[DIAG SalidaSuc] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error }));
  try {
    const resp = await endpoint;
    diag('[DIAG SalidaSuc] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG SalidaSuc] sin red: ' + String(e)); }
  return r;
}

/** Casos 13-18. Reutilizable por la suite (sin browser/limpieza/reporte propios). */
export async function runBloque3(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  console.log('\nSin limpieza: se asume estado final del Bloque 1.');
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);
  await cerrarModales(page);
  void resolverItem;

  // Precondición: Central 90/25 (cierre del Bloque 1). Fail-fast: sin esto todo el bloque pagaría timeouts.
  try {
    const pc = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 90, 25);
    val(pc);
    if (!pc.ok) {
      log({ fase: F, paso: 'Bloque 3 abortado: sin estado del Bloque 1', ok: false, error: 'Precondición fallida.' });
      return;
    }
  } catch (e) {
    log({ fase: F, paso: 'precondición Bloque 1', ok: false, error: String(e) });
    return;
  }

  // Caso 13: requerimiento 40kg (intención, sin movimiento).
  try {
    const r = await registrarReqStock(page, QA_TRASLADO.cantidad);
    log({ fase: F, paso: '13. requerimientoStock(40kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.reqStockId = r.id;
  } catch (e) { log({ fase: F, paso: '13. requerimientoStock', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 90, 25));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 0, 0));
  } catch (e) { log({ fase: F, paso: '13. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 14: orden de movimiento 40kg (picking, sin movimiento).
  try {
    const r = await registrarOrdenMovimiento(page, QA_TRASLADO.cantidad);
    log({ fase: F, paso: '14. ordenMovimiento(40kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.ordenMovId = r.id;
  } catch (e) { log({ fase: F, paso: '14. ordenMovimiento', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 90, 25));
  } catch (e) { log({ fase: F, paso: '14. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 15: movimiento interno 40kg (doble vía, costo heredado).
  try {
    const r = await registrarMovimiento(page, QA_TRASLADO.cantidad);
    log({ fase: F, paso: '15. movimientoInterno(40kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.movimientoId = r.id;
  } catch (e) { log({ fase: F, paso: '15. movimientoInterno', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 50, 25));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 40, 25));
  } catch (e) { log({ fase: F, paso: '15. validarStock doble vía', ok: false, error: String(e) }); }

  // Caso 16: guía interna documentaria (sin SUNAT): relectura + inmutabilidad.
  try {
    const r: { ok: boolean; error?: string } = await page.evaluate(async (id) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('MovimientoResource');
        const resp = await R.obtenerMovimiento(id);
        if (Number(resp.tipo) === 1) return { ok: true };
        return { ok: false, error: (resp.mensajes || []).join('; ') };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, estado.movimientoId!);
    log({ fase: F, paso: '16. guiaInterna documentaria (relectura)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '16. guiaInterna', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 50, 25));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 40, 25));
  } catch (e) { log({ fase: F, paso: '16. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 17: negativa por emulación (200kg > 50kg). Jamás se envía el guardado.
  try {
    const r = await emularExceso(page, QA_TRASLADO.cantidadExceso);
    const ok = r.restringido === true;
    log({ fase: F, paso: '17. emularExceso(200kg) debe restringir', ok, real: 'restringido=' + r.restringido, error: ok ? undefined : (r.error || 'El emulador no marcó restricción (revisar config 76).') });
  } catch (e) { log({ fase: F, paso: '17. emularExceso', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 50, 25));
  } catch (e) { log({ fase: F, paso: '17. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 18: salida 35kg en Sucursal (costo congelado).
  try {
    const r = await registrarSalidaSucursal(page, QA_TRASLADO.salidaSucursal);
    log({ fase: F, paso: '18. salidaSucursal(35kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '18. salidaSucursal', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 5, 25));
  } catch (e) { log({ fase: F, paso: '18. validarStock 5/25', ok: false, error: String(e) }); }

}

/** Entrada standalone: npm run test:bloque3. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(process.env.BLOQUE3_LIMPIAR === '1');
  await runBloque3(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque3.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque3.pdf'), resumen);
  console.log('\n== Bloque 3 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
