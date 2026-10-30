// aprovisionamiento.spec.ts — Bloque 1 de la Matriz Masiva (casos 1-9).
// Suite nueva desde cero. Ejecutar: npx ts-node src/e2e/aprovisionamiento.spec.ts
// Patrones: AI_CONTEXT (scope-walk, $timeout, cerrarModales) + BLUEPRINT (endpoints).

import * as path from 'path';
import { Page } from 'playwright';
import { crearInsumo, navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { registrarCompra, anularCompra, registrarNotaCredito } from '../compras';
import { obtenerEstadoGlobal } from '../kardex';
import { FilaReporte } from '../types';
import { QA, QA_EXONERADO, QA_TRASLADO, EstadoSuite, ppp, pppSin, precioSin } from './fixtures';
import { assertStockInsumo } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag, DEBUG } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 1: Aprovisionamiento';

// ---------------------------------------------------------------------------
// Casos 2-3 y 9: Solicitud / Orden de Compra vía resources (endpoints verificados
// en resource.requerimientocompra.js y resource.ordencompra.js).
// TODO(first-run): confirmar el shape del payload contra nuevaSolicitudCtrl /
// nuevaOrdenCompraCtrl si el backend rechaza campos.
// ---------------------------------------------------------------------------

// Diagnóstico first-run: cada helper devuelve el JSON crudo del backend
// (tipo/mensajes/data) más el payload enviado, y lo imprime a consola.
// Si PHP rechaza por un campo faltante, el log trae el literal exacto.
export interface RespuestaBackend {
  ok: boolean;
  id?: number;
  error?: string;
  raw?: { tipo?: unknown; mensajes?: unknown; data?: unknown };
  payload?: unknown;
}

function dump(tag: string, r: RespuestaBackend): void {
  console.log(
    '[DIAG ' + tag + '] payload=' + JSON.stringify(r.payload) +
    ' | resp=' + JSON.stringify(r.raw) +
    (r.error ? ' | error=' + r.error : ''),
  );
}

export async function registrarSolicitud(page: Page, nombre: string, insumoId: number, cantidad: number): Promise<RespuestaBackend> {
  const endpoint = esperarEndpoint(page, 'compra/requerimientocompra/registrar', 45000).catch(() => null);
  let r: RespuestaBackend;
  try {
    // Shape calcado de obtenerObjEnviar() en nuevo.requerimiento.compra.controller.js:225-261
    // + _genererarDetalleCompra() en models/requerimientocompra.js:700-755.
    r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('RequerimientocompraResource');
        const SecurityService = injector.get('SecurityService');
        const CommonCollection = injector.get('CommonCollection');
        const PARAM = injector.get('PARAM');
        const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
        const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
        const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
        const almacenes = (respAlm && respAlm.data) || [];
        const almacen = almacenes[0] || { almacen_id: 1 };
        const manana = new Date(Date.now() + 86400000);
        const f = (n: number): string => String(n).padStart(2, '0');
        const fechaEntrega = manana.getFullYear() + '-' + f(manana.getMonth() + 1) + '-' + f(manana.getDate());
        const busq = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (busq && busq.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return { ok: false, error: 'Item no encontrado para solicitud: ' + args.nombre };
        const detalle = {
          detallerequerimientocompra_descripcion: item.item_descripcion,
          detallerequerimientocompra_unidadmedida: item.unidadmedidainsumo_descripcion || '',
          detallerequerimientocompra_precio: 0,
          detallerequerimientocompra_costo: 0,
          detallerequerimientocompra_afectoimpuesto: false,
          detallerequerimientocompra_importe: 0,
          detallerequerimientocompra_cantidad: args.cantidad,
          requerimientocompra_id: '-1',
          tipo: item.item_tipo,
          unidadmedidainsumo: item.unidadmedidainsumo_id || null,
          costoUltimaCompra: 0,
          almacenSeleccionado: almacen,
          almacen_id: almacen.almacen_id,
          insumo_id: item.item_tipo === 2 ? null : item.item_id,
          producto_id: item.item_tipo === 2 ? item.item_id : null,
          producto_codigo: item.item_codigo,
          presentacioninsumo_id: item.item_presentacionid || null,
          presentacioninsumo_cantidad: 1,
        };
        const payload = {
          local_id: local.local_id,
          almacen_id: almacen.almacen_id,
          usuario_id: SecurityService.getUsuarioId(),
          requerimientocompra_fechaentrega: fechaEntrega,
          detallerequerimientocompraList: [detalle],
        };
        const resp = await R.registrar(payload);
        const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
        if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
        return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { nombre, insumoId, cantidad });
  } catch (e) {
    r = { ok: false, error: 'Fallo page.evaluate: ' + String(e) };
  }
  dump('Solicitud', r);
  try {
    const resp = await endpoint;
    const net = await leerRespuesta(resp);
    diag('[DIAG Solicitud] red=' + JSON.stringify(net.json));
  } catch (e) {
    diag('[DIAG Solicitud] sin respuesta de red (timeout?): ' + String(e));
  }
  return r;
}

export async function registrarOrdenCompra(page: Page, nombre: string, insumoId: number, cantidad: number, costo: number, proveedor: string): Promise<RespuestaBackend> {
  const endpoint = esperarEndpoint(page, 'ordencompra/registrarOrdencompra', 45000).catch(() => null);
  let r: RespuestaBackend;
  try {
    // Shape calcado de nueva.orden.compra.controller.js:736-786 (objEnvio.ordencompra + objEnvio.productos)
    // + _genererarDetalleOrdencompra() en models/ordencompra.js:668-746.
    // El 500 "__clone method called on non-object" era por enviar el payload plano sin `ordencompra`.
    r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('OrdencompraResource');
        const CommonCollection = injector.get('CommonCollection');
        const SecurityService = injector.get('SecurityService');
        const PARAM = injector.get('PARAM');
        const prov = await CommonCollection.obtenerProveedorPorBusqueda(args.proveedor);
        let proveedorSel: any = null;
        if (prov && prov.data && prov.data.length) {
          proveedorSel = prov.data[0];
        } else {
          // Backend PHP 8.5 no resuelve el proveedor por búsqueda; usar el
          // proveedor creado al inicio por el bot (id=87).
          proveedorSel = { proveedor_id: 87, proveedor_razonsocial: args.proveedor, proveedor_diaspago: 0, proveedor_tipoperiodopago: '1', proveedor_primerdiapago: 0 };
        }
        const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
        const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
        const respMon = await CommonCollection.obtenerListaMonedasPorLocal(local.local_id).catch(() => null);
        const monedas = (respMon && respMon.data) || [];
        const moneda = monedas[0] || { moneda_id: 1, moneda_tipocambio_compra: 1 };
        const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(local.local_id, PARAM.ESTADO.ACTIVO, PARAM.ESTADO.INACTIVO, PARAM.ESTADO.INACTIVO).catch(() => null);
        const almacenes = (respAlm && respAlm.data) || [];
        const almacen = almacenes[0] || { almacen_id: 1 };
        const busq = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (busq && busq.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return { ok: false, error: 'Item no encontrado para OC: ' + args.nombre };
        const producto = {
          item_id: item.item_id,
          item_tipo: item.item_tipo,
          item_subtipo: item.item_subtipo,
          item_descripcion: item.item_descripcion,
          presentacion_nombre: item.item_presentacion || '',
          detalleordencompra_descripcion: item.item_descripcion,
          detalleordencompra_unidadmedida: item.unidadmedidainsumo_descripcion || '',
          detalleordencompra_precio: args.costo,
          detalleordencompra_costo: args.costo,
          detalleordencompra_descuento: 0,
          detalleordencompra_afectoimpuestos: true,
          detalleordencompra_importe: args.costo * args.cantidad,
          detalleordencompra_cantidad: args.cantidad,
          ordencompra_id: '-1',
          tipo: item.item_tipo,
          unidadmedidainsumo: item.unidadmedidainsumo_id || null,
          costoUltimaOrdencompra: args.costo,
          almacenSeleccionado: almacen,
          almacen_id: almacen.almacen_id,
          insumo_id: item.item_tipo === 2 ? null : item.item_id,
          producto_id: item.item_tipo === 2 ? item.item_id : null,
          producto_codigo: item.item_codigo,
          presentacioninsumo_id: item.item_presentacionid || null,
          presentacioninsumo_cantidad: 1,
        };
        const manana = new Date(Date.now() + 86400000);
        const f = (n: number): string => String(n).padStart(2, '0');
        const payload = {
          ordencompra: {
            local_id: local.local_id,
            proveedor_id: proveedorSel.proveedor_id,
            moneda_id: moneda.moneda_id,
            ordencompra_tipocambio: moneda.moneda_tipocambio_compra,
            ordencompra_periodopago: proveedorSel.proveedor_diaspago,
            ordencompra_tipoperiodopago: proveedorSel.proveedor_tipoperiodopago,
            ordencompra_primerdiapago: proveedorSel.proveedor_primerdiapago,
            ordencompra_fecha: manana.getFullYear() + '-' + f(manana.getMonth() + 1) + '-' + f(manana.getDate()),
          },
          productos: [producto],
        };
        const resp = await R.agregar(payload);
        const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
        if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
        return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { nombre, insumoId, cantidad, costo, proveedor });
  } catch (e) {
    r = { ok: false, error: 'Fallo page.evaluate: ' + String(e) };
  }
  dump('OrdenCompra', r);
  try {
    const resp = await endpoint;
    const net = await leerRespuesta(resp);
    console.log('[DIAG OrdenCompra] red=' + JSON.stringify(net.json));
  } catch (e) {
    console.log('[DIAG OrdenCompra] sin respuesta de red (timeout?): ' + String(e));
  }
  // Auditoría estricta del detalle OC persistido (precio/cantidad/desgravación).
  if (r.ok && r.id !== undefined) {
    const { assertDetalleOC } = await import('./oracle');
    const a = await assertDetalleOC(r.id, costo, cantidad);
    console.log('[DIAG OrdenCompra-auditoria] ' + JSON.stringify({ ok: a.ok, error: a.error, real: a.real }));
    if (!a.ok) return { ok: false, error: a.paso + ': ' + (a.error || '') + ' | ' + (a.real || '') };
  }
  return r;
}

async function anularOrdenCompra(page: Page, id: number): Promise<{ ok: boolean; bloqueada?: boolean; error?: string }> {
  const endpoint = esperarEndpoint(page, 'ordencompra/anularOrdencompra', 45000).catch(() => null);
  const r: { ok: boolean; error?: string } = await page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdencompraResource');
      const resp = await R.anularOrdencompra(id);
      if (Number(resp.tipo) === 1) return { ok: true };
      return { ok: false, error: (resp.mensajes || []).join('; ') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, id);
  const resp = await endpoint;
  await leerRespuesta(resp);
  // Para el caso 9 el ÉXITO es el bloqueo: ok=false + mensaje de canje.
  if (!r.ok && /canjeada por una compra|procesada/i.test(r.error || '')) return { ok: true, bloqueada: true };
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: false, error: 'La OC se anuló cuando debía bloquearse (defecto).' };
}

// ---------------------------------------------------------------------------
// Casos 1-9
// ---------------------------------------------------------------------------

/** Casos 1-9. Reutilizable por la suite (sin browser/limpieza/reporte propios). */
export async function runBloque1(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);

  // Pre-flight: diagnosticar pestaña/sesión (el timeout del caso 1 suele ser tab sin login).
  try {
    const diagVista = await page.evaluate(() => {
      try {
        const injector = angular.element(document.body).injector();
        const $state = injector.get('$state');
        const SecurityService = injector.get('SecurityService');
        return {
          url: window.location.href,
          state: $state && $state.current ? $state.current.name : null,
          usuarioId: SecurityService ? SecurityService.getUsuarioId() : null,
          localId: SecurityService ? SecurityService.getLocalId() : null,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    diag('[DIAG Sesion] ' + JSON.stringify(diagVista));
  } catch (e) {
    diag('[DIAG Sesion] no se pudo diagnosticar: ' + String(e));
  }

  // Diagnóstico dirigido del timeout de crearInsumo (solo DEBUG=1; ya cumplió).
  if (!DEBUG) {
    diag('InsumoVista omitido (DEBUG=0)');
  } else
  try {
    await navegar(page, 'logistica.insumos.nuevo');
    await page.waitForTimeout(8000);
    const diagVista = await page.evaluate(async () => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        const $state = injector.get('$state');
        let found: any = null;
        (function walk(s: any): void {
          if (found) return;
          if (s.vm && typeof s.vm.registrarInsumo === 'function') { found = s; return; }
          let c = s.$$childHead;
          while (c) { walk(c); c = c.$$nextSibling; }
        })($rootScope);
        const out: any = { state: $state.current ? $state.current.name : null, foundVm: !!found };
        if (found) {
          out.um = (found.vm.listaUnidadesMedida || []).length;
          out.cat = (found.vm.listaCategoriainsumo || []).length;
          out.alm = (found.vm.insumo && found.vm.insumo.almacenes || []).length;
        }
        try {
          const Insumo = injector.get('Insumo');
          const r = await Insumo.obtenerUnidadmedidaList();
          out.probeUM = { tipo: r && r.tipo, n: r && r.data ? r.data.length : 0, msg: r && r.mensajes ? r.mensajes.slice(0, 2) : [] };
        } catch (e) {
          out.probeUM = { error: e instanceof Error ? e.message : String(e) };
        }
        return out;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    diag('[DIAG InsumoVista] ' + JSON.stringify(diagVista));
    await navegar(page, 'logistica.escritorio');
    await page.waitForTimeout(1000);
  } catch (e) {
    diag('[DIAG InsumoVista] no se pudo diagnosticar: ' + String(e));
  }

  // Caso 1: alta con 0 stock. crearInsumo usa 1 almacén; el 2do se controla al operar.
  try {
    const g = await obtenerEstadoGlobal(page);
    log({ fase: F, paso: '1. kardex.obtenerEstadoGlobal()', ok: true, real: JSON.stringify(g) });
  } catch (e) { log({ fase: F, paso: '1. kardex.obtenerEstadoGlobal()', ok: false, error: String(e) }); }
  try {
    // Control de stock en Central (1) y Produccion (18): los Bloques 3-8 trasladan
    // 'Carne QA' entre ambos almacenes y el oráculo lee cada uno por separado.
    const r = await crearInsumo(page, {
      nombre: QA.insumoCarne, stockApertura: 0, costoApertura: 0,
      almacen: QA.almacenCentral, almacenes: [String(QA_TRASLADO.almacenSucursalId)],
    });
    log({ fase: F, paso: "1. crearInsumo('Carne QA') 0kg", ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.insumoId = r.id;
  } catch (e) { log({ fase: F, paso: "1. crearInsumo('Carne QA')", ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumo(page, QA.insumoCarne, 0, 0, 0));
  } catch (e) { log({ fase: F, paso: '1. validarStock inicial', ok: false, error: String(e) }); }

  // Caso 2: solicitud 50kg (documento de intención, sin movimiento).
  try {
    const r = await registrarSolicitud(page, QA.insumoCarne, estado.insumoId!, QA.solicitudCantidad);
    log({ fase: F, paso: '2. registrarSolicitud(50kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.solicitudId = r.id;
  } catch (e) { log({ fase: F, paso: '2. registrarSolicitud', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 0, 0, 0)); } catch (e) { log({ fase: F, paso: '2. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 3: OC 50kg @20 (pacto, sin Kardex).
  try {
    const r = await registrarOrdenCompra(page, QA.insumoCarne, estado.insumoId!, QA.ocCantidad, QA.ocCosto, QA.proveedor);
    log({ fase: F, paso: '3. registrarOC(50kg@20)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.ordenCompraId = r.id;
  } catch (e) { log({ fase: F, paso: '3. registrarOC', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 0, 0, 0)); } catch (e) { log({ fase: F, paso: '3. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 4: compra canjeando la OC — 50@20. Primera entrada: PPP=20.
  // TODO(first-run): confirmar campo de canje compra->OC (se envía ordencompra_id por extra).
  // Referencia: el detalle backend se arma con vm.compra.obtenerFormatoDetalleCompraBackend()
  // (ver compras.ts: se regenera tras procesarDatosCompra); aquí solo se loguea el vínculo.
  if (estado.ordenCompraId === undefined) {
    log({ fase: F, paso: '4. registrarCompra canje OC (50@20)', ok: false, error: 'Bloqueado: sin OC del caso 3, no se envía canje [null].' });
  } else
  try {
    const { registrarCompra: rc } = await import('../compras');
    // Vínculo compra->OC: el input debe traer `compra_ordencompraList[]`
    // (CompraLogistica.php:294-295 lo copia a listaOrdenesCompra) y
    // actualizarOrdenesCompras() setea ordencompra.compra_id + PROCESADA
    // (:659-662, :1246-1260). Ni `ordencompra_id` ni `listaOrdenesCompra`
    // planos los lee el parser del backend.
    const canje = { compra_ordencompraList: [estado.ordenCompraId] };
    diag('[DIAG CanjeOC] vínculo enviado por extra=' + JSON.stringify(canje) +
      ' | ocId=' + estado.ordenCompraId);
    const r = await rc(page, {
      serie: 'F001', numero: 'QA-1', proveedor: QA.proveedor,
      detalle: [{ nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA.compra1.cantidad, precio: QA.compra1.precio, verificarSinImpuestos: true }],
      estado: { extra: canje as never },
    });
    diag('[DIAG CanjeOC] resultado ok=' + r.ok + ' id=' + (r as { idGenerado?: number }).idGenerado +
      (r.error ? ' error=' + r.error : ''));
    // Verificación del vínculo: la OC debe quedar canjeada (compra_id seteado).
    try {
      const ocCheck: { compra_id?: number; estado?: unknown } | null = await page.evaluate(async (id) => {
        try {
          const injector = angular.element(document.body).injector();
          const R = injector.get('OrdencompraResource');
          const resp = await R.obtenerOrdencompra(id);
          const d = resp && resp.data ? resp.data : null;
          const cab = d && d.ordencompra ? d.ordencompra : d;
          return cab ? { compra_id: cab.compra_id, estado: cab.ordencompra_estado } : null;
        } catch { return null; }
      }, estado.ordenCompraId!);
      diag('[DIAG CanjeOC] estado OC tras compra=' + JSON.stringify(ocCheck));
    } catch (e) {
      diag('[DIAG CanjeOC] no se pudo leer la OC: ' + String(e));
    }
    log({ fase: F, paso: '4. registrarCompra canje OC (50@20)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.compra1 = r.id;
  } catch (e) {
    diag('[DIAG CanjeOC] excepción: ' + String(e));
    log({ fase: F, paso: '4. registrarCompra', ok: false, error: String(e) });
  }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 50, 20, precioSin(20, true))); } catch (e) { log({ fase: F, paso: '4. validarStock', ok: false, error: String(e) }); }

  // Caso 5: segunda compra 50@30 → PPP=(50*20+50*30)/100=25.
  const ppp5 = ppp(50, 20, QA.compra2.cantidad, QA.compra2.precio);
  try {
    const r = await registrarCompra(page, {
      serie: 'F001', numero: 'QA-2', proveedor: QA.proveedor,
      detalle: [{ nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA.compra2.cantidad, precio: QA.compra2.precio, verificarSinImpuestos: true }],
    });
    log({ fase: F, paso: '5. registrarCompra (50@30)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.compra2 = r.id;
  } catch (e) { log({ fase: F, paso: '5. registrarCompra', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 100, ppp5, pppSin(50, precioSin(20, true), QA.compra2.cantidad, precioSin(30, true)))); } catch (e) { log({ fase: F, paso: '5. validarStock PPP=25', ok: false, error: String(e) }); }

  // Caso 6: NC cantidad 10 sobre compra2 → resta, costo congelado en 25.
  try {
    const r = await registrarNotaCredito(page, estado.compra2!, [{ nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA.ncDevolucion }]);
    log({ fase: F, paso: '6. notaCredito devuelve 10', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '6. notaCredito', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 90, 25, pppSin(50, precioSin(20, true), QA.compra2.cantidad, precioSin(30, true)))); } catch (e) { log({ fase: F, paso: '6. validarStock 90/25', ok: false, error: String(e) }); }

  // Caso 7: tercera compra 20@50 → PPP=(90*25+20*50)/110=29.545.
  const ppp7 = ppp(90, 25, QA.compra3.cantidad, QA.compra3.precio);
  try {
    const r = await registrarCompra(page, {
      serie: 'F001', numero: 'QA-3', proveedor: QA.proveedor,
      detalle: [{ nombre: QA.insumoCarne, insumoId: estado.insumoId, cantidad: QA.compra3.cantidad, precio: QA.compra3.precio, verificarSinImpuestos: true }],
    });
    log({ fase: F, paso: '7. registrarCompra (20@50)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.compra3 = r.id;
  } catch (e) { log({ fase: F, paso: '7. registrarCompra', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 110, Math.round(ppp7 * 1000) / 1000, pppSin(90, pppSin(50, precioSin(20, true), QA.compra2.cantidad, precioSin(30, true)), QA.compra3.cantidad, precioSin(50, true)))); } catch (e) { log({ fase: F, paso: '7. validarStock PPP=29.545', ok: false, error: String(e) }); }

  // Caso 8: anular última (LIFO) → vuelve a 90/25.
  try {
    const r = await anularCompra(page, estado.compra3!, true);
    log({ fase: F, paso: '8. anularCompra(3) LIFO', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '8. anularCompra', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 90, 25, pppSin(50, precioSin(20, true), QA.compra2.cantidad, precioSin(30, true)))); } catch (e) { log({ fase: F, paso: '8. validarStock 90/25', ok: false, error: String(e) }); }

  // Caso 9: negativa — anular OC con compra vigente debe BLOQUEARSE.
  try {
    await cerrarModales(page);
    const r = await anularOrdenCompra(page, estado.ordenCompraId!);
    log({ fase: F, paso: '9. anularOC con compra vigente (debe bloquear)', ok: r.ok, real: r.bloqueada ? 'bloqueada por el sistema' : undefined, error: r.bloqueada ? undefined : r.error });
  } catch (e) { log({ fase: F, paso: '9. anularOC', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA.insumoCarne, 90, 25, pppSin(50, precioSin(20, true), QA.compra2.cantidad, precioSin(30, true)))); } catch (e) { log({ fase: F, paso: '9. validarStock sin cambio', ok: false, error: String(e) }); }

  // Casos 9A-9B: contraste sin impuestos (exonerado). Los existentes quedan afectos.
  // Costo con y sin impuestos matemáticamente idénticos.
  try {
    const r = await crearInsumo(page, { nombre: QA_EXONERADO.nombre, stockApertura: 0, costoApertura: 0, almacen: QA.almacenCentral });
    log({ fase: F, paso: "9A. crearInsumo('Exonerado QA') 0kg", ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.exoneradoId = r.id;
  } catch (e) { log({ fase: F, paso: '9A. crearInsumo exonerado', ok: false, error: String(e) }); }
  try {
    const r = await registrarCompra(page, {
      serie: 'F001', numero: 'QA-EX1', proveedor: QA.proveedor,
      detalle: [{ nombre: QA_EXONERADO.nombre, insumoId: estado.exoneradoId, cantidad: QA_EXONERADO.compra.cantidad, precio: QA_EXONERADO.compra.precio, afectoIgv: false, verificarSinImpuestos: true }],
    });
    log({ fase: F, paso: '9B. compra exonerada (10@10 sin IGV)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '9B. compra exonerada', ok: false, error: String(e) }); }
  try { val(await assertStockInsumo(page, QA_EXONERADO.nombre, 10, 10, 10)); } catch (e) { log({ fase: F, paso: '9B. validarStock 10/10/10', ok: false, error: String(e) }); }

}

/** Entrada standalone: npm run test:bloque1. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(true);
  await runBloque1(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque1.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque1.pdf'), resumen);
  console.log('\n== Bloque 1 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
