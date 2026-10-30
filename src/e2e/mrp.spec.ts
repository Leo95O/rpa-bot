// mrp.spec.ts — Bloque 5 de la Matriz Masiva (casos 21-28).
// Ejecutar: npm run test:bloque5. PRECONDICIÓN: cierre del Bloque 4
// (Central 45/25, Sucursal 8/30). NO limpia BD (matriz acumulativa).
//
// Desviaciones honestas vs la matriz (ver código citado):
// - "Freno de Seguridad" no existe como literal; la regla real es que solo una
//   OP APROBADA (4) puede prepararse (verordenproduccion.controller.js:709-718).
// - Los desvíos no son automáticos: interno = GET generarOrdenMovimiento/{id},
//   externo = solicitud de compra (se ejecuta con registrarSolicitud).

import * as path from 'path';
import { Page } from 'playwright';
import { crearInsumo, crearReceta, navegar, esperarEndpoint, leerRespuesta, cerrarModales } from '../bot';
import { registrarCompra } from '../compras';
import { FilaReporte } from '../types';
import { QA, QA_TRASLADO, QA_MRP, EstadoSuite } from './fixtures';
import { assertStockInsumoEnAlmacen, unidadBaseInsumo } from './oracle';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, logVeredicto, abrirStandalone, diag } from './harness';
import { registrarSolicitud, registrarOrdenCompra } from './aprovisionamiento.spec';
import { registrarMovimiento } from './traslados.spec';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 5: MRP';

function ahora(dias = 0): string {
  const d = new Date(Date.now() + dias * 86400000);
  const f = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + f(d.getMonth() + 1) + '-' + f(d.getDate()) + ' ' + f(d.getHours()) + ':' + f(d.getMinutes()) + ':' + f(d.getSeconds());
}

export async function crearOP(page: Page, insumoId: number, cantidad: number, almacenId: number, opts?: { requerimientoId?: number }): Promise<{ ok: boolean; id?: number; error?: string; raw?: unknown }> {
  const umId = (await unidadBaseInsumo(insumoId)) ?? 1;
  const endpoint = esperarEndpoint(page, 'produccion/ordenproduccion/agregar', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdenproduccionResource');
      const CommonCollection = injector.get('CommonCollection');
      const SecurityService = injector.get('SecurityService');
      const locales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(SecurityService.getUsuarioId());
      const local = (locales && locales.data && locales.data[0]) || { local_id: 1 };
      const payload = {
        local_id: local.local_id,
        almacen_id: null,
        // Canje requerimiento→OP (vieneDeUnRequerimiento, OrdenproduccionLogistica:1315).
        ...(args.requerimientoId ? { requerimientomovimiento_id: args.requerimientoId } : {}),
        ordenproduccion_fechaestamada: args.fecha,
        ordenproduccion_fechaproduccion: args.fecha,
        ordenproduccion_encargado: args.encargado,
        ordenproduccion_estado: 0,
        detalleordenproduccionList: [{
          almacen_id: args.almacenId,
          insumo_id: args.insumoId,
          unidadmedidainsumo_id: args.umId,
          detalleordenproduccion_cantidadestimada: args.cantidad,
          // Sin estado explícito: el backend asigna el default. Enviarlo
          // activa la rama con el bindParam faltante (HY093, DetalleordenproduccionEntity:281-312).
        }],
      };
      const resp = await R.agregar(payload);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, id: Number(resp.data), raw, payload };
      return { ok: false, error: (resp.mensajes || []).join('; '), raw, payload };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { insumoId, umId, cantidad, almacenId, requerimientoId: opts?.requerimientoId, encargado: QA_MRP.encargado, fecha: ahora() });
  diag('[DIAG OP] ' + JSON.stringify({ ok: r.ok, id: (r as { id?: number }).id, error: r.error, raw: (r as { raw?: unknown }).raw }));
  try {
    const resp = await endpoint;
    diag('[DIAG OP] red=' + JSON.stringify((await leerRespuesta(resp)).json));
  } catch (e) { diag('[DIAG OP] sin red: ' + String(e)); }
  return r;
}

/**
 * Mensaje legible de una respuesta fallida del Resource. Ante un HTTP 500,
 * `UtilityService.parseError` deja `tipo=500, mensajes=[statusText, errorHttp]`
 * y la causa real viene en el HTML de Slim ("Message: SQLSTATE[42S02]...").
 * Sin esto el reporte mostraba "[object Object]" o un veredicto engañoso.
 * El evaluate debe mapear antes cada mensaje no-string a su `.data` (HTML).
 */
export function describirFallo(tipo: unknown, mensajes: string[] | undefined): string {
  const textos = (mensajes || []).map((m) => {
    const slim = /Message:<\/strong>\s*([^<]+)/.exec(m);
    return slim ? slim[1].trim() : m.slice(0, 200);
  }).filter((m) => m);
  return 'tipo=' + tipo + ': ' + (textos.join('; ') || 'sin detalle');
}

/**
 * Faltantes reales: `obtenerParaAbastecer` devuelve la OP con `itemPorAbastecer[]`
 * cuyos items llevan `item_cantidad` (NO claves *faltante*: esas solo existen en
 * ToolInsumos internos). Se extrae esa lista con precisión en vez de escanear.
 */
function numerosFaltante(raw: unknown): number[] {
  const out: number[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') {
      const rec = n as Record<string, unknown>;
      if (Array.isArray(rec.itemPorAbastecer)) {
        for (const it of rec.itemPorAbastecer as Array<Record<string, unknown>>) {
          const num = Number(it.item_cantidad);
          if (!Number.isNaN(num) && num > 0) {
            out.push(num);
            const id = Number(it.insumo_id ?? it.producto_id ?? 0);
            if (id > 0) out.push(-id); // marcador de identidad (negativo para no confundir)
          }
        }
      }
      for (const [k, v] of Object.entries(rec)) {
        if (/faltante/i.test(k) || k === 'cantidadproducir') {
          const num = Number(v);
          if (!Number.isNaN(num) && num > 0) out.push(num);
        }
        if (k !== 'itemPorAbastecer') walk(v);
      }
    }
  };
  walk(raw);
  return out.filter((x) => x > 0);
}

async function evaluarFaltantes(page: Page, opId: number): Promise<{ ok: boolean; faltantes: number[]; error?: string; raw?: unknown }> {
  // obtenerInsumoRecetaFaltanteParaProducir SOLO explota sub-recetas/derivados
  // (continue en InsumoLogistica.php:6820-6822): para ingredientes planos siempre
  // da []. El endpoint correcto es obtenerParaAbastecer (ToolInsumos).
  const endpoint = esperarEndpoint(page, 'obtenerParaAbastecer', 45000).catch(() => null);
  const r = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdenproduccionResource');
      const resp = await R.obtenerParaAbastecer(args.id, args.almacenId, '1');
      if (Number(resp.tipo) !== 1) {
        const mensajes = (resp.mensajes || []).map((m: any) => typeof m === 'string' ? m : String((m && m.data) || ''));
        return { ok: false, tipo: resp.tipo, mensajes };
      }
      return { ok: true, raw: resp.data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { id: opId, almacenId: QA_TRASLADO.almacenSucursalId });
  const rawObj = (r && (r as { raw?: unknown }).raw) || null;
  const items = rawObj && typeof rawObj === 'object' && Array.isArray((rawObj as { itemPorAbastecer?: unknown[] }).itemPorAbastecer)
    ? ((rawObj as { itemPorAbastecer: Array<{ insumo_id?: number; producto_id?: number; item_cantidad?: number }> }).itemPorAbastecer || [])
      .map((it) => ({ id: it.insumo_id ?? it.producto_id, cant: it.item_cantidad })) : [];
  diag('[DIAG Faltantes] op=' + opId + ' porAbastecer=' + JSON.stringify(items));
  try {
    const resp = await endpoint;
    await leerRespuesta(resp);
  } catch { /* solo diagnóstico */ }
  if (!r.ok) {
    const f = r as { error?: string; tipo?: unknown; mensajes?: string[] };
    return { ok: false, faltantes: [], error: 'obtenerParaAbastecer falló: ' + (f.error || describirFallo(f.tipo, f.mensajes)) };
  }
  return { ok: true, faltantes: numerosFaltante((r as { raw?: unknown }).raw), raw: (r as { raw?: unknown }).raw };
}

async function generarDesvioInterno(page: Page, opId: number): Promise<{ ok: boolean; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'generarOrdenMovimiento', 45000).catch(() => null);
  const r = await page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdenproduccionResource');
      const resp = await R.generarOrdenMovimiento(id);
      const mensajes = (resp.mensajes || []).map((m: any) => typeof m === 'string' ? m : String((m && m.data) || ''));
      const raw = { tipo: resp.tipo, mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, raw };
      return { ok: false, raw };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, opId);
  const raw = (r as { raw?: { tipo: unknown; mensajes: string[] } }).raw;
  const error = r.ok ? undefined : ((r as { error?: string }).error || describirFallo(raw?.tipo, raw?.mensajes));
  diag('[DIAG DesvioInt] ' + JSON.stringify({ ok: r.ok, error }).slice(0, 2000));
  try {
    const resp = await endpoint;
    await leerRespuesta(resp);
  } catch { /* solo diagnóstico */ }
  return { ok: r.ok, error, raw };
}

/**
 * Lee la cabecera de la OP. Si el endpoint falla (p. ej. HTTP 500) devuelve
 * `error` con la causa y SIN `raw`: antes devolvía `estado=undefined, raw=null`
 * y los llamadores reportaban "no está pendiente" o reventaban leyendo null.
 */
export async function consultarOP(page: Page, opId: number): Promise<{ estado?: number; error?: string; raw?: unknown }> {
  const r = await page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdenproduccionResource');
      const resp = await R.obtener(id);
      if (Number(resp.tipo) !== 1 || !resp.data) {
        const mensajes = (resp.mensajes || []).map((m: any) => typeof m === 'string' ? m : String((m && m.data) || ''));
        return { tipo: resp.tipo, mensajes };
      }
      const d = resp.data;
      const cab = d.ordenproduccion ? d.ordenproduccion : d;
      return { estado: Number(cab.ordenproduccion_estado), raw: cab };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, opId);
  const f = r as { estado?: number; raw?: unknown; error?: string; tipo?: unknown; mensajes?: string[] };
  if (f.raw !== undefined) return { estado: f.estado, raw: f.raw };
  return { error: 'obtener OP #' + opId + ' falló: ' + (f.error || describirFallo(f.tipo, f.mensajes)) };
}

async function aprobarOP(page: Page, opId: number): Promise<{ ok: boolean; error?: string; raw?: unknown }> {
  const endpoint = esperarEndpoint(page, 'ordenproduccion/aprobar', 45000).catch(() => null);
  const r = await page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const R = injector.get('OrdenproduccionResource');
      const resp = await R.aprobar(id);
      const raw = { tipo: resp.tipo, mensajes: resp.mensajes, data: resp.data };
      if (Number(resp.tipo) === 1) return { ok: true, raw };
      const msgs = Array.isArray(resp.mensajes)
        ? resp.mensajes.map((m: any) => typeof m === 'string' ? m : 'HTTP ' + (m && m.status)).join('; ')
        : String(resp.mensajes || '');
      return { ok: false, error: msgs, raw: { tipo: resp.tipo } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, opId);
  diag('[DIAG AprobarOP] ' + JSON.stringify({ ok: r.ok, error: r.error }));
  try {
    const resp = await endpoint;
    await leerRespuesta(resp);
  } catch { /* solo diagnóstico */ }
  return r;
}

/** Casos 21-28. */
export async function runBloque5(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
    logVeredicto(reporte, F, v);
  await navegar(page, 'logistica.escritorio');
  await page.waitForTimeout(500);

  // Precondición Bloque 4. Fail-fast: sin esto todo el bloque pagaría timeouts.
  try {
    const pc1 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 45, 25);
    val(pc1);
    const pc2 = await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 8, 30);
    val(pc2);
    if (!pc1.ok || !pc2.ok) {
      log({ fase: F, paso: 'Bloque 5 abortado: sin estado del Bloque 4', ok: false, error: 'Precondición fallida.' });
      return;
    }
  } catch (e) {
    log({ fase: F, paso: 'precondición Bloque 4', ok: false, error: String(e) });
    return;
  }

  // Setup MRP: recetas 1:1 en la UM base del insumo (1 plato = 1 unidad de carne).
  // Sin esto la explosión no encuentra ingredientes (fallos 22/27 de la corrida anterior).
  try {
    const r = await crearReceta(page, {
      nombre: QA_MRP.plato,
      ingredientes: [{ insumoId: estado.insumoId!, cantidad: 1, umId: (await unidadBaseInsumo(estado.insumoId!)) ?? 1 }],
    });
    log({ fase: F, paso: "21. crearReceta('Plato QA') 1:1", ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.platoId = r.id;
  } catch (e) { log({ fase: F, paso: '21. crearReceta', ok: false, error: String(e) }); }

  // Caso 21: OP 5 platos (5kg, cabe en Sucursal 8kg) → sin faltantes, sin desvío.
  try {
    const r = await crearOP(page, estado.platoId!, QA_MRP.op1Cantidad, QA_TRASLADO.almacenSucursalId);
    log({ fase: F, paso: '21. crearOP(5kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.op1 = r.id;
  } catch (e) { log({ fase: F, paso: '21. crearOP', ok: false, error: String(e) }); }
  try {
    const ev = await evaluarFaltantes(page, estado.op1!);
    const ok = ev.ok && ev.faltantes.length === 0;
    log({ fase: F, paso: '21. sin faltantes ni desvío', ok, real: 'faltantes=' + JSON.stringify(ev.faltantes), error: ok ? undefined : (ev.error || 'Se reportaron faltantes.') });
  } catch (e) { log({ fase: F, paso: '21. evaluarFaltantes', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 8, 30));
  } catch (e) { log({ fase: F, paso: '21. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 22: OP 20 platos (faltante 12kg) + desvío interno.
  try {
    const r = await crearOP(page, estado.platoId!, QA_MRP.op2Cantidad, QA_TRASLADO.almacenSucursalId);
    log({ fase: F, paso: '22. crearOP(20kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.op2 = r.id;
  } catch (e) { log({ fase: F, paso: '22. crearOP', ok: false, error: String(e) }); }
  try {
    const ev = await evaluarFaltantes(page, estado.op2!);
    const ok = ev.ok && ev.faltantes.some((n) => Math.abs(n - 12) < 0.01);
    log({ fase: F, paso: '22. faltante 12kg detectado', ok, real: 'faltantes=' + JSON.stringify(ev.faltantes), error: ok ? undefined : (ev.error || 'Faltante 12kg no detectado.') });
  } catch (e) { log({ fase: F, paso: '22. evaluarFaltantes', ok: false, error: String(e) }); }
  try {
    const r = await generarDesvioInterno(page, estado.op2!);
    log({ fase: F, paso: '22. desvioInterno genera OM(12kg)', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '22. desvioInterno', ok: false, error: String(e) }); }

  // Caso 23: negativa — OP sigue PENDIENTE (no aprobada): no se ejecuta, nada se descuenta.
  try {
    const c = await consultarOP(page, estado.op2!);
    const ok = c.estado !== undefined && c.estado !== 4;
    log({ fase: F, paso: '23. OP pendiente bloquea preparación', ok, real: 'estado=' + c.estado, error: ok ? undefined : (c.error || 'La OP no está pendiente.') });
  } catch (e) { log({ fase: F, paso: '23. consultarOP', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 45, 25));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 8, 30));
  } catch (e) { log({ fase: F, paso: '23. validarStock sin cambio', ok: false, error: String(e) }); }

  // Caso 24: movimiento del desvío (12kg). Sucursal: (8*30+12*25)/20=27.
  try {
    const r = await registrarMovimiento(page, 12);
    log({ fase: F, paso: '24. movimientoDesvio(12kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  } catch (e) { log({ fase: F, paso: '24. movimientoDesvio', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenCentral, 33, 25));
    val(await assertStockInsumoEnAlmacen(page, QA.insumoCarne, QA_TRASLADO.almacenSucursal, 20, 27));
  } catch (e) { log({ fase: F, paso: '24. validarStock 33/20', ok: false, error: String(e) }); }

  // Caso 25: aprobar OP → APROBADA(4), freno liberado.
  try {
    const r = await aprobarOP(page, estado.op2!);
    log({ fase: F, paso: '25. aprobarOP', ok: r.ok, error: r.error });
  } catch (e) { log({ fase: F, paso: '25. aprobarOP', ok: false, error: String(e) }); }
  try {
    const c = await consultarOP(page, estado.op2!);
    const ok = c.estado === 4;
    log({ fase: F, paso: '25. OP aprobada (freno liberado)', ok, real: 'estado=' + c.estado, error: ok ? undefined : (c.error || 'No quedó aprobada.') });
  } catch (e) { log({ fase: F, paso: '25. consultarOP', ok: false, error: String(e) }); }

  // Caso 26: alta del importado.
  try {
    const r = await crearInsumo(page, { nombre: QA_MRP.importado, stockApertura: 0, costoApertura: 0, almacen: QA.almacenCentral });
    log({ fase: F, paso: "26. crearInsumo('Importado QA') 0kg", ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.importadoId = r.id;
  } catch (e) { log({ fase: F, paso: '26. crearInsumo', ok: false, error: String(e) }); }

  // Caso 27: OP 80 platos importados (faltante total) + desvío externo = solicitud 80kg.
  try {
    const rp = await crearReceta(page, {
      nombre: QA_MRP.platoImportado,
      ingredientes: [{ insumoId: estado.importadoId!, cantidad: 1, umId: (await unidadBaseInsumo(estado.importadoId!)) ?? 1 }],
    });
    log({ fase: F, paso: "27. crearReceta('Plato Importado QA') 1:1", ok: rp.ok, real: rp.id !== undefined ? 'id=' + rp.id : undefined, error: rp.error });
    if (rp.ok) estado.platoImportadoId = rp.id;
  } catch (e) { log({ fase: F, paso: '27. crearReceta', ok: false, error: String(e) }); }
  try {
    const r = await crearOP(page, estado.platoImportadoId!, QA_MRP.importadoCantidad, QA_TRASLADO.almacenSucursalId);
    log({ fase: F, paso: '27. crearOP importado(80kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.opImportado = r.id;
  } catch (e) { log({ fase: F, paso: '27. crearOP', ok: false, error: String(e) }); }
  try {
    const ev = await evaluarFaltantes(page, estado.opImportado!);
    const ok = ev.ok && ev.faltantes.some((n) => Math.abs(n - 80) < 0.01);
    log({ fase: F, paso: '27. faltante 80kg detectado', ok, real: 'faltantes=' + JSON.stringify(ev.faltantes), error: ok ? undefined : (ev.error || 'Faltante 80kg no detectado.') });
  } catch (e) { log({ fase: F, paso: '27. evaluarFaltantes', ok: false, error: String(e) }); }
  try {
    const r = await registrarSolicitud(page, QA_MRP.importado, estado.importadoId!, QA_MRP.importadoCantidad);
    log({ fase: F, paso: '27. desvioExterno solicitud(80kg)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.solicitudImportadoId = r.id;
  } catch (e) { log({ fase: F, paso: '27. desvioExterno', ok: false, error: String(e) }); }

  // Caso 28: recepción del desvío (solicitud→OC→compra 80@15 en Central).
  try {
    const oc = await registrarOrdenCompra(page, QA_MRP.importado, estado.importadoId!, QA_MRP.importadoCantidad, QA_MRP.importadoCosto, QA.proveedor);
    log({ fase: F, paso: '28. OC importado(80@15)', ok: oc.ok, real: oc.id !== undefined ? 'id=' + oc.id : undefined, error: oc.error });
    if (oc.ok) estado.ocImportadoId = oc.id;
  } catch (e) { log({ fase: F, paso: '28. OC importado', ok: false, error: String(e) }); }
  try {
    const { registrarCompra } = await import('../compras');
    const r = await registrarCompra(page, {
      serie: 'F001', numero: 'QA-I1', proveedor: QA.proveedor,
      detalle: [{ nombre: QA_MRP.importado, insumoId: estado.importadoId, cantidad: QA_MRP.importadoCantidad, precio: QA_MRP.importadoCosto }],
      estado: { extra: { compra_ordencompraList: [estado.ocImportadoId!] } as never },
    });
    log({ fase: F, paso: '28. compra importado(80@15)', ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (r.ok) estado.compraImportadoId = r.id;
  } catch (e) { log({ fase: F, paso: '28. compra importado', ok: false, error: String(e) }); }
  try {
    val(await assertStockInsumoEnAlmacen(page, QA_MRP.importado, QA_TRASLADO.almacenCentral, 80, 15));
  } catch (e) { log({ fase: F, paso: '28. validarStock 80/15', ok: false, error: String(e) }); }
}

/** Entrada standalone: npm run test:bloque5. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque5(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque5.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque5.pdf'), resumen);
  console.log('\n== Bloque 5 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
