// oracle.ts — Aserciones del Kardex (REPOTE_ARQUITECTURA_KARDEX.md).
// Reglas implementadas:
//  - Toda ENTRADA promedia: PPP = ((stock*costo)+(cant*costoOp))/(stock+cant). Solo eso mueve el costo.
//  - Toda SALIDA (merma, consumo, NC cantidad, traslado-origen) va a costo 0: congela el PPP, solo resta.
//  - Insumos normales -> `Insumo.obtenerStockYCosto` (kardex.ts).
//  - Consumibles (insumo_consumible='1') -> TABLA ESPEJO `movimientoalmacenconsumible`
//    (columnas verificadas contra restaurant.sql). NUNCA buscarlos en movimientoalmaceninsumo.

import { Page } from 'playwright';
import mysql from 'mysql2/promise';
import { validarStock } from '../kardex';
import { TOLERANCIA, getDivisorIgv, getBaseline } from './fixtures';

declare const angular: any;

export interface Veredicto {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logisticaaa',
};

/** Formato de log con costo sin impuestos (punto 3 del requerimiento). */
export function fmtStock(stock: number, costo: number, costoSinImp?: number): string {
  const base = 'stock=' + stock + '; costo=' + costo;
  return costoSinImp === undefined ? base : base + '; costo_sin_imp=' + costoSinImp;
}

/** Lectura cruda del Kardex por almacén (para contrastes, sin aserción). */
export async function leerKardex(
  page: Page, nombre: string, almacenDesc: string,
): Promise<{ stock: number; costo: number; costoSinImp: number } | null> {
  try {
    const r = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const CommonCollection = injector.get('CommonCollection');
        const Insumo = injector.get('Insumo');
        const PARAM = injector.get('PARAM');
        const SecurityService = injector.get('SecurityService');
        const localId = SecurityService.getLocalId() || PARAM.NO;
        const resp = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, localId, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (resp && resp.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return null;
        const sr = await Insumo.obtenerStockYCosto(item.item_id);
        const almacenes = (sr && sr.data) || [];
        const alm = almacenes.find((a: any) =>
          String(a.almacen_descripcion || '').toLowerCase().indexOf(String(args.almacen).toLowerCase()) >= 0);
        if (!alm) return { stock: 0, costo: 0, costoSinImp: 0 };
        const cs = alm.costoStock || {};
        return {
          stock: Number(alm.stock || 0), costo: Number(alm.costo || 0),
          costoSinImp: cs.costosinimpuesto != null ? Math.round(Number(cs.costosinimpuesto) * 1000) / 1000 : 0,
        };
      } catch {
        return null;
      }
    }, { nombre, almacen: almacenDesc });
    return r;
  } catch {
    return null;
  }
}

/** Resuelve ids por SQL (sin depender del frontend). */
export async function resolverIdsSQL(
  nombre: string, almacenDesc: string,
): Promise<{ insumoId: number; almacenId: number } | null> {
  const conn = await mysql.createConnection(DB);
  try {
    const [ins] = await conn.query(
      'SELECT insumo_id AS id FROM insumo WHERE insumo_descripcion = ? OR insumo_nombre = ? LIMIT 1',
      [nombre, nombre],
    );
    const insList = ins as Array<{ id: number }>;
    // Fallback por LIKE si el nombre exacto no coincide con la columna usada.
    let insumoId = insList.length ? Number(insList[0].id) : NaN;
    if (!insumoId || Number.isNaN(insumoId)) {
      const [like] = await conn.query(
        'SELECT insumo_id AS id FROM insumo WHERE insumo_descripcion LIKE ? OR insumo_nombre LIKE ? LIMIT 1',
        ['%' + nombre + '%', '%' + nombre + '%'],
      );
      const likeList = like as Array<{ id: number }>;
      if (!likeList.length) return null;
      insumoId = Number(likeList[0].id);
    }
    const [alm] = await conn.query(
      'SELECT almacen_id AS id FROM almacen WHERE almacen_descripcion LIKE ? LIMIT 1',
      ['%' + almacenDesc + '%'],
    );
    const almList = alm as Array<{ id: number }>;
    if (!almList.length) return null;
    return { insumoId, almacenId: Number(almList[0].id) };
  } catch {
    return null;
  } finally {
    await conn.end();
  }
}

/**
 * Último costo de ENTRADA viva (tipo=1, cantidad>0) del Kardex.
 * Es lo que el campo `costo` refleja cuando el baseline c106=1 (última compra).
 */
export async function leerUltimoCostoEntrada(
  insumoId: number, almacenId: number, espejo: boolean,
): Promise<number | null> {
  const tabla = espejo ? 'movimientoalmacenconsumible' : 'movimientoalmaceninsumo';
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(
      'SELECT ' + tabla + '_costooperacion AS c FROM ' + tabla + ' ' +
        "WHERE insumo_id = ? AND almacen_id = ? AND " + tabla + "_tipo = 1 AND " +
        tabla + '_cantidad > 0 AND (' + tabla + "_fueeliminado IS NULL OR " +
        tabla + "_fueeliminado != '1') " +
        'ORDER BY ' + tabla + '_id DESC LIMIT 1',
      [insumoId, almacenId],
    );
    const list = rows as Array<{ c: number }>;
    if (!list.length) return null;
    return Math.round(Number(list[0].c) * 1000) / 1000;
  } catch {
    return null;
  } finally {
    await conn.end();
  }
}

/**
 * Aplica el baseline al costo esperado del campo `costo`:
 * - c106=1: el campo refleja la última compra (no el PPP).
 * - c72=1: el campo refleja el valor sin impuestos.
 * Retorna el costo efectivo contra el que comparar + nota para el log.
 */
export async function costoEfectivoEsperado(
  nombre: string, almacenDesc: string, costoPPP: number, costoSinImp: number | undefined,
  espejo: boolean,
): Promise<{ costo: number; nota: string }> {
  const bl = getBaseline();
  if (bl.c72 === 0 && bl.c106 === 0) return { costo: costoPPP, nota: 'baseline-0/0:PPP' };
  if (bl.c106 === 1) {
    const ids = await resolverIdsSQL(nombre, almacenDesc);
    if (ids) {
      const ultimo = await leerUltimoCostoEntrada(ids.insumoId, ids.almacenId, espejo);
      if (ultimo !== null) return { costo: ultimo, nota: 'c106=1:última-compra' };
    }
    return { costo: costoPPP, nota: 'c106=1:sin-entradas,PPP' };
  }
  if (bl.c72 === 1 && costoSinImp !== undefined) {
    return { costo: costoSinImp, nota: 'c72=1:display-sin-imp' };
  }
  return { costo: costoPPP, nota: 'baseline-0/0:PPP' };
}

/** Oráculo para insumos normales: stock + PPP (+PPP sin impuestos) vía endpoint autoritativo. */
export async function assertStockInsumo(
  page: Page,
  nombre: string,
  esperadoStock: number,
  esperadoCosto: number,
  esperadoSinImp?: number,
): Promise<Veredicto> {
  // Principal = Almacen Principal para este oráculo.
  const eff = await costoEfectivoEsperado(nombre, 'Almacen Principal', esperadoCosto, esperadoSinImp, false);
  const r = await validarStock(page, nombre, esperadoStock, eff.costo, esperadoSinImp);
  const esperado = fmtStock(esperadoStock, esperadoCosto, esperadoSinImp) +
    (eff.nota.startsWith('baseline-0/0') ? '' : ' [' + eff.nota + ']');
  return {
    paso: r.paso,
    ok: r.ok,
    esperado,
    real: r.real ? fmtStock(r.real.stock, r.real.costo, r.real.costoSinImp) : undefined,
    error: r.error,
  };
}

/**
 * Oráculo por almacén para insumos normales (kardex.ts solo mira el Principal).
 * Traslados Central<->Sucursal exigen leer cada almacén por separado.
 */
export async function assertStockInsumoEnAlmacen(
  page: Page,
  nombre: string,
  almacenDesc: string,
  esperadoStock: number,
  esperadoCosto: number,
  esperadoSinImp?: number,
): Promise<Veredicto> {
  const paso = 'validarStock("' + nombre + '" @ ' + almacenDesc + ')';
  const eff = await costoEfectivoEsperado(nombre, almacenDesc, esperadoCosto, esperadoSinImp, false);
  const esperado = fmtStock(esperadoStock, esperadoCosto, esperadoSinImp) +
    (eff.nota.startsWith('baseline-0/0') ? '' : ' [' + eff.nota + ']');
  try {
    const r: { stock: number; costo: number; costoSinImp: number } | null = await page.evaluate(async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const CommonCollection = injector.get('CommonCollection');
        const Insumo = injector.get('Insumo');
        const PARAM = injector.get('PARAM');
        const SecurityService = injector.get('SecurityService');
        const localId = SecurityService.getLocalId() || PARAM.NO;
        const resp = await CommonCollection.busquedaSensitivaSegunTipos(
          args.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, localId, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (resp && resp.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return null;
        const sr = await Insumo.obtenerStockYCosto(item.item_id);
        const almacenes = (sr && sr.data) || [];
        const alm = almacenes.find((a: any) =>
          String(a.almacen_descripcion || '').toLowerCase().indexOf(String(args.almacen).toLowerCase()) >= 0);
        if (!alm) return { stock: 0, costo: 0, costoSinImp: 0 };
        const cs = alm.costoStock || {};
        const sin = cs.costosinimpuesto !== undefined && cs.costosinimpuesto !== null
          ? Math.round(Number(cs.costosinimpuesto) * 1000) / 1000 : 0;
        return { stock: Number(alm.stock || 0), costo: Number(alm.costo || 0), costoSinImp: sin };
      } catch {
        return null;
      }
    }, { nombre, almacen: almacenDesc });
    if (!r) return { paso, ok: false, esperado, error: 'Insumo o lectura nula.' };
    const real = fmtStock(r.stock, r.costo, r.costoSinImp);
    let ok = Math.abs(r.stock - esperadoStock) < TOLERANCIA && Math.abs(r.costo - eff.costo) < TOLERANCIA;
    if (ok && esperadoSinImp !== undefined) {
      ok = Math.abs((r.costoSinImp || 0) - esperadoSinImp) < TOLERANCIA;
    }
    return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia (esperado vs real).' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Oráculo de la tabla espejo por cálculo Kardex (no por última fila):
 * las SALIDAS persisten saldoactual=0 y costo=0 (no tocan PPP), así que:
 *   stock = Σ entradas(tipo=1) − Σ salidas(tipo=0) vivas;
 *   costo = costopromedioactual de la última ENTRADA viva (salidas lo congelan).
 */
export async function leerStockConsumible(
  insumoId: number,
  almacenId: number,
): Promise<{ stock: number; costo: number; costoSinImp: number } | null> {
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(
      'SELECT movimientoalmacenconsumible_tipo AS tipo, ' +
        'movimientoalmacenconsumible_cantidad AS cant, ' +
        'movimientoalmacenconsumible_costopromedioactual AS ppp, ' +
        'movimientoalmacenconsumible_costopromediosinimpuesto AS pppSin ' +
        'FROM movimientoalmacenconsumible ' +
        "WHERE insumo_id = ? AND almacen_id = ? AND (movimientoalmacenconsumible_fueeliminado IS NULL OR movimientoalmacenconsumible_fueeliminado != '1') " +
        'ORDER BY movimientoalmacenconsumible_id ASC',
      [insumoId, almacenId],
    );
    const list = rows as Array<{ tipo: number; cant: number; ppp: number; pppSin: number }>;
    if (!list.length) return null;
    let stock = 0;
    let costo = 0;
    let costoSinImp = 0;
    for (const m of list) {
      const cant = Number(m.cant || 0);
      if (Number(m.tipo) === 1) {
        stock += cant;
        costo = Number(m.ppp || 0);
        costoSinImp = Math.round(Number(m.pppSin || 0) * 1000) / 1000;
      } else {
        stock -= cant;
      }
    }
    return { stock: Math.round(stock * 1000) / 1000, costo, costoSinImp };
  } finally {
    await conn.end();
  }
}

/** Oráculo para consumibles: misma firma, fuente = tabla espejo. */
export async function assertStockConsumible(
  nombre: string,
  insumoId: number,
  almacenId: number,
  esperadoStock: number,
  esperadoCosto: number,
  esperadoSinImp?: number,
): Promise<Veredicto> {
  const paso = 'validarStockConsumible("' + nombre + '")';
  const eff = await costoEfectivoEsperado(nombre, 'Almacen Principal', esperadoCosto, esperadoSinImp, true);
  const esperado = fmtStock(esperadoStock, esperadoCosto, esperadoSinImp) +
    (eff.nota.startsWith('baseline-0/0') ? '' : ' [' + eff.nota + ']');
  try {
    const r = await leerStockConsumible(insumoId, almacenId);
    // Sin movimientos y esperado 0/0 (alta fresca): el espejo vacío ES el cero.
    if (!r) {
      const ok = esperadoStock === 0 && esperadoCosto === 0;
      return { paso, ok, esperado, real: 'sin movimientos (0/0)', error: ok ? undefined : 'Sin movimientos en tabla espejo.' };
    }
    const real = fmtStock(r.stock, r.costo, r.costoSinImp);
    let ok =
      Math.abs(r.stock - esperadoStock) < TOLERANCIA && Math.abs(r.costo - eff.costo) < TOLERANCIA;
    if (ok && esperadoSinImp !== undefined) {
      ok = Math.abs((r.costoSinImp || 0) - esperadoSinImp) < TOLERANCIA;
    }
    return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia (esperado vs real).' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Auditoría transaccional del detalle persistido (punto 2 del requerimiento):
 * lee detallecompra_costosinimpuestos / costo / cantidad / importe tal como los
 * guardó el ERP y los compara contra la matemática esperada.
 * Afecto: precioSin = precio/divisorIgv (fiscalizado, leído de BD),
 * subtotalSin = precioSin*cantidad. Exonerado: precioSin = precio.
 */
export async function assertDetalleCompraSinImpuestos(
  compraId: number,
  insumoId: number,
  precio: number,
  cantidad: number,
  afecto: boolean,
): Promise<Veredicto> {
  const paso = 'auditarDetalleSinImp(compra=' + compraId + ')';
  const precioSin = afecto
    ? Math.round((precio / getDivisorIgv()) * 1000) / 1000
    : precio;
  const subtotalSin = Math.round(precioSin * cantidad * 1000) / 1000;
  const esperado = 'precio_sin_imp=' + precioSin + '; subtotal_sin_imp=' + subtotalSin;
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(
      'SELECT d.detallecompra_costo AS costo, d.detallecompra_costosinimpuestos AS costoSin, ' +
        'd.detallecompra_cantidad AS cant, d.detallecompra_importe AS importe, ' +
        'd.detallecompra_afectoimpuestos AS afecto ' +
        'FROM detallecompra d INNER JOIN presentacioninsumo p ' +
        'ON p.presentacioninsumo_id = d.presentacioninsumo_id ' +
        'WHERE d.compra_id = ? AND p.insumo_id = ? ' +
        'ORDER BY d.detallecompra_id DESC LIMIT 1',
      [compraId, insumoId],
    );
    const list = rows as Array<{ costo: number; costoSin: number; cant: number; importe: number; afecto: string }>;
    if (!list.length) return { paso, ok: false, esperado, error: 'Detalle no encontrado en BD.' };
    const det = list[0];
    const real = 'precio_sin_imp=' + Number(det.costoSin) + '; subtotal_sin_imp=' +
      Math.round(Number(det.costoSin) * Number(det.cant) * 1000) / 1000;
    const okCosto = Math.abs(Number(det.costo) - precio) < TOLERANCIA;
    const okSin = Math.abs(Number(det.costoSin) - precioSin) < TOLERANCIA;
    const okSub = Math.abs(Number(det.costoSin) * Number(det.cant) - subtotalSin) < TOLERANCIA;
    const ok = okCosto && okSin && okSub;
    return { paso, ok, esperado, real, error: ok ? undefined : 'Desgravación incorrecta (costo/sin/subtotal).' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/**
 * Coherencia del detalle de OC persistido (verificado por SQL):
 * `detalleordencompra_precio` guarda el IMPORTE (precio*cantidad) y
 * `preciosinimpuestos` queda NULL (la OC pacta, no desgrava: la desgravación
 * ocurre en la Compra). Se audita importe + cantidad + nulidad del sin-imp.
 */
export async function assertDetalleOC(
  ordenCompraId: number,
  precio: number,
  cantidad: number,
): Promise<Veredicto> {
  const paso = 'auditarDetalleOC(oc=' + ordenCompraId + ')';
  const importe = Math.round(precio * cantidad * 1000) / 1000;
  const esperado = 'importe=' + importe + '; precio_sin_imp=N/A (la OC no desgrava)';
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(
      'SELECT detalleordencompra_precio AS precio, detalleordencompra_cantidad AS cant, ' +
        'detalleordencompra_preciosinimpuestos AS precioSin ' +
        'FROM detalleordencompra WHERE ordencompra_id = ? ' +
        'ORDER BY detalleordencompra_id DESC LIMIT 1',
      [ordenCompraId],
    );
    const list = rows as Array<{ precio: number; cant: number; precioSin: number | null }>;
    if (!list.length) return { paso, ok: false, esperado, error: 'Detalle OC no encontrado.' };
    const det = list[0];
    const real = 'importe=' + Number(det.precio) + '; precio_sin_imp=' + (det.precioSin === null ? 'NULL' : Number(det.precioSin));
    const ok = Math.abs(Number(det.precio) - importe) < TOLERANCIA &&
      Math.abs(Number(det.cant) - cantidad) < TOLERANCIA &&
      det.precioSin === null;
    return { paso, ok, esperado, real, error: ok ? undefined : 'Detalle OC incoherente.' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}
