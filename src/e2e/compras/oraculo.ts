// oraculo.ts — Verificaciones del módulo de Compras (SOLID: Single Responsibility)
import { Page } from 'playwright';
import { ContextoCompra, KardexFila, TotalesCompra } from './tipos';
import { ppp, precioSin } from './helpers';

declare const angular: any;

const TOLERANCIA = 0.02;

export interface Veredicto {
  paso: string;
  ok: boolean;
  /** true = la verificación NO se ejecutó (flujo stub): no cuenta como éxito ni como fallo. */
  pendiente?: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export interface EstadoStock {
  stock: number;
  costo: number;
  sinImp: number;
}

/**
 * Lee el estado VIVO del Kardex de un insumo (stock, PPP y PPP sin impuestos)
 * vía el endpoint autoritativo `Insumo.obtenerStockYCosto`.
 * Se usa como estado PREvio para calcular el PPP esperado tras una entrada:
 * solo las ENTRADAS promedian (MovimientoalmaceninsumoV2:859-938), y la vía
 * sin impuestos corre en paralelo (`:920-930`).
 */
export async function leerStockActual(
  page: Page,
  nombre: string,
  almacenDesc?: string,
): Promise<EstadoStock | null> {
  try {
    const r = await page.evaluate(
      async (args) => {
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
        const lista = resp && resp.data ? resp.data : [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(args.nombre).trim().toLowerCase(),
        );
        if (!item) return null;
        const sr = await Insumo.obtenerStockYCosto(item.item_id);
        const almacenes = sr && sr.data ? sr.data : [];
        const alm = almacenes.find((a: any) =>
          args.almacen ? String(a.almacen_descripcion || '').toLowerCase().includes(args.almacen.toLowerCase()) : true,
        ) || almacenes[0];
        if (!alm) return { stock: 0, costo: 0, sinImp: 0 };
        const cs = alm.costoStock || {};
        return {
          stock: Number(alm.stock || 0),
          costo: Number(alm.costo || 0),
          sinImp: cs.costosinimpuesto != null ? Math.round(Number(cs.costosinimpuesto) * 1000) / 1000 : 0,
        };
      },
      { nombre, almacen: almacenDesc },
    );
    if (!r) return null;
    return { stock: Number(r.stock || 0), costo: Number(r.costo || 0), sinImp: Number(r.sinImp || 0) };
  } catch {
    return null;
  }
}

export async function assertStock(
  page: Page,
  nombre: string,
  esperadoStock: number,
  esperadoCosto: number,
  esperadoSinImp?: number,
  almacen?: string,
): Promise<Veredicto> {
  const paso = `assertStock("${nombre}"${almacen ? `@${almacen}` : ''})`;
  try {
    const r = await leerStockActual(page, nombre, almacen);
    if (!r) return { paso, ok: false, esperado: `stock=${esperadoStock}; costo=${esperadoCosto}`, error: 'Insumo no encontrado' };
    const real = `stock=${r.stock}; costo=${r.costo}${esperadoSinImp !== undefined ? `; sinImp=${r.sinImp}` : ''}`;
    const esperado = `stock=${esperadoStock}; costo=${esperadoCosto}${esperadoSinImp !== undefined ? `; sinImp=${esperadoSinImp}` : ''}`;
    let ok = Math.abs(r.stock - esperadoStock) < TOLERANCIA && Math.abs(r.costo - esperadoCosto) < TOLERANCIA;
    if (ok && esperadoSinImp !== undefined) {
      ok = Math.abs((r.sinImp || 0) - esperadoSinImp) < TOLERANCIA;
    }
    return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia' };
  } catch (e) {
    return { paso, ok: false, esperado: `stock=${esperadoStock}; costo=${esperadoCosto}`, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Última movimiento del Kardex del ítem: debe ser una SALIDA (tipo 0) por
 * `cantidad` a costo 0 (NC por cantidad, anulación con devolución de stock,
 * merma, traslado de salida). Las SALIDAS no repromedian: congelan el PPP.
 */
export async function assertUltimaSalida(
  insumoId: number,
  almacenId: number,
  cantidad: number,
): Promise<Veredicto> {
  const paso = `assertUltimaSalida(insumo=${insumoId}, alm=${almacenId}, cant=${cantidad})`;
  const esperado = `tipo=0 (SALIDA); cantidad=${cantidad}; costo=0`;
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        'SELECT movimientoalmaceninsumo_tipo AS tipo, movimientoalmaceninsumo_cantidad AS cant, ' +
          'movimientoalmaceninsumo_costooperacion AS cop FROM movimientoalmaceninsumo ' +
          'WHERE insumo_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1') " +
          'ORDER BY movimientoalmaceninsumo_id DESC LIMIT 1',
        [insumoId, almacenId],
      );
      const list = rows as Array<{ tipo: number; cant: number; cop: number }>;
      if (!list.length) return { paso, ok: false, esperado, error: 'Sin movimientos' };
      const m = list[0];
      const real = `tipo=${Number(m.tipo)}; cantidad=${Number(m.cant)}; costo=${Number(m.cop)}`;
      const ok = Number(m.tipo) === 0 && Math.abs(Number(m.cant) - cantidad) < TOLERANCIA && Math.abs(Number(m.cop)) < TOLERANCIA;
      return { paso, ok, esperado, real, error: ok ? undefined : 'La última movimiento no es la SALIDA esperada.' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sin movimientos VIVOS para el ítem en el almacén.
 * Es el efecto real de anular una compra con `devolverStock=SI`: el backend
 * marca la ENTRADA de la compra con `fueeliminado=SI` y regulariza los saldos
 * (no crea una contra-SALIDA nueva: CompraLogistica::_descontarStockPorDevolucion
 * -> DetallecompraLogistica::modificacionDetalle(SI)).
 */
export async function assertSinMovimientosVivos(
  insumoId: number,
  almacenId: number,
): Promise<Veredicto> {
  const paso = `assertSinMovimientosVivos(insumo=${insumoId}, alm=${almacenId})`;
  const esperado = '0 movimientos vivos (entrada anulada)';
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        'SELECT COUNT(*) AS n FROM movimientoalmaceninsumo ' +
          'WHERE insumo_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1')",
        [insumoId, almacenId],
      );
      const n = Number((rows as Array<{ n: number }>)[0].n);
      const real = n + ' movimientos vivos';
      const ok = n === 0;
      return { paso, ok, esperado, real, error: ok ? undefined : 'Quedan movimientos vivos tras anular la compra.' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Producto con `producto_controlstock != 'SI'`: la compra se registra pero NO
 * genera movimiento de Kardex (early return en Producto::incrementarStockPorCompra).
 * Se verifica por SQL: cero movimientos vivos para ese producto.
 */
export async function assertSinMovimientoProducto(
  productoId: number,
  almacenId: number,
): Promise<Veredicto> {
  const paso = `assertSinMovimientoProducto(producto=${productoId}, alm=${almacenId})`;
  const esperado = '0 movimientos';
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        'SELECT COUNT(*) AS n FROM movimientoalmaceninsumo ' +
          'WHERE producto_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1')",
        [productoId, almacenId],
      );
      const n = Number((rows as Array<{ n: number }>)[0].n);
      const real = n + ' movimientos';
      const ok = n === 0;
      return { paso, ok, esperado, real, error: ok ? undefined : 'El producto sin control de stock generó movimiento.' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Conexión MySQL compartida por los oráculos SQL. */
async function conexion(): Promise<any> {
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logisticaaa',
  });
}

/**
 * Cuotas de crédito generadas por una compra al crédito
 * (CompraLogistica::generarCuotasCredito): una fila por cuota con
 * totalcuota/interes/amortizacion y estado pendiente.
 */
export async function assertCuotasCredito(
  compraId: number,
  esperado: { n: number; totalcuota: number },
): Promise<Veredicto> {
  const paso = `assertCuotasCredito(compra=${compraId})`;
  const esp = `n=${esperado.n}; totalcuota=${esperado.totalcuota}`;
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT comprasporpagar_totalcuota AS total, comprasporpagar_interes AS interes, ' +
        'comprasporpagar_amortizacion AS amort, comprasporpagar_estado AS estado ' +
        'FROM comprasporpagar WHERE compra_id = ? ORDER BY comprasporpagar_id',
      [compraId],
    );
    const list = rows as Array<{ total: number; interes: number; amort: number; estado: string }>;
    const real = list.map((c) => `total=${Number(c.total)}; interes=${Number(c.interes)}; amort=${Number(c.amort)}; estado=${c.estado}`).join(' | ');
    const ok = list.length === esperado.n && list.every((c) => Math.abs(Number(c.total) - esperado.totalcuota) < TOLERANCIA);
    return { paso, ok, esperado: esp, real: real || 'sin cuotas', error: ok ? undefined : 'Las cuotas de crédito no son las esperadas.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/**
 * Filas de distribución de una OC (`distribucionordencompra`): una por
 * (detalle OC, local solicitante) con la cantidad que pidió ese local.
 */
export async function assertDistribucionOC(
  ordenCompraId: number,
  esperado: Array<{ localId: number; cantidad: number }>,
): Promise<Veredicto> {
  const paso = `assertDistribucionOC(oc=${ordenCompraId})`;
  const esp = esperado.map((e) => `local ${e.localId}=${e.cantidad}`).join(' | ');
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT d.local_id AS local, d.distribucionordencompra_cantidad AS cantidad, d.distribucionordencompra_estado AS estado ' +
        'FROM distribucionordencompra d JOIN detalleordencompra dc ON dc.detalleordencompra_id = d.detalleordencompra_id ' +
        'WHERE dc.ordencompra_id = ? ORDER BY d.local_id',
      [ordenCompraId],
    );
    const list = rows as Array<{ local: number; cantidad: number; estado: string }>;
    const real = list.map((d) => `local ${Number(d.local)}=${Number(d.cantidad)} (${d.estado})`).join(' | ');
    const ok = list.length === esperado.length && esperado.every((e) =>
      list.some((d) => Number(d.local) === e.localId && Math.abs(Number(d.cantidad) - e.cantidad) < TOLERANCIA),
    );
    return { paso, ok, esperado: esp, real: real || 'sin distribución', error: ok ? undefined : 'Las filas de distribución no son las esperadas.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/** Pivote de canje: cuántas solicitudes quedaron vinculadas a la OC. */
export async function assertVinculosCanje(
  ordenCompraId: number,
  esperado: number,
): Promise<Veredicto> {
  const paso = `assertVinculosCanje(oc=${ordenCompraId})`;
  const esp = `${esperado} solicitud(es) vinculadas`;
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS n FROM ordenrequerimientocompra WHERE ordencompra_id = ?',
      [ordenCompraId],
    );
    const n = Number((rows as Array<{ n: number }>)[0].n);
    const ok = n === esperado;
    return { paso, ok, esperado: esp, real: n + ' vínculo(s)', error: ok ? undefined : 'La cantidad de vínculos de canje no coincide.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/** Estado de la OC tras el canje (PENDIENTE/APROBADO/PROCESADA/ANULADA). */
export async function assertEstadoOC(
  ordenCompraId: number,
  estados: Record<string, string>,
): Promise<Veredicto> {
  const paso = `assertEstadoOC(oc=${ordenCompraId})`;
  const esp = Object.entries(estados).map(([k, v]) => `${k}=${v}`).join(' | ');
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT ordencompra_id AS id, ordencompra_estado AS estado, ordencompra_distribucion AS dist FROM ordencompra WHERE ordencompra_id = ?',
      [ordenCompraId],
    );
    const list = rows as Array<{ id: number; estado: number; dist: string }>;
    if (!list.length) return { paso, ok: false, esperado: esp, error: 'OC no encontrada' };
    const o = list[0];
    const real = `estado=${Number(o.estado)}; distribucion=${o.dist}`;
    const ok = Object.entries(estados).every(([k, v]) => {
      if (k === 'distribucion') return String(o.dist) === v;
      return String(Number(o.estado)) === v;
    });
    return { paso, ok, esperado: esp, real, error: ok ? undefined : 'El estado de la OC no es el esperado.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/** Stock y PPP de un ítem en un almacén concreto (por el Kardex: Σentradas − Σsalidas). */
export async function assertStockPorAlmacen(
  insumoId: number,
  almacenId: number,
  esperadoStock: number,
  esperadoCosto?: number,
): Promise<Veredicto> {
  const paso = `assertStockPorAlmacen(insumo=${insumoId}, alm=${almacenId})`;
  const esp = `stock=${esperadoStock}` + (esperadoCosto !== undefined ? `; costo=${esperadoCosto}` : '');
  const r = await leerStockInsumoPorAlmacen(insumoId, almacenId);
  if (!r) return { paso, ok: false, esperado: esp, error: 'Sin movimientos en el almacén' };
  const real = `stock=${r.stock}; costo=${r.ppp}`;
  let ok = Math.abs(r.stock - esperadoStock) < TOLERANCIA;
  if (ok && esperadoCosto !== undefined) ok = Math.abs(r.ppp - esperadoCosto) < TOLERANCIA;
  return { paso, ok, esperado: esp, real, error: ok ? undefined : 'Divergencia de stock/costo en el almacén.' };
}

/**
 * Stock y PPP de un ítem en un almacén, calculados por el Kardex.
 * OJO: el `saldoactual` de un movimiento NO es el stock en todas las filas: las
 * SALIDAS se guardan con saldo 0 (el balance va en las ENTRADAS). Por eso el
 * stock se calcula como Σentradas − Σsalidas (como el oráculo del espejo) y el
 * PPP se toma de la última ENTRADA viva.
 */
export async function leerStockInsumoPorAlmacen(
  insumoId: number,
  almacenId: number,
): Promise<{ stock: number; ppp: number } | null> {
  try {
    const conn = await conexion();
    try {
      const [rows] = await conn.query(
        'SELECT movimientoalmaceninsumo_tipo AS tipo, movimientoalmaceninsumo_cantidad AS cant, ' +
          'movimientoalmaceninsumo_costopromedioactual AS ppp FROM movimientoalmaceninsumo ' +
          'WHERE insumo_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1') " +
          'ORDER BY movimientoalmaceninsumo_id ASC',
        [insumoId, almacenId],
      );
      const list = rows as Array<{ tipo: number; cant: number; ppp: number }>;
      if (!list.length) return null;
      let stock = 0;
      let ppp = 0;
      for (const m of list) {
        if (Number(m.tipo) === 1) {
          stock += Number(m.cant);
          ppp = Number(m.ppp);
        } else {
          stock -= Number(m.cant);
        }
      }
      return { stock: Math.round(stock * 1000) / 1000, ppp };
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.error('[DIAC][leerStockInsumoPorAlmacen] ' + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

/** Stock y PPP de un PRODUCTO en un almacén (mismo cálculo que el insumo). */
export async function leerStockProductoPorAlmacen(
  productoId: number,
  almacenId: number,
): Promise<{ stock: number; ppp: number } | null> {
  try {
    const conn = await conexion();
    try {
      const [rows] = await conn.query(
        'SELECT movimientoalmaceninsumo_tipo AS tipo, movimientoalmaceninsumo_cantidad AS cant, ' +
          'movimientoalmaceninsumo_costopromedioactual AS ppp FROM movimientoalmaceninsumo ' +
          'WHERE producto_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1') " +
          'ORDER BY movimientoalmaceninsumo_id ASC',
        [productoId, almacenId],
      );
      const list = rows as Array<{ tipo: number; cant: number; ppp: number }>;
      if (!list.length) return null;
      let stock = 0;
      let ppp = 0;
      for (const m of list) {
        if (Number(m.tipo) === 1) {
          stock += Number(m.cant);
          ppp = Number(m.ppp);
        } else {
          stock -= Number(m.cant);
        }
      }
      return { stock: Math.round(stock * 1000) / 1000, ppp };
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.error('[DIAC][leerStockProductoPorAlmacen] ' + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

/** Último movimiento vivo de un CONSUMIBLE (tabla espejo del Kardex). */
export async function leerUltimaMovimientoConsumible(
  insumoId: number,
  almacenId: number,
): Promise<{ tipo: number; cantidad: number; motivo: number; costo: number } | null> {
  try {
    const conn = await conexion();
    try {
      const [rows] = await conn.query(
        'SELECT movimientoalmacenconsumible_tipo AS tipo, movimientoalmacenconsumible_cantidad AS cant, ' +
          'movimientoalmacenconsumible_motivo AS motivo, movimientoalmacenconsumible_costooperacion AS costo ' +
          'FROM movimientoalmacenconsumible WHERE insumo_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmacenconsumible_fueeliminado IS NULL OR movimientoalmacenconsumible_fueeliminado != '1') " +
          'ORDER BY movimientoalmacenconsumible_id DESC LIMIT 1',
        [insumoId, almacenId],
      );
      const list = rows as Array<{ tipo: number; cant: number; motivo: number; costo: number }>;
      if (!list.length) return null;
      return { tipo: Number(list[0].tipo), cantidad: Number(list[0].cant), motivo: Number(list[0].motivo), costo: Number(list[0].costo) };
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.error('[DIAC][leerUltimaMovimientoConsumible] ' + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

/**
 * Detalle persistido de una OC.
 * La tabla NO tiene columna de costo unitario: guarda el IMPORTE en
 * `detalleordencompra_precio` (orden-de-compra.md §5.2: "precio = importe"),
 * así que el costo unitario se deriva como precio / cantidad.
 */
export async function leerDetalleOC(
  ordenCompraId: number,
): Promise<Array<{ cantidad: number; costo: number; importe: number }>> {
  try {
    const conn = await conexion();
    try {
      const [rows] = await conn.query(
        'SELECT detalleordencompra_cantidad AS cantidad, detalleordencompra_precio AS importe ' +
          'FROM detalleordencompra WHERE ordencompra_id = ?',
        [ordenCompraId],
      );
      return (rows as Array<{ cantidad: number; importe: number }>).map((r) => ({
        cantidad: Number(r.cantidad),
        importe: Number(r.importe),
        costo: Number(r.cantidad) ? Number(r.importe) / Number(r.cantidad) : 0,
      }));
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.error('[DIAC][leerDetalleOC] ' + (e instanceof Error ? e.message : String(e)));
    return [];
  }
}

/** Detalle persistido de una guía (cantidad, costo e importe). */
export async function leerDetalleGuia(
  guiaId: number,
): Promise<Array<{ cantidad: number; costo: number; importe: number }>> {
  try {
    const conn = await conexion();
    try {
      const [rows] = await conn.query(
        'SELECT detalleguia_cantidad AS cantidad, detalleguia_costo AS costo, detalleguia_importe AS importe ' +
          'FROM detalleguia WHERE guia_id = ?',
        [guiaId],
      );
      return (rows as Array<{ cantidad: number; costo: number; importe: number }>).map((r) => ({
        cantidad: Number(r.cantidad), costo: Number(r.costo), importe: Number(r.importe),
      }));
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.error('[DIAC][leerDetalleGuia] ' + (e instanceof Error ? e.message : String(e)));
    return [];
  }
}

/**
 * La fila de distribución del local debe quedar enlazada a la guía que
 * sirvió ese local (distribucionordencompra.guia_id).
 */
export async function assertDistribucionEnlazada(
  ordenCompraId: number,
  localId: number,
  guiaId: number,
): Promise<Veredicto> {
  const paso = `assertDistribucionEnlazada(oc=${ordenCompraId}, local=${localId})`;
  const esperado = `guia_id=${guiaId}`;
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT d.guia_id AS guia FROM distribucionordencompra d ' +
        'JOIN detalleordencompra dc ON dc.detalleordencompra_id = d.detalleordencompra_id ' +
        'WHERE dc.ordencompra_id = ? AND d.local_id = ?',
      [ordenCompraId, localId],
    );
    const list = rows as Array<{ guia: number | null }>;
    if (!list.length) return { paso, ok: false, esperado, error: 'No hay fila de distribución para el local' };
    const real = `guia_id=${list[0].guia === null ? 'null' : list[0].guia}`;
    const ok = Number(list[0].guia) === Number(guiaId);
    return { paso, ok, esperado, real, error: ok ? undefined : 'La distribución no quedó enlazada a la guía del local.' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/** Estado de amortización de una cuota de crédito. */
export async function assertCuotaAmortizada(
  comprasporpagarId: number,
  esperado: { amortizacion: number; estado?: string },
): Promise<Veredicto> {
  const paso = `assertCuotaAmortizada(cuota=${comprasporpagarId})`;
  const esp = `amortizacion=${esperado.amortizacion}` + (esperado.estado ? `; estado=${esperado.estado}` : '');
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT comprasporpagar_amortizacion AS amort, comprasporpagar_estado AS estado FROM comprasporpagar WHERE comprasporpagar_id = ?',
      [comprasporpagarId],
    );
    const list = rows as Array<{ amort: number; estado: string }>;
    if (!list.length) return { paso, ok: false, esperado: esp, error: 'Cuota no encontrada' };
    const real = `amortizacion=${Number(list[0].amort)}; estado=${list[0].estado}`;
    let ok = Math.abs(Number(list[0].amort) - esperado.amortizacion) < TOLERANCIA;
    if (ok && esperado.estado) ok = String(list[0].estado) === esperado.estado;
    return { paso, ok, esperado: esp, real, error: ok ? undefined : 'La amortización de la cuota no es la esperada.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

/**
 * NC por PRECIO: la ENTRADA original queda marcada fueeliminado=SI y el
 * clon vive con el costo rebajado (NotacreditocompraLogistica:224-404).
 */
export async function assertClonPrecio(
  insumoId: number,
  almacenId: number,
  costoOriginal: number,
  costoNuevo: number,
): Promise<Veredicto> {
  const paso = `assertClonPrecio(insumo=${insumoId}, alm=${almacenId})`;
  const esp = `origen eliminado (costo ${costoOriginal}) + clon vivo (costo ${costoNuevo})`;
  const conn = await conexion();
  try {
    const [rows] = await conn.query(
      'SELECT movimientoalmaceninsumo_costooperacion AS costo, movimientoalmaceninsumo_fueeliminado AS elim ' +
        'FROM movimientoalmaceninsumo WHERE insumo_id = ? AND almacen_id = ? ORDER BY movimientoalmaceninsumo_id',
      [insumoId, almacenId],
    );
    const list = rows as Array<{ costo: number; elim: string | number | null }>;
    const eliminados = list.filter((m) => String(m.elim) === '1');
    const vivos = list.filter((m) => String(m.elim) !== '1');
    const real = `movimientos=${list.length} (eliminados=${eliminados.length}, vivos=${vivos.length}); ` +
      `costos=[${list.map((m) => Number(m.costo).toFixed(3)).join(', ')}]`;
    const clon = vivos.find((m) => Math.abs(Number(m.costo) - costoNuevo) < TOLERANCIA);
    const ok = eliminados.length === 1 && vivos.length === 1 && !!clon &&
      Math.abs(Number(eliminados[0].costo) - costoOriginal) < TOLERANCIA;
    return { paso, ok, esperado: esp, real, error: ok ? undefined : 'La NC por precio no dejó el clon esperado.' };
  } catch (e) {
    return { paso, ok: false, esperado: esp, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conn.end();
  }
}

export async function assertTotales(
  compraId: number,
  esperado: TotalesCompra,
  divisorIgv: number,
): Promise<Veredicto> {
  const paso = `assertTotales(compra=${compraId})`;
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        'SELECT compra_subtotal AS sub, compra_igv AS igv, compra_total AS tot, compra_flete AS flete, compra_icbper AS icbper, compra_percepciontotal AS perc FROM compra WHERE compra_id = ?',
        [compraId],
      );
      const list = rows as Array<{ sub: number; igv: number; tot: number; flete: number; icbper: number; perc: number }>;
      if (!list.length) return { paso, ok: false, esperado: 'compra encontrada', error: 'Compra no encontrada' };
      const c = list[0];
      const real = `sub=${Number(c.sub)}; igv=${Number(c.igv)}; total=${Number(c.tot)}; flete=${Number(c.flete)}; icbper=${Number(c.icbper)}; perc=${Number(c.perc)}`;
      const ok =
        Math.abs(Number(c.sub) - esperado.subtotal) < TOLERANCIA &&
        Math.abs(Number(c.igv) - esperado.igv) < TOLERANCIA &&
        Math.abs(Number(c.tot) - esperado.total) < TOLERANCIA &&
        Math.abs(Number(c.flete) - esperado.flete) < TOLERANCIA &&
        Math.abs(Number(c.icbper) - esperado.icbper) < TOLERANCIA &&
        Math.abs(Number(c.perc) - esperado.percepcion) < TOLERANCIA;
      return { paso, ok, esperado: `sub=${esperado.subtotal}; igv=${esperado.igv}; total=${esperado.total}`, real, error: ok ? undefined : 'Divergencia' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'totales', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function assertKardex(
  insumoId: number,
  almacenId: number,
  esperado: KardexFila,
): Promise<Veredicto> {
  const paso = `assertKardex(insumo=${insumoId}, alm=${almacenId})`;
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        'SELECT movimientoalmaceninsumo_stockanterior AS sa, movimientoalmaceninsumo_cantidad AS cant, movimientoalmaceninsumo_costooperacion AS cop, movimientoalmaceninsumo_costopromedioactual AS ppp, movimientoalmaceninsumo_saldoactual AS saldo, movimientoalmaceninsumo_costosinimpuesto AS sin FROM movimientoalmaceninsumo WHERE insumo_id = ? AND almacen_id = ? AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != "1") ORDER BY movimientoalmaceninsumo_id DESC LIMIT 1',
        [insumoId, almacenId],
      );
      const list = rows as Array<{ sa: number; cant: number; cop: number; ppp: number; saldo: number; sin: number }>;
      if (!list.length) return { paso, ok: false, esperado: 'última fila', error: 'Sin movimientos' };
      const m = list[0];
      const real = `stockAnt=${Number(m.sa)}; cant=${Number(m.cant)}; costoOp=${Number(m.cop)}; ppp=${Number(m.ppp)}; nuevo=${Number(m.saldo)}; sin=${Number(m.sin)}`;
      const ok =
        Math.abs(Number(m.sa) - esperado.stockAnterior) < TOLERANCIA &&
        Math.abs(Number(m.cant) - esperado.cantidad) < TOLERANCIA &&
        Math.abs(Number(m.cop) - esperado.costoOp) < TOLERANCIA &&
        Math.abs(Number(m.ppp) - esperado.ppp) < TOLERANCIA &&
        Math.abs(Number(m.saldo) - esperado.nuevoStock) < TOLERANCIA;
      return { paso, ok, esperado: `stockAnt=${esperado.stockAnterior}; cant=${esperado.cantidad}; ppp=${esperado.ppp}; nuevo=${esperado.nuevoStock}`, real, error: ok ? undefined : 'Divergencia' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'kardex', error: e instanceof Error ? e.message : String(e) };
  }
}

export function assertPppEsperado(stockAnt: number, costoAnt: number, cant: number, costo: number): number {
  return ppp(stockAnt, costoAnt, cant, costo);
}

export function assertPrecioSin(costoCon: number, divisorIgv: number): number {
  return precioSin(costoCon, divisorIgv);
}
