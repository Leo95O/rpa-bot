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
import { TOLERANCIA } from './fixtures';

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

/** Oráculo para insumos normales: stock + PPP vía endpoint autoritativo. */
export async function assertStockInsumo(
  page: Page,
  nombre: string,
  esperadoStock: number,
  esperadoCosto: number,
): Promise<Veredicto> {
  const r = await validarStock(page, nombre, esperadoStock, esperadoCosto);
  return {
    paso: r.paso,
    ok: r.ok,
    esperado: 'stock=' + r.esperado.cantidad + '; costo=' + r.esperado.costo,
    real: r.real ? 'stock=' + r.real.stock + '; costo=' + r.real.costo : undefined,
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
): Promise<Veredicto> {
  const paso = 'validarStock("' + nombre + '" @ ' + almacenDesc + ')';
  const esperado = 'stock=' + esperadoStock + '; costo=' + esperadoCosto;
  try {
    const r: { stock: number; costo: number } | null = await page.evaluate(async (args) => {
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
        if (!alm) return { stock: 0, costo: 0 };
        return { stock: Number(alm.stock || 0), costo: Number(alm.costo || 0) };
      } catch {
        return null;
      }
    }, { nombre, almacen: almacenDesc });
    if (!r) return { paso, ok: false, esperado, error: 'Insumo o lectura nula.' };
    const real = 'stock=' + r.stock + '; costo=' + r.costo;
    const ok = Math.abs(r.stock - esperadoStock) < TOLERANCIA && Math.abs(r.costo - esperadoCosto) < TOLERANCIA;
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
): Promise<{ stock: number; costo: number } | null> {
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(
      'SELECT movimientoalmacenconsumible_tipo AS tipo, ' +
        'movimientoalmacenconsumible_cantidad AS cant, ' +
        'movimientoalmacenconsumible_costopromedioactual AS ppp ' +
        'FROM movimientoalmacenconsumible ' +
        "WHERE insumo_id = ? AND almacen_id = ? AND (movimientoalmacenconsumible_fueeliminado IS NULL OR movimientoalmacenconsumible_fueeliminado != '1') " +
        'ORDER BY movimientoalmacenconsumible_id ASC',
      [insumoId, almacenId],
    );
    const list = rows as Array<{ tipo: number; cant: number; ppp: number }>;
    if (!list.length) return null;
    let stock = 0;
    let costo = 0;
    for (const m of list) {
      const cant = Number(m.cant || 0);
      if (Number(m.tipo) === 1) {
        stock += cant;
        costo = Number(m.ppp || 0);
      } else {
        stock -= cant;
      }
    }
    return { stock: Math.round(stock * 1000) / 1000, costo };
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
): Promise<Veredicto> {
  const paso = 'validarStockConsumible("' + nombre + '")';
  const esperado = 'stock=' + esperadoStock + '; costo=' + esperadoCosto;
  try {
    const r = await leerStockConsumible(insumoId, almacenId);
    // Sin movimientos y esperado 0/0 (alta fresca): el espejo vacío ES el cero.
    if (!r) {
      const ok = esperadoStock === 0 && esperadoCosto === 0;
      return { paso, ok, esperado, real: 'sin movimientos (0/0)', error: ok ? undefined : 'Sin movimientos en tabla espejo.' };
    }
    const real = 'stock=' + r.stock + '; costo=' + r.costo;
    const ok =
      Math.abs(r.stock - esperadoStock) < TOLERANCIA && Math.abs(r.costo - esperadoCosto) < TOLERANCIA;
    return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia (esperado vs real).' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}
