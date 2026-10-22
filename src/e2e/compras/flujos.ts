// flujos.ts — Implementación de flujos F1-F13 (SOLID: Open/Closed, Liskov)
import { Page } from 'playwright';
import { ContextoCompra, EstadoSuite, LineaDetalle, ResultadoOperacion, TotalesCompra } from './tipos';

declare const angular: any;
import { hoyMas, fechaHora, serieUnica, navegar, inyectarSolicitud, inyectarOrdenCompra, calcularTotales, ppp, precioSin, resolverPresentacion } from './helpers';
import { assertStock, assertTotales, assertKardex, assertUltimaSalida, assertSinMovimientosVivos, assertSinMovimientoProducto, assertCuotasCredito, assertDistribucionOC, assertVinculosCanje, assertEstadoOC, assertStockPorAlmacen, leerStockActual, Veredicto } from './oraculo';
import { resolverPresentacionProducto } from './seed';

export type FlujoFn = (page: Page, ctx: ContextoCompra, estado: EstadoSuite) => Promise<Veredicto[]>;

/** Almacén de trabajo de los flujos de Compras (Central del local 1). */
const ALMACEN = 'Almacen Principal';

interface PrevioStock {
  stock: number;
  costo: number;
  sinImp: number;
}

/**
 * Estado esperado DESPUÉS de una ENTRADA (compra o guía).
 * Solo las ENTRADAS promedian el PPP (MovimientoalmaceninsumoV2:859-938) y la
 * vía sin impuestos corre en paralelo (`:920-930`):
 *   PPP' = (stockAnt*PPP + cant*costo) / (stockAnt + cant)
 * El PPP sin impuestos se acumula igual: usar el costo unitario SIN IGV de la
 * entrada (no el PPP de una compra anterior) es lo que hace que el esperado
 * difiera del real.
 */
function esperadoTrasEntrada(
  previo: PrevioStock,
  cantidad: number,
  costo: number,
  divisorIgv: number,
): { stock: number; costo: number; sinImp: number } {
  const sinUnit = precioSin(costo, divisorIgv);
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    stock: r3(previo.stock + cantidad),
    costo: r3(ppp(previo.stock, previo.costo, cantidad, costo)),
    sinImp: r3(ppp(previo.stock, previo.sinImp, cantidad, sinUnit)),
  };
}

/** Lee el estado vivo previo (stock/PPP/PPP-sin-imp) del ítem en el almacén. */
async function leerPrevio(page: Page, nombre: string): Promise<PrevioStock> {
  const r = await leerStockActual(page, nombre, ALMACEN);
  if (!r) return { stock: 0, costo: 0, sinImp: 0 };
  return r;
}

/** Resuelve el id de un maestro por nombre (el Bloque 1 crea 'Carne QA'). */
function maestro(estado: EstadoSuite, nombre: string): number {
  const id = estado.maestros.get(nombre);
  if (id === undefined) throw new Error('Maestro no encontrado en el estado: ' + nombre);
  return id;
}

/** Guarda el estado previo de un flujo (lo consume F9 al anular la compra de F3). */
function guardarPrevio(estado: EstadoSuite, flujo: string, previo: PrevioStock): void {
  if (!estado.preEstados) estado.preEstados = new Map();
  estado.preEstados.set(flujo, previo);
}

/** Estado previo de un PRODUCTO (stock y PPP) leyendo su último movimiento vivo. */
async function leerStockProducto(
  productoId: number,
  almacenId: number,
): Promise<{ stock: number; ppp: number } | null> {
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
        'SELECT movimientoalmaceninsumo_saldoactual AS saldo, movimientoalmaceninsumo_costopromedioactual AS ppp ' +
          'FROM movimientoalmaceninsumo WHERE producto_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1') " +
          'ORDER BY movimientoalmaceninsumo_id DESC LIMIT 1',
        [productoId, almacenId],
      );
      const list = rows as Array<{ saldo: number; ppp: number }>;
      if (!list.length) return null;
      return { stock: Number(list[0].saldo), ppp: Number(list[0].ppp) };
    } finally {
      await conn.end();
    }
  } catch {
    return null;
  }
}

/** Redondeo a 3 decimales (misma tolerancia que los oráculos). */
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Última ENTRADA viva de un PRODUCTO (cantidad en UM base y PPP unitario). */
async function leerUltimaEntradaProducto(
  productoId: number,
  almacenId: number,
): Promise<{ cantidad: number; ppp: number } | null> {  try {
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
        'SELECT movimientoalmaceninsumo_cantidad AS cant, movimientoalmaceninsumo_costopromedioactual AS ppp ' +
          'FROM movimientoalmaceninsumo WHERE producto_id = ? AND almacen_id = ? ' +
          "AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1') " +
          'ORDER BY movimientoalmaceninsumo_id DESC LIMIT 1',
        [productoId, almacenId],
      );
      const list = rows as Array<{ cant: number; ppp: number }>;
      if (!list.length) return null;
      return { cantidad: Number(list[0].cant), ppp: Number(list[0].ppp) };
    } finally {
      await conn.end();
    }
  } catch {
    return null;
  }
}

async function compraHelper(
  page: Page,
  ctx: ContextoCompra,
  lineas: LineaDetalle[],
  opts: {
    ordenCompraId?: number;
    guiaId?: number;
    esCredito?: boolean;
    /** Cuotas de crédito con los nombres de campo que espera el backend (comprasporpagar_*). */
    cuotas?: Array<{ comprasporpagar_totalcuota: number; comprasporpagar_interes: number; comprasporpagar_diapago: string; comprasporpagar_capital?: number }>;
    esAlCredito?: boolean;
  } = {},
): Promise<ResultadoOperacion> {
  const serie = serieUnica('C');
  const numero = serieUnica('C');
  const tot = calcularTotales(
    lineas.map((l) => ({ cantidad: l.cantidad, costo: l.costo, afecto: l.afecto })),
    ctx.igv,
  );
  return page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Cr = injector.get('CompraResource');
    const payload = {
      compra: {
        local_id: args.localId,
        proveedor_id: args.proveedorId,
        moneda_id: args.monedaId,
        compra_tipocambio: args.tipoCambio,
        compra_fecha: args.fecha,
        compra_fechatributacion: args.fecha,
        compra_tipodoc: 'FACTURA',
        compra_seriedoc: args.serie,
        compra_nrodoc: args.numero,
        compra_ordencompraList: args.ordenCompraId ? [args.ordenCompraId] : [],
        compra_guiaList: args.guiaId ? [args.guiaId] : [],
        compra_conguia: args.guiaId ? '1' : '0',
        // Flags char(1): el ERP define SI='1' / NO='0' (definitions.php:42-43).
        // Mandar 'SI' se trunca a 'S' y el backend no ve la compra al crédito.
        compra_esalcredito: args.esCredito ? '1' : '0',
        generarIGV_sobreTotal: '0',
        compra_subtotal: args.tot.subtotal,
        compra_igv: args.tot.igv,
        compra_total: args.tot.total,
        compra_descuento: 0,
        compra_flete: 0,
        compra_icbper: 0,
        compra_percepciontotal: 0,
      },
      productos: args.lineas.map((l) => ({
        item_id: l.itemId,
        item_tipo: l.itemTipo,
        detallecompra_descripcion: l.descripcion || '',
        detallecompra_cantidad: l.cantidad,
        detallecompra_costo: l.costo,
        detallecompra_precio: l.costo,
        detallecompra_importe: l.cantidad * l.costo,
        almacen_id: l.almacenId,
        producto_id: l.itemTipo === 2 ? l.itemId : null,
        presentacioninsumo_id: l.itemTipo === 1 ? l.presentacionId : null,
        presentacioncompraproducto_id: l.itemTipo === 2 ? l.presentacionId : null,
        detallecompra_afectoimpuestos: l.afecto,
        compra_id: '-1',
      })),
      cuotas: args.cuotas || [],
    };
    try {
      const r = await Cr.agregar(payload);
      return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio, fecha: fechaHora(), serie, numero, ordenCompraId: opts.ordenCompraId, guiaId: opts.guiaId, esCredito: opts.esCredito, cuotas: opts.cuotas, lineas, tot });
}

// F1: Solicitud -> OC -> Compra (afecto con impuestos)
export const flujoF1: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const fechaEntrega = hoyMas(1);
  const fechaVenc = hoyMas(7);
  const carneId = maestro(estado, 'Carne QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  if (!presCarne) return [{ paso: 'F1.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Carne QA' }];

  const previo = await leerPrevio(page, 'Carne QA');
  const linea = { itemTipo: 1 as const, itemId: carneId, presentacionId: presCarne, cantidad: 50, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' };

  const sol = await inyectarSolicitud(page, ctx, [linea], fechaEntrega);
  if (!sol.ok) return [{ paso: 'F1.solicitud', ok: false, esperado: 'creada', error: sol.error }];
  estado.solicitudes.set('F1', sol.id!);
  resultados.push({ paso: 'F1.solicitud', ok: true, esperado: 'creada', real: `id=${sol.id}` });

  await navegar(page, 'logistica.requerimientocompra.listarequerimientocompra');
  await page.evaluate(async (id) => {
    const injector = angular.element(document.body).injector();
    const Requerimientocompra = injector.get('Requerimientocompra');
    await Requerimientocompra.aprobar(id);
  }, sol.id);

  const oc = await inyectarOrdenCompra(page, ctx, [linea], fechaVenc, false, [sol.id!]);
  if (!oc.ok) return [...resultados, { paso: 'F1.oc', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F1', oc.id!);
  resultados.push({ paso: 'F1.oc', ok: true, esperado: 'creada', real: `id=${oc.id}` });

  const compra = await compraHelper(page, ctx, [linea], { ordenCompraId: oc.id });
  if (!compra.ok) return [...resultados, { paso: 'F1.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F1', compra.id!);
  resultados.push({ paso: 'F1.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  const divisor = 1 + ctx.igv / 100;
  const esperado = esperadoTrasEntrada(previo, 50, 20, divisor);
  const stock = await assertStock(page, 'Carne QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN);
  resultados.push(stock);

  const totales = calcularTotales([{ cantidad: 50, costo: 20, afecto: true }], ctx.igv);
  const tot = await assertTotales(compra.id!, totales, divisor);
  resultados.push(tot);

  return resultados;
};

// F2: Solicitud -> OC -> Guia -> Compra
export const flujoF2: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  if (!presCarne) return [{ paso: 'F2.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Carne QA' }];

  const previo = await leerPrevio(page, 'Carne QA');
  const linea = { itemTipo: 1 as const, itemId: carneId, presentacionId: presCarne, cantidad: 30, costo: 22, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' };

  const sol = await inyectarSolicitud(page, ctx, [linea], hoyMas(1));
  if (!sol.ok) return [{ paso: 'F2.solicitud', ok: false, esperado: 'creada', error: sol.error }];
  estado.solicitudes.set('F2', sol.id!);
  resultados.push({ paso: 'F2.solicitud', ok: true, esperado: 'creada', real: `id=${sol.id}` });

  await navegar(page, 'logistica.requerimientocompra.listarequerimientocompra');
  await page.evaluate(async (id) => {
    const injector = angular.element(document.body).injector();
    const Requerimientocompra = injector.get('Requerimientocompra');
    await Requerimientocompra.aprobar(id);
  }, sol.id);

  const oc = await inyectarOrdenCompra(page, ctx, [linea], hoyMas(7), false, [sol.id!]);
  if (!oc.ok) return [...resultados, { paso: 'F2.oc', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F2', oc.id!);
  resultados.push({ paso: 'F2.oc', ok: true, esperado: 'creada', real: `id=${oc.id}` });

  const guia = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const payload = {
      guia: {
        local_id: args.localId,
        proveedor_id: args.proveedorId,
        moneda_id: args.monedaId,
        guia_tipocambio: args.tipoCambio,
        guia_fechaemision: args.fecha,
        guia_serie: args.serie,
        guia_numeroguia: args.numero,
        ordencompraList: [args.ocId],
        guia_distribucion: '0',
      },
      productos: [{
        item_id: args.itemId,
        item_tipo: 1,
        detalleguia_descripcion: 'Carne QA',
        detalleguia_cantidad: 30,
        detalleguia_costo: 22,
        detalleguia_precio: 22,
        detalleguia_importe: 660,
        almacen_id: args.almacenId,
        insumo_id: args.itemId,
        presentacioninsumo_id: args.presentacionId,
        detalleguia_afectoaimpuestos: 'SI',
        guia_id: '-1',
      }],
    };
    try {
      const r = await Gr.agregar(payload);
      return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio, fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'), ocId: oc.id, itemId: carneId, almacenId: ctx.almacenId, presentacionId: presCarne });

  if (!guia.ok) return [...resultados, { paso: 'F2.guia', ok: false, esperado: 'creada', error: guia.error }];
  estado.guias.set('F2', guia.id!);
  resultados.push({ paso: 'F2.guia', ok: true, esperado: 'creada', real: `id=${guia.id}` });

  const divisor = 1 + ctx.igv / 100;
  const esperadoGuia = esperadoTrasEntrada(previo, 30, 22, divisor);
  const stockGuia = await assertStock(page, 'Carne QA', esperadoGuia.stock, esperadoGuia.costo, esperadoGuia.sinImp, ALMACEN);
  resultados.push(stockGuia);

  const compra = await compraHelper(page, ctx, [linea], { guiaId: guia.id });
  if (!compra.ok) return [...resultados, { paso: 'F2.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F2', compra.id!);
  resultados.push({ paso: 'F2.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  const totales = calcularTotales([{ cantidad: 30, costo: 22, afecto: true }], ctx.igv);
  const tot = await assertTotales(compra.id!, totales, divisor);
  resultados.push(tot);

  return resultados;
};

// F3: OC manual -> Compra
export const flujoF3: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F3.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Arroz QA' }];

  const previo = await leerPrevio(page, 'Arroz QA');
  guardarPrevio(estado, 'F3', previo);
  const linea = { itemTipo: 1 as const, itemId: arrozId, presentacionId: presArroz, cantidad: 100, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' };

  const oc = await inyectarOrdenCompra(page, ctx, [linea], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F3.oc', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F3', oc.id!);
  resultados.push({ paso: 'F3.oc', ok: true, esperado: 'creada', real: `id=${oc.id}` });

  const compra = await compraHelper(page, ctx, [linea], { ordenCompraId: oc.id });
  if (!compra.ok) return [...resultados, { paso: 'F3.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F3', compra.id!);
  resultados.push({ paso: 'F3.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  const divisor = 1 + ctx.igv / 100;
  const esperado = esperadoTrasEntrada(previo, 100, 4, divisor);
  const stock = await assertStock(page, 'Arroz QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN);
  resultados.push(stock);

  const totales = calcularTotales([{ cantidad: 100, costo: 4, afecto: true }], ctx.igv);
  const tot = await assertTotales(compra.id!, totales, divisor);
  resultados.push(tot);

  return resultados;
};

// F4: Compra directa
export const flujoF4: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  if (!presCarne) return [{ paso: 'F4.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Carne QA' }];

  const previo = await leerPrevio(page, 'Carne QA');
  const linea = { itemTipo: 1 as const, itemId: carneId, presentacionId: presCarne, cantidad: 50, costo: 30, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' };

  const compra = await compraHelper(page, ctx, [linea]);
  if (!compra.ok) return [{ paso: 'F4.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F4', compra.id!);
  resultados.push({ paso: 'F4.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  const divisor = 1 + ctx.igv / 100;
  // El PPP sin impuestos se ACUMULA: no se reproyecta todo el stock al costo
  // unitario sin IGV de esta compra. Con 80kg previos a PPP-sin-IGV 17.585 y
  // una entrada de 50kg a 30 (25.424 sin IGV) el PPP-sin-IGV queda
  // (80*17.585 + 50*25.424)/130 = 20.600, y no 20.2086 (que reproyectaba los
  // 80kg al costo unitario de F1, 16.949).
  const esperado = esperadoTrasEntrada(previo, 50, 30, divisor);
  const stock = await assertStock(page, 'Carne QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN);
  resultados.push(stock);

  const totales = calcularTotales([{ cantidad: 50, costo: 30, afecto: true }], ctx.igv);
  const tot = await assertTotales(compra.id!, totales, divisor);
  resultados.push(tot);

  return resultados;
};

// F5: Exonerada
export const flujoF5: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const verduraId = maestro(estado, 'Verdura QA');
  const presVerdura = await resolverPresentacion(page, 'Verdura QA', 'Base');
  if (!presVerdura) return [{ paso: 'F5.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Verdura QA' }];

  const previo = await leerPrevio(page, 'Verdura QA');
  const linea = { itemTipo: 1 as const, itemId: verduraId, presentacionId: presVerdura, cantidad: 10, costo: 10, almacenId: ctx.almacenId, afecto: false, descripcion: 'Verdura QA' };

  const compra = await compraHelper(page, ctx, [linea]);
  if (!compra.ok) return [{ paso: 'F5.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F5', compra.id!);
  resultados.push({ paso: 'F5.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  // Exonerada: el costo con y sin impuestos es el MISMO (no hay desgravación).
  const esperado = esperadoTrasEntrada(previo, 10, 10, 1);
  const stock = await assertStock(page, 'Verdura QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN);
  resultados.push(stock);

  const totales = calcularTotales([{ cantidad: 10, costo: 10, afecto: false }], ctx.igv);
  const tot = await assertTotales(compra.id!, totales, 1);
  resultados.push(tot);

  return resultados;
};

// F6: NC por cantidad (devolución) sobre la compra de F4.
// Effecto: SALIDA_NOTA_CREDITO_COMPRA -> baja el stock y CONGELA el PPP
// (una salida no promedia: MovimientalmaceninsumoV2:208-213).
export const flujoF6: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const compraId = estado.compras.get('F4');
  if (!compraId) return [{ paso: 'F6.compra', ok: false, esperado: 'compra F4 existente', error: 'No hay compra F4 en el estado' }];

  const previo = await leerPrevio(page, 'Carne QA');
  const cantidad = 10;

  const { registrarNotaCredito } = await import('../../compras');
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: 'Carne QA', insumoId: carneId, cantidad }]);
  if (!nc.ok) return [{ paso: 'F6.nc', ok: false, esperado: 'creada', error: nc.error }];
  estado.nc.set('F6', nc.id!);
  resultados.push({ paso: 'F6.nc', ok: true, esperado: 'creada', real: `id=${nc.id}` });

  // La NC por cantidad NO promedia: solo resta unidades y deja el PPP igual.
  resultados.push(await assertStock(page, 'Carne QA', previo.stock - cantidad, previo.costo, previo.sinImp, ALMACEN));
  resultados.push(await assertUltimaSalida(carneId, ctx.almacenId, cantidad));

  return resultados;
};

// F7: NC por precio (rebaja) sobre la compra de F5.
// Effecto: NO hay salida de stock; el backend clona la ENTRADA_COMPRA origen
// (fueliminado=SI) con nuevoCosto=(importeOrig-desc*c cant)/cant y regulariza
// (NotacreditocompraLogistica:224-404). El stock no se toca, el costo baja.
export const flujoF7: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const verduraId = maestro(estado, 'Verdura QA');
  const compraId = estado.compras.get('F5');
  if (!compraId) return [{ paso: 'F7.compra', ok: false, esperado: 'compra F5 existente', error: 'No hay compra F5 en el estado' }];

  const previo = await leerPrevio(page, 'Verdura QA');
  const cantidadComprada = 10;   // línea de F5: 10 kg de Verdura QA a S/ 10
  const precioOriginal = 10;
  const descuentoUnitario = 2;   // S/ 2 por unidad

  const { registrarNotaCredito } = await import('../../compras');
  const nc = await registrarNotaCredito(
    page,
    compraId,
    [{ nombre: 'Verdura QA', insumoId: verduraId, cantidad: 0, descuentoUnitario }],
    { porPrecio: true },
  );
  if (!nc.ok) return [{ paso: 'F7.nc', ok: false, esperado: 'creada', error: nc.error }];
  estado.nc.set('F7', nc.id!);
  resultados.push({ paso: 'F7.nc', ok: true, esperado: 'creada', real: `id=${nc.id}` });

  // nuevoCosto = (importeOriginal - descuentoUnitario*cantidad) / cantidadIngresada
  const nuevoCosto = (precioOriginal * cantidadComprada - descuentoUnitario * cantidadComprada) / cantidadComprada;
  // El stock NO se mueve; el PPP (y su vía sin impuestos) queda en el nuevo costo.
  resultados.push(await assertStock(page, 'Verdura QA', previo.stock, nuevoCosto, nuevoCosto, ALMACEN));

  return resultados;
};

// F8: Modificar compra (hacia adelante): la compra de F3 (100 kg de Arroz QA
// a S/ 4) pasa a S/ 5. La cantidad NO se mueve; el PPP se re-promedia hacia
// adelante y los impuestos se re-desgravan (DetallecompraLogistica:modificacionDetalle).
export const flujoF8: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const compraId = estado.compras.get('F3');
  if (!compraId) return [{ paso: 'F8.compra', ok: false, esperado: 'compra F3 existente', error: 'No hay compra F3 en el estado' }];

  const previo = await leerPrevio(page, 'Arroz QA');
  const cantidad = 100;
  const precioNuevo = 5;

  const { modificarCompra } = await import('../../compras');
  const r = await modificarCompra(page, compraId, [
    { nombre: 'Arroz QA', insumoId: arrozId, cantidad, precio: precioNuevo },
  ]);
  if (!r.ok) return [{ paso: 'F8.modificar', ok: false, esperado: 'modificada', error: r.error }];
  resultados.push({ paso: 'F8.modificar', ok: true, esperado: 'modificada', real: `compra id=${compraId}` });

  // La modificación re-proyecta el costo: la entrada vieja (cantidad a S/ 4)
  // se compensa y entra la nueva (cantidad a S/ 5) -> PPP = ((stock-cant)*PPP + cant*precio)/stock.
  const pppNuevo = ((previo.stock - cantidad) * previo.costo + cantidad * precioNuevo) / previo.stock;
  const sinNuevo = precioNuevo / (1 + ctx.igv / 100);
  resultados.push(await assertStock(page, 'Arroz QA', previo.stock, pppNuevo, sinNuevo, ALMACEN));

  // La desgravación se recalcula: el detalle persistido debe quedar en 5 sin IGV.
  const { assertDetalleCompraSinImpuestos } = await import('../oracle');
  const det = await assertDetalleCompraSinImpuestos(compraId, arrozId, precioNuevo, cantidad, true);
  resultados.push({ paso: 'F8.desgravacion', ok: det.ok, esperado: det.esperado, real: det.real, error: det.error });

  return resultados;
};

// F9: Anular compra (LIFO) con devolución de stock: la compra modificada en F8.
// Efecto: contra-salidas que devuelven el stock y restauran el PPP previo; la OC
// queda desvinculada (APROBADO, recanjeable) (CompraLogistica:2552-2609).
export const flujoF9: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const compraId = estado.compras.get('F3');
  const ocId = estado.ordenes.get('F3');
  if (!compraId) return [{ paso: 'F9.compra', ok: false, esperado: 'compra F3 existente', error: 'No hay compra F3 en el estado' }];

  const previo = await leerPrevio(page, 'Arroz QA');
  const cantidad = 100;

  const { anularCompra } = await import('../../compras');
  const r = await anularCompra(page, compraId, true);
  if (!r.ok) return [{ paso: 'F9.anular', ok: false, esperado: 'anulada', error: r.error }];
  resultados.push({ paso: 'F9.anular', ok: true, esperado: 'anulada', real: `compra id=${compraId}` });

  // Contra-salidas: el stock vuelve al que había antes de la entrada de F3 y el
  // PPP se restaura (queda el estado previo de F3).
  const previoF3 = estado.preEstados ? estado.preEstados.get('F3') : undefined;
  const stockEsperado = previoF3 ? previoF3.stock : previo.stock - cantidad;
  const costoEsperado = previoF3 ? previoF3.costo : 0;
  const sinEsperado = previoF3 ? previoF3.sinImp : 0;
  resultados.push(await assertStock(page, 'Arroz QA', stockEsperado, costoEsperado, sinEsperado, ALMACEN));
  // La anulación marca la ENTRADA como fueeliminado=SI (no crea contra-SALIDA).
  resultados.push(await assertSinMovimientosVivos(arrozId, ctx.almacenId));

  // La OC queda desvinculada y recanjeable (estado APROBADO).
  if (ocId) {
    const oc = await page.evaluate(async (id) => {
      try {
        const injector = angular.element(document.body).injector();
        const R = injector.get('OrdencompraResource');
        const resp = await R.obtenerOrdencompra(id);
        const d = resp && resp.data ? resp.data : null;
        const cab = d && d.ordencompra ? d.ordencompra : d;
        return cab ? { compra_id: cab.compra_id, estado: cab.ordencompra_estado } : null;
      } catch {
        return null;
      }
    }, ocId);
    const ok = oc !== null && (oc.compra_id === null || oc.compra_id === undefined || String(oc.compra_id) === '');
    resultados.push({
      paso: 'F9.ocDesvinculada',
      ok,
      esperado: 'compra_id=null; estado=APROBADO (1)',
      real: oc ? `compra_id=${oc.compra_id}; estado=${oc.estado}` : 'sin lectura',
      error: ok ? undefined : 'La OC sigue vinculada a la compra anulada.',
    });
  }

  return resultados;
};

// F13: Consumible (tabla espejo) y producto de reventa.
//  - C1 Caja Empaque QA: compra 200 u a S/ 0.5 -> espejo 0->200 (PPP 0.5) y la
//    salida de 50 u lo deja en 150 con el costo congelado.
//  - P1 Gaseosa QA: compra 12 packs (Pack x6) -> 72 unidades (conversion x6).
//  - P2 Gaseosa Sin Control QA: la compra se registra pero NO genera movimiento.
export const flujoF13: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const { resolverPresentacionProducto } = await import('./seed');
  const { registrarSalidaConsumible } = await import('../consumibles.spec');
  const { leerStockConsumible } = await import('../oracle');
  const { assertSinMovimientoProducto } = await import('./oraculo');

  // --- C1: consumible (espejo) ---
  const consumibleId = maestro(estado, 'Caja Empaque QA');
  const presConsumible = await resolverPresentacion(page, 'Caja Empaque QA', 'Base');
  if (!presConsumible) {
    return [{ paso: 'F13.presentacion', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Caja Empaque QA' }];
  }
  const compraConsumible = await compraHelper(
    page,
    ctx,
    [{ itemTipo: 1, itemId: consumibleId, presentacionId: presConsumible, cantidad: 200, costo: 0.5, almacenId: ctx.almacenId, afecto: true, descripcion: 'Caja Empaque QA' }],
  );
  if (!compraConsumible.ok) return [{ paso: 'F13.compraConsumible', ok: false, esperado: 'creada', error: compraConsumible.error }];
  estado.compras.set('F13.consumible', compraConsumible.id!);
  resultados.push({ paso: 'F13.compraConsumible', ok: true, esperado: 'creada', real: `id=${compraConsumible.id}` });

  const espejo1 = await leerStockConsumible(consumibleId, ctx.almacenId);
  const okEspejo1 = espejo1 !== null && Math.abs(espejo1.stock - 200) < 0.02 && Math.abs(espejo1.costo - 0.5) < 0.02;
  resultados.push({
    paso: 'F13.espejo200',
    ok: okEspejo1,
    esperado: 'stock=200; costo=0.5 (tabla espejo)',
    real: espejo1 ? `stock=${espejo1.stock}; costo=${espejo1.costo}` : 'sin movimientos',
    error: okEspejo1 ? undefined : 'Divergencia en la tabla espejo del consumible.',
  });

  const salida = await registrarSalidaConsumible(page, 'Caja Empaque QA', 50, 'Consumo operativo QA (F13)');
  resultados.push({ paso: 'F13.salida50', ok: salida.ok, esperado: 'registrada', real: salida.id !== undefined ? `id=${salida.id}` : undefined, error: salida.error });
  const espejo2 = await leerStockConsumible(consumibleId, ctx.almacenId);
  const okEspejo2 = espejo2 !== null && Math.abs(espejo2.stock - 150) < 0.02 && Math.abs(espejo2.costo - 0.5) < 0.02;
  resultados.push({
    paso: 'F13.espejo150',
    ok: okEspejo2,
    esperado: 'stock=150; costo=0.5 (congelado por la salida)',
    real: espejo2 ? `stock=${espejo2.stock}; costo=${espejo2.costo}` : 'sin movimientos',
    error: okEspejo2 ? undefined : 'Divergencia tras la salida del consumible.',
  });

  // --- P1: producto de reventa, presentación Pack x6 ---
  const gaseosaId = maestro(estado, 'Gaseosa QA');
  const presPack = await resolverPresentacionProducto('Gaseosa QA', 'Pack');
  if (!presPack) return [...resultados, { paso: 'F13.presentacionProducto', ok: false, esperado: 'presentación Pack resuelta', error: 'No se pudo resolver la presentación Pack de Gaseosa QA' }];

  const packs = 12;
  const precioPack = 3;
  // El PPP esperado se calcula desde el estado REAL previo del producto: la
  // entrada promedia (si el producto ya tenia unidades de otra compra, el PPP
  // no es el precio del pack sino el promedio ponderado).
  const previoProducto = await leerStockProducto(gaseosaId, ctx.almacenId);
  const compraProducto = await compraHelper(
    page,
    ctx,
    [{ itemTipo: 2, itemId: gaseosaId, presentacionId: presPack, cantidad: packs, costo: precioPack, almacenId: ctx.almacenId, afecto: true, descripcion: 'Gaseosa QA' }],
  );
  if (!compraProducto.ok) return [...resultados, { paso: 'F13.compraProducto', ok: false, esperado: 'creada', error: compraProducto.error }];
  resultados.push({ paso: 'F13.compraProducto', ok: true, esperado: 'creada', real: `id=${compraProducto.id}` });

  const movProducto = await leerUltimaEntradaProducto(gaseosaId, ctx.almacenId);
  const unidades = packs * 6; // conversion de la presentacion Pack (6 u por pack)
  const costoUnitario = precioPack / 6;
  // PPP = (stockAnt*PPPAnt + cant*costoOp) / (stockAnt + cant)
  const pppEsperado = previoProducto
    ? (previoProducto.stock * previoProducto.ppp + unidades * costoUnitario) / (previoProducto.stock + unidades)
    : costoUnitario;
  const okProducto = movProducto !== null && Math.abs(movProducto.cantidad - unidades) < 0.02 && Math.abs(movProducto.ppp - pppEsperado) < 0.02;
  resultados.push({
    paso: 'F13.producto72',
    ok: okProducto,
    esperado: `cantidad=${unidades} u (12 packs x 6); PPP=${r3(pppEsperado)}`,
    real: movProducto ? `cantidad=${movProducto.cantidad}; PPP=${movProducto.ppp}` : 'sin movimiento',
    error: okProducto ? undefined : 'Divergencia en la compra de producto (conversion de presentacion / PPP promedio).',
  });

  // --- P2: producto sin control de stock: la compra entra, el Kardex no ---
  const sinControlId = maestro(estado, 'Gaseosa Sin Control QA');
  const presUnidad = await resolverPresentacionProducto('Gaseosa Sin Control QA', 'UNIDAD');
  const compraSinControl = await compraHelper(
    page,
    ctx,
    [{ itemTipo: 2, itemId: sinControlId, presentacionId: presUnidad ?? undefined, cantidad: 10, costo: 2, almacenId: ctx.almacenId, afecto: true, descripcion: 'Gaseosa Sin Control QA' }],
  );
  if (!compraSinControl.ok) return [...resultados, { paso: 'F13.compraSinControl', ok: false, esperado: 'creada', error: compraSinControl.error }];
  resultados.push({ paso: 'F13.compraSinControl', ok: true, esperado: 'creada', real: `id=${compraSinControl.id}` });
  resultados.push(await assertSinMovimientoProducto(sinControlId, ctx.almacenId));

  return resultados;
};

/** Límite de crédito del proveedor (lo descuenta la compra al crédito). */
async function leerLimiteCredito(proveedorId: number): Promise<number | null> {
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
      const [rows] = await conn.query('SELECT proveedor_limitecredito AS limite FROM proveedor WHERE proveedor_id = ?', [proveedorId]);
      const v = (rows as Array<{ limite: number | null }>)[0]?.limite;
      return v === null || v === undefined ? null : Number(v);
    } finally {
      await conn.end();
    }
  } catch {
    return null;
  }
}

/** Conteos del doble detalle de una compra de SERVICIO. */
async function leerDetalleServicio(compraId: number): Promise<{ servicios: number; consumibles: number } | null> {
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
      const [s] = await conn.query('SELECT COUNT(*) AS n FROM detallecompraservicio WHERE compra_id = ?', [compraId]);
      const [c] = await conn.query('SELECT COUNT(*) AS n FROM detalleconsumiblecompra WHERE compra_id = ?', [compraId]);
      return {
        servicios: Number((s as Array<{ n: number }>)[0].n),
        consumibles: Number((c as Array<{ n: number }>)[0].n),
      };
    } finally {
      await conn.end();
    }
  } catch {
    return null;
  }
}

// F10: OC distribuida multi-local. Dos solicitudes (local 1 y local 2) se
// canjean juntas con "Activar distribucion por local" = SI: el backend crea
// 1 OC consolidada (30 kg) y una fila de distribucion por local solicitante
// (10 + 20). Luego la guia de cada local prorratea cantidad y precio.
export const flujoF10: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  if (!presCarne) return [{ paso: 'F10.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Carne QA' }];

  const LOCAL_A = 1;   // CD Logistico
  const LOCAL_B = 2;   // Lima
  const ALM_A = 1;
  const ALM_B = 2;

  // Paso 1: una solicitud por local (10 kg y 20 kg del mismo item/proveedor).
  const solA = await inyectarSolicitud(
    page,
    { ...ctx, localId: LOCAL_A, almacenId: ALM_A },
    [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 10, costo: 20, almacenId: ALM_A, afecto: true, descripcion: 'Carne QA' }],
    hoyMas(1),
  );
  if (!solA.ok) return [{ paso: 'F10.solicitudA', ok: false, esperado: 'creada', error: solA.error }];
  const solB = await inyectarSolicitud(
    page,
    { ...ctx, localId: LOCAL_B, almacenId: ALM_B },
    [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 20, costo: 20, almacenId: ALM_B, afecto: true, descripcion: 'Carne QA' }],
    hoyMas(1),
  );
  if (!solB.ok) return [...resultados, { paso: 'F10.solicitudB', ok: false, esperado: 'creada', error: solB.error }];
  resultados.push({ paso: 'F10.solicitudes', ok: true, esperado: '2 creadas (10 kg local 1 + 20 kg local 2)', real: `ids=${solA.id},${solB.id}` });

  // Aprobacion de las dos solicitudes.
  await navegar(page, 'logistica.requerimientocompra.listarequerimientocompra');
  await page.evaluate(async (ids) => {
    const injector = angular.element(document.body).injector();
    const Requerimientocompra = injector.get('Requerimientocompra');
    for (const id of ids) await Requerimientocompra.aprobar(id);
  }, [solA.id, solB.id]);

  // Paso 2: canje en 2 POST (pregunta de distribucion) con distribucion = SI.
  const canje = await page.evaluate(async (ids) => {
    const injector = angular.element(document.body).injector();
    const Requerimientocompra = injector.get('Requerimientocompra');
    try {
      const r1 = await Requerimientocompra.canjearRequerimientoPorOrdencompra(ids);
      if (Number(r1.tipo) !== 1 || !r1.data) {
        return { ok: false, error: 'canjearRequerimientoPorOrdencompra: ' + JSON.stringify(r1.mensajes || r1) };
      }
      const payload = Object.assign({}, r1.data, { distribucionByLocal: 1 });
      const r2 = await Requerimientocompra.generarOrdenCompraByRequerimiento(payload);
      return { ok: Number(r2.tipo) === 1, ocIds: r2.data, error: Number(r2.tipo) === 1 ? undefined : JSON.stringify(r2.mensajes || r2) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [solA.id, solB.id]);
  if (!canje.ok) return [...resultados, { paso: 'F10.canje', ok: false, esperado: '1 OC con distribucion', error: canje.error }];

  const ocIds: number[] = Array.isArray(canje.ocIds) ? canje.ocIds.map(Number) : [Number(canje.ocIds)];
  resultados.push({ paso: 'F10.canje', ok: true, esperado: '1 OC con distribucion', real: `ocIds=${ocIds.join(',')}` });
  if (ocIds.length !== 1) {
    return [...resultados, { paso: 'F10.ocUnica', ok: false, esperado: '1 OC consolidada', error: 'El canje creo ' + ocIds.length + ' OCs' }];
  }
  const ocId = ocIds[0];
  estado.ordenes.set('F10', ocId);

  // La OC consolidada: distribucion ACTIVA (el estado se reporta, no se exige:
  // el canje lo crea en ACEPTADA segun el frontend) y 2 filas de distribucion.
  resultados.push(await assertEstadoOC(ocId, { distribucion: '1' }));
  resultados.push(await assertDistribucionOC(ocId, [{ localId: LOCAL_A, cantidad: 10 }, { localId: LOCAL_B, cantidad: 20 }]));
  resultados.push(await assertVinculosCanje(ocId, 2));

  // Paso 3: guia por local (la distribucion reparte cantidad y precio).
  const guiaB = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const payload = {
      guia: {
        local_id: args.localId,
        proveedor_id: args.proveedorId,
        moneda_id: args.monedaId,
        guia_tipocambio: args.tipoCambio,
        guia_fechaemision: args.fecha,
        guia_serie: args.serie,
        guia_numeroguia: args.numero,
        ordencompraList: [args.ocId],
        guia_distribucion: '1',
      },
      productos: [{
        item_id: args.itemId,
        item_tipo: 1,
        detalleguia_descripcion: 'Carne QA',
        detalleguia_cantidad: args.cantidad,
        detalleguia_costo: args.costo,
        detalleguia_precio: args.costo,
        detalleguia_importe: args.cantidad * args.costo,
        almacen_id: args.almacenId,
        insumo_id: args.itemId,
        presentacioninsumo_id: args.presentacionId,
        detalleguia_afectoaimpuestos: 'SI',
        guia_id: '-1',
      }],
    };
    try {
      const r = await Gr.agregar(payload);
      return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, {
    localId: LOCAL_B, almacenId: ALM_B, ocId, itemId: carneId, presentacionId: presCarne,
    proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio,
    fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'), cantidad: 20, costo: 20,
  });
  resultados.push({ paso: 'F10.guiaLocal2', ok: guiaB.ok, esperado: 'registrada (20 kg en el local 2)', real: guiaB.id !== undefined ? `id=${guiaB.id}` : undefined, error: guiaB.error });
  if (guiaB.ok) {
    estado.guias.set('F10.B', guiaB.id!);
    // La guia del local 2 ingresa 20 kg en su almacen (stock por almacen).
    resultados.push(await assertStockPorAlmacen(carneId, ALM_B, 20));
  }

  return resultados;
};

// F11: Credito + cuotas. La compra al credito NO cambia el flujo del stock
// (la mercaderia entra igual) pero genera CxP: una fila de comprasporpagar
// por cuota y descuenta el limite de credito del proveedor.
export const flujoF11: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F11.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];

  const previo = await leerPrevio(page, 'Arroz QA');
  const cantidad = 200;
  const costo = 4;
  const total = cantidad * costo;
  const totalCuota = total / 2;

  // Limite de credito del proveedor ANTES de la compra (el backend lo resta).
  const limiteAntes = await leerLimiteCredito(ctx.proveedorId);

  const compra = await compraHelper(
    page,
    ctx,
    [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad, costo, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }],
    {
      esCredito: true,
      cuotas: [
        { comprasporpagar_totalcuota: totalCuota, comprasporpagar_interes: 0, comprasporpagar_diapago: hoyMas(30), comprasporpagar_capital: totalCuota },
        { comprasporpagar_totalcuota: totalCuota, comprasporpagar_interes: 0, comprasporpagar_diapago: hoyMas(60), comprasporpagar_capital: totalCuota },
      ],
    },
  );
  if (!compra.ok) return [{ paso: 'F11.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F11', compra.id!);
  resultados.push({ paso: 'F11.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  // La compra al credito mueve el stock igual que una compra contado.
  const divisor = 1 + ctx.igv / 100;
  const esperado = esperadoTrasEntrada(previo, cantidad, costo, divisor);
  resultados.push(await assertStock(page, 'Arroz QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN));

  // CxP: 2 cuotas de 400 y el limite de credito del proveedor descontado.
  resultados.push(await assertCuotasCredito(compra.id!, { n: 2, totalcuota: totalCuota }));
  const limiteDespues = await leerLimiteCredito(ctx.proveedorId);
  const limiteEsperado = limiteAntes !== null && limiteAntes > total ? limiteAntes - total : 0;
  const okLimite = limiteDespues !== null && Math.abs(limiteDespues - limiteEsperado) < 0.02;
  resultados.push({
    paso: 'F11.limiteCredito',
    ok: okLimite,
    esperado: `limite=${limiteEsperado} (antes ${limiteAntes})`,
    real: limiteDespues === null ? 'sin dato' : `limite=${limiteDespues}`,
    error: okLimite ? undefined : 'El limite de credito del proveedor no se desconto como espera el backend.',
  });

  const totales = calcularTotales([{ cantidad, costo, afecto: true }], ctx.igv);
  resultados.push(await assertTotales(compra.id!, totales, divisor));

  return resultados;
};

// F12: Compra de SERVICIO (intangible). Va por su PROPIA ruta REST
// (compra/agregarCompraServicio): con la ruta normal el backend la procesa
// como compra corriente y le hace una ENTRADA_COMPRA. Un servicio puro no
// genera ningun movimiento de Kardex (compra-servicio.md §2): los consumibles
// del servicio salen con SALIDA_COMPRA_SERVICIO, nunca entran.
export const flujoF12: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const gaseosaId = maestro(estado, 'Gaseosa QA');
  const presUnidad = await resolverPresentacionProducto('Gaseosa QA', 'UNIDAD');
  if (!presUnidad) return [{ paso: 'F12.presentacion', ok: false, esperado: 'presentacion UNIDAD resuelta', error: 'No se pudo resolver la presentacion de Gaseosa QA' }];

  const compra = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Cr = injector.get('CompraResource');
    const payload = {
      compra: {
        local_id: args.localId,
        proveedor_id: args.proveedorId,
        moneda_id: args.monedaId,
        compra_tipocambio: args.tipoCambio,
        compra_fecha: args.fecha,
        compra_fechatributacion: args.fecha,
        compra_tipodoc: 'FACTURA',
        compra_seriedoc: args.serie,
        compra_nrodoc: args.numero,
        compra_tipo: 2,
        compra_esalcredito: '0',
        compra_subtotal: 84.746,
        compra_igv: 15.254,
        compra_total: 100,
        compra_descuento: 0,
        compra_flete: 0,
        compra_icbper: 0,
        compra_percepciontotal: 0,
      },
      productos: [],
      detalles: [{
        detallecompraservicio_descripcion: 'Fumigacion QA',
        detallecompraservicio_precio: 100,
        detallecompraservicio_estado: '1',
      }],
    };
    try {
      const r = await Cr.agregarCompraServicio(payload);
      return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, {
    localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio,
    fecha: fechaHora(), serie: serieUnica('S'), numero: serieUnica('S'),
    itemId: gaseosaId, presentacionId: presUnidad, almacenId: ctx.almacenId,
  });
  if (!compra.ok) return [{ paso: 'F12.compraServicio', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F12', compra.id!);
  resultados.push({ paso: 'F12.compraServicio', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  // Un servicio NO hace entrada de Kardex: el producto de control sigue sin
  // movimientos (ni ENTRADA_COMPRA ni SALIDA_COMPRA_SERVICIO: no lleva materiales).
  resultados.push(await assertSinMovimientoProducto(gaseosaId, ctx.almacenId));
  // Y el detalle de servicio quedo persistido.
  const detalle = await leerDetalleServicio(compra.id!);
  resultados.push({
    paso: 'F12.detalleServicio',
    ok: detalle !== null && detalle.servicios === 1,
    esperado: '1 linea de servicio (detallecompraservicio)',
    real: detalle ? `servicios=${detalle.servicios}; consumibles=${detalle.consumibles}` : 'sin lectura',
    error: detalle && detalle.servicios === 1 ? undefined : 'El detalle de servicio no se persistio.',
  });

  return resultados;
};

export const FLUJOS: Record<string, FlujoFn> = {
  F1: flujoF1, F2: flujoF2, F3: flujoF3, F4: flujoF4, F5: flujoF5,
  F6: flujoF6, F7: flujoF7, F8: flujoF8, F9: flujoF9, F10: flujoF10,
  F11: flujoF11, F12: flujoF12, F13: flujoF13,
};
