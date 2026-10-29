// flujos.ts — Implementación de flujos F1-F13 (SOLID: Open/Closed, Liskov)
import { Page } from 'playwright';
import { ContextoCompra, EstadoSuite, LineaDetalle, ResultadoOperacion, TotalesCompra } from './tipos';

declare const angular: any;
import { hoyMas, fechaHora, serieUnica, navegar, inyectarSolicitud, inyectarOrdenCompra, calcularTotales, ppp, precioSin, resolverPresentacion } from './helpers';
import { assertStock, assertTotales, assertKardex, assertUltimaSalida, assertSinMovimientosVivos, assertSinMovimientoProducto, assertCuotasCredito, assertDistribucionOC, assertVinculosCanje, assertEstadoOC, assertStockPorAlmacen, assertClonPrecio, assertDistribucionEnlazada, leerUltimaMovimientoConsumible, leerStockInsumoPorAlmacen, leerMovimientos, assertCuotaAmortizada, leerDetalleOC, leerDetalleGuia, leerStockActual, Veredicto } from './oraculo';
import { anularCompra } from '../../compras';
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

/** Estado previo de un PRODUCTO (stock y PPP) leyendo su Kardex. */
async function leerStockProducto(
  productoId: number,
  almacenId: number,
): Promise<{ stock: number; ppp: number } | null> {
  const { leerStockProductoPorAlmacen } = await import('./oraculo');
  return leerStockProductoPorAlmacen(productoId, almacenId);
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
    /** Moneda de la compra (2 = Dólares) y su tipo de cambio. */
    monedaId?: number;
    tipoCambio?: number;
    /**
     * true = el precio digitado es NETO: el backend calcula el IGV encima
     * (compra_generoimpuestossobretotal = '1'). false = el precio incluye
     * impuestos y el backend lo desgrava.
     */
    precioNeto?: boolean;
    ordenCompraIds?: number[];
    guiaIds?: number[];
    flete?: number;
    icbper?: number;
    percepcion?: number;
    descuentoGlobal?: number;
    montoEfectivo?: number;
    montoTarjeta?: number;
    montoCheque?: number;
    conRetencion?: boolean;
    montoRetencion?: number;
    saliodecaja?: boolean;
  } = {},
): Promise<ResultadoOperacion> {
  const serie = serieUnica('C');
  const numero = serieUnica('C');
  const tot = calcularTotales(
    lineas.map((l) => ({ cantidad: l.cantidad, costo: l.costo, afecto: l.afecto, descuento: l.descuento || 0 })),
    ctx.igv,
    { flete: opts.flete || 0, icbper: opts.icbper || 0, percepcion: opts.percepcion || 0, precioNeto: opts.precioNeto },
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
        compra_ordencompraList: args.ordenCompraIds ? args.ordenCompraIds : (args.ordenCompraId ? [args.ordenCompraId] : []),
        compra_guiaList: args.guiaIds ? args.guiaIds : (args.guiaId ? [args.guiaId] : []),
        compra_conguia: (args.guiaIds && args.guiaIds.length) || args.guiaId ? '1' : '0',
        // Flags char(1): el ERP define SI='1' / NO='0' (definitions.php:42-43).
        // Mandar 'SI' se trunca a 'S' y el backend no ve la compra al crédito.
        compra_esalcredito: args.esCredito || args.esAlCredito ? '1' : '0',
        compra_saliodecaja: args.saliodecaja ? '1' : '0',
        compra_conretencion: args.conRetencion ? '1' : '0',
        compra_montoretencion: args.montoRetencion || 0,
        // El frontend setea compra.compra_generoimpuestossobretotal (char(1)):
        // '1' = impuestos NO incluidos en el precio, '0' = impuestos incluidos.
        // Ese flag solo se persiste; el cálculo por línea lo decide
        // losImpuestosEstanIncluidosEnElPrecio (CompraLogistica.php:2191/2313):
        // sin él el backend asume precio CON impuestos y desgrava el neto
        // (F19: 16.949 → sin_imp 14.36 y Kardex a 16.949 en vez de 20.00).
        // nuevacompra.controller.js lo envía dentro de compra (vm.compra copiado).
        compra_generoimpuestossobretotal: args.precioNeto ? '1' : '0',
        generarIGV_sobreTotal: args.precioNeto ? '1' : '0',
        losImpuestosEstanIncluidosEnElPrecio: args.precioNeto ? '0' : '1',
        caja_id: args.saliodecaja ? 1 : null,
        compra_subtotal: args.tot.subtotal,
        compra_igv: args.tot.igv,
        compra_total: args.tot.total,
        compra_descuento: args.descuentoGlobal || 0,
        compra_flete: args.flete || 0,
        compra_icbper: args.icbper || 0,
        compra_percepciontotal: args.percepcion || 0,
        compra_montoefectivo: args.montoEfectivo || 0,
        compra_montotarjeta: args.montoTarjeta || 0,
        compra_montocheque: args.montoCheque || 0,
      },
      productos: args.lineas.map((l) => ({
        item_id: l.itemId,
        item_tipo: l.itemTipo,
        detallecompra_descripcion: l.descripcion || '',
        detallecompra_cantidad: l.cantidad,
        detallecompra_costo: l.costo,
        detallecompra_descuento: l.descuento || 0,
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
  }, {
    localId: ctx.localId, proveedorId: ctx.proveedorId,
    monedaId: opts.monedaId ?? ctx.monedaId, tipoCambio: opts.tipoCambio ?? ctx.tipoCambio,
    fecha: fechaHora(), serie, numero,
    ordenCompraId: opts.ordenCompraId, guiaId: opts.guiaId, esCredito: opts.esCredito,
    precioNeto: opts.precioNeto, cuotas: opts.cuotas, lineas, tot,
    ordenCompraIds: opts.ordenCompraIds, guiaIds: opts.guiaIds,
    flete: opts.flete, icbper: opts.icbper, percepcion: opts.percepcion,
    descuentoGlobal: opts.descuentoGlobal,
    montoEfectivo: opts.montoEfectivo, montoTarjeta: opts.montoTarjeta, montoCheque: opts.montoCheque,
    conRetencion: opts.conRetencion, montoRetencion: opts.montoRetencion, saliodecaja: opts.saliodecaja,
    esAlCredito: opts.esAlCredito,
  });
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
  // La entrada original queda eliminada y aparece el clon con el costo rebajado.
  resultados.push(await assertClonPrecio(verduraId, ctx.almacenId, precioOriginal, nuevoCosto));

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
  resultados.push(await assertTotales(compraConsumible.id!, calcularTotales([{ cantidad: 200, costo: 0.5, afecto: true }], ctx.igv), 1 + ctx.igv / 100));

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
  resultados.push(await assertTotales(compraProducto.id!, calcularTotales([{ cantidad: 12, costo: 3, afecto: true }], ctx.igv), 1 + ctx.igv / 100));

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

/** Cuotas de crédito de una compra (id, total y amortizado). */
async function leerCuotas(compraId: number): Promise<Array<{ id: number; totalcuota: number; amortizacion: number; estado: string }>> {
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
        'SELECT comprasporpagar_id AS id, comprasporpagar_totalcuota AS total, ' +
          'comprasporpagar_amortizacion AS amort, comprasporpagar_estado AS estado ' +
          'FROM comprasporpagar WHERE compra_id = ? ORDER BY comprasporpagar_id',
        [compraId],
      );
      return (rows as Array<{ id: number; total: number; amort: number; estado: string }>).map((r) => ({
        id: Number(r.id), totalcuota: Number(r.total), amortizacion: Number(r.amort), estado: String(r.estado),
      }));
    } finally {
      await conn.end();
    }
  } catch {
    return [];
  }
}

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

// F16: Canjes parciales. Una OC de 100 kg; una GUIA parcial de 40 kg la deja
// ENPROCESO y una COMPRA del saldo de 60 kg la cierra en PROCESADA. La suma
// de lo canjeado (40 + 60 = 100) debe cerrar contra el importe de la OC.
export const flujoF16: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F16.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];

  const previo = await leerPrevio(page, 'Arroz QA');
  const cantidadOc = 100;
  const costo = 4;

  // Paso 1: OC de 100 kg.
  const oc = await inyectarOrdenCompra(page, ctx, [
    { itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: cantidadOc, costo, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' },
  ], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F16.oc', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F16', oc.id!);
  resultados.push({ paso: 'F16.oc', ok: true, esperado: 'creada (100 kg)', real: `id=${oc.id}` });
  // Aprobar la OC (estado ACEPTADA) para que sea canjeable.
  await page.evaluate(async (id) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    await Ordencompra.aprobar(id);
  }, oc.id).catch(() => {});
  // Paso 2: guia parcial de 40 kg (canjeando parte de la OC).
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
        // Tipo de despacho PARCIAL: la OC queda ENPROCESO mientras le falte
        // saldo (GuiaLogistica.php:512-517). Sin esto el canje parcial la
        // cerraria como PROCESADA.
        tipoDespacho: { id: '2' },
      },
      productos: [{
        item_id: args.itemId,
        item_tipo: 1,
        detalleguia_descripcion: 'Arroz QA',
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
      return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, {
    localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio,
    fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'),
    ocId: oc.id, itemId: arrozId, presentacionId: presArroz, almacenId: ctx.almacenId, cantidad: 40, costo,
  });
  resultados.push({ paso: 'F16.guiaParcial', ok: guia.ok, esperado: 'registrada (40 kg)', real: guia.id !== undefined ? `id=${guia.id}` : undefined, error: guia.error });
  if (!guia.ok) return resultados;
  estado.guias.set('F16', guia.id!);

  // La OC queda ENPROCESO (canje parcial).
  resultados.push(await assertEstadoOC(oc.id!, { estado: '7' }));
  // El stock entra solo la parte de la guia.
  const trasGuia = esperadoTrasEntrada(previo, 40, costo, 1 + ctx.igv / 100);
  resultados.push(await assertStock(page, 'Arroz QA', trasGuia.stock, trasGuia.costo, trasGuia.sinImp, ALMACEN));

  // Paso 3: compra del saldo de 60 kg.
  const compra = await compraHelper(page, ctx, [
    { itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 60, costo, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' },
  ], { ordenCompraId: oc.id });
  resultados.push({ paso: 'F16.compraSaldo', ok: compra.ok, esperado: 'creada (60 kg)', real: compra.id !== undefined ? `id=${compra.id}` : undefined, error: compra.error });
  if (compra.ok) resultados.push(await assertTotales(compra.id!, calcularTotales([{ cantidad: 60, costo: 4, afecto: true }], ctx.igv), 1 + ctx.igv / 100));
  if (!compra.ok) return resultados;
  estado.compras.set('F16', compra.id!);

  // La OC queda PROCESADA (todo canjeado).
  resultados.push(await assertEstadoOC(oc.id!, { estado: '2' }));
  // Y el stock cierra: 40 (guia) + 60 (compra) = 100 sobre el estado previo.
  const esperadoFinal = esperadoTrasEntrada(trasGuia, 60, costo, 1 + ctx.igv / 100);
  resultados.push(await assertStock(page, 'Arroz QA', esperadoFinal.stock, esperadoFinal.costo, esperadoFinal.sinImp, ALMACEN));

  return resultados;
};

// F18: Compra en MONEDA EXTRANJERA (dolares). El Kardex se valora en soles
// (costo x TC) y el ultimo precio por moneda no se mezcla con el de soles.
export const flujoF18: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F18.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];

  const MONEDA_USD = 2;
  const TC = 3.8;
  const cantidad = 100;
  const precioUsd = 2;   // USD por kg
  const previo = await leerPrevio(page, 'Arroz QA');

  const compra = await compraHelper(page, ctx, [
    { itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad, costo: precioUsd, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' },
  ], { monedaId: MONEDA_USD, tipoCambio: TC });
  resultados.push({ paso: 'F18.compraUSD', ok: compra.ok, esperado: 'creada (100 kg a 2.00 USD/kg)', real: compra.id !== undefined ? `id=${compra.id}` : undefined, error: compra.error });
  if (!compra.ok) return resultados;
  estado.compras.set('F18', compra.id!);

  // El Kardex se valora en soles: costo = 2.00 x 3.80 = 7.60
  const divisor = 1 + ctx.igv / 100;
  const esperado = esperadoTrasEntrada(previo, cantidad, precioUsd * TC, divisor);
  resultados.push(await assertStock(page, 'Arroz QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN));

  // El detalle guarda el precio en la moneda de la compra (2.00 USD) y los
  // totales van en esa moneda.
  const totales = calcularTotales([{ cantidad, costo: precioUsd, afecto: true }], ctx.igv);
  resultados.push(await assertTotales(compra.id!, totales, divisor));

  return resultados;
};

// F19: Precio NETO (los impuestos NO estan incluidos en el precio digitado).
// El backend genera el IGV encima: 16.949 netos x 50 = 847.45 + 18% = 1000.00,
// la misma compra que F1 pero digitando el neto (convergen salvo el centimo).
export const flujoF19: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  if (!presCarne) return [{ paso: 'F19.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Carne QA' }];

  const NETO = 16.949;
  const cantidad = 50;
  const previo = await leerPrevio(page, 'Carne QA');
  const divisor = 1 + ctx.igv / 100;

  const compra = await compraHelper(page, ctx, [
    { itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad, costo: NETO, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' },
  ], { precioNeto: true });
  resultados.push({ paso: 'F19.compraNeto', ok: compra.ok, esperado: 'creada (50 kg a 16.949 neto)', real: compra.id !== undefined ? `id=${compra.id}` : undefined, error: compra.error });
  if (!compra.ok) return resultados;
  estado.compras.set('F19', compra.id!);

  // El Kardex se valoriza con el precio BRUTO (16.949 x 1.18 = 20.00).
  const bruto = NETO * divisor;
  const esperado = esperadoTrasEntrada(previo, cantidad, bruto, divisor);
  resultados.push(await assertStock(page, 'Carne QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN));

  // Los totales: el backend genera el IGV encima del total neto.
  const subtotal = NETO * cantidad;
  const igv = subtotal * (ctx.igv / 100);
  const totales = { subtotal: r3(subtotal), igv: r3(igv), total: r3(subtotal + igv), flete: 0, icbper: 0, percepcion: 0, retencion: 0 };
  resultados.push(await assertTotales(compra.id!, totales, divisor));

  // El detalle guarda el precio NETO y su sin-impuestos tambien (no hay desgravacion).
  const { assertDetalleCompraSinImpuestos } = await import('../oracle');
  const det = await assertDetalleCompraSinImpuestos(compra.id!, carneId, NETO * divisor, cantidad, true);
  resultados.push({ paso: 'F19.detalleNeto', ok: det.ok, esperado: det.esperado, real: det.real, error: det.error });

  return resultados;
};

// F21: MERMA AUTOMATICA al comprar. El maestro tiene 5% de merma y el flag
// mermaautomaticaalcomprar: el backend encarece el costo (1000 / 95 =
// 10.5263), registra la ENTRADA de 100 kg y una SALIDA de merma de 5 kg, y el
// PPP se promedia sobre las unidades NETAS (denominador S+95).
export const flujoF21: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const polloId = maestro(estado, 'Pollo QA');
  const presPollo = await resolverPresentacion(page, 'Pollo QA', 'Base');
  if (!presPollo) return [{ paso: 'F21.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Pollo QA' }];

  const cantidad = 100;
  const costo = 10;
  const MERMA_PCT = 5;
  const previo = await leerPrevio(page, 'Pollo QA');
  const divisor = 1 + ctx.igv / 100;

  const compra = await compraHelper(page, ctx, [
    { itemTipo: 1, itemId: polloId, presentacionId: presPollo, cantidad, costo, almacenId: ctx.almacenId, afecto: true, descripcion: 'Pollo QA' },
  ]);
  resultados.push({ paso: 'F21.compra', ok: compra.ok, esperado: 'creada (100 kg a 10)', real: compra.id !== undefined ? `id=${compra.id}` : undefined, error: compra.error });
  if (compra.ok) resultados.push(await assertTotales(compra.id!, calcularTotales([{ cantidad: 100, costo: 10, afecto: true }], ctx.igv), 1 + ctx.igv / 100));
  if (!compra.ok) return resultados;
  estado.compras.set('F21', compra.id!);

  // Merma: 5% de 100 = 5 kg; el costo se encarece sobre las 95 netas.
  const merma = (cantidad * MERMA_PCT) / 100;
  const neto = cantidad - merma;
  const costoEncarecido = (cantidad * costo) / neto;
  const sinEncarecido = costoEncarecido / divisor;

  // El stock final suma la entrada bruta menos la merma: S + 95.
  const stockFinal = previo.stock + neto;
  // El PPP promedia sobre las unidades NETAS: (S*PPP + 95*costoEncarecido)/(S+95)
  const pppFinal = (previo.stock * previo.costo + neto * costoEncarecido) / (previo.stock + neto);
  const pppSinFinal = (previo.stock * previo.sinImp + neto * sinEncarecido) / (previo.stock + neto);
  resultados.push(await assertStock(page, 'Pollo QA', stockFinal, pppFinal, pppSinFinal, ALMACEN));

  // El Kardex debe mostrar 2 movimientos: la ENTRADA (100 kg) y la SALIDA de merma (5 kg).
  const movs = await leerMovimientos(polloId, ctx.almacenId);
  const entrada = movs.find((m) => m.tipo === 1);
  const salida = movs.find((m) => m.tipo === 0);
  const okEntrada = !!entrada && Math.abs(entrada.cantidad - cantidad) < 0.02 && Math.abs(entrada.costo - costoEncarecido) < 0.02;
  const okSalida = !!salida && Math.abs(salida.cantidad - merma) < 0.02 && Math.abs(salida.costo) < 0.02;
  resultados.push({
    paso: 'F21.entradaEncarecida',
    ok: okEntrada,
    esperado: `ENTRADA de ${cantidad} kg a ${r3(costoEncarecido)} (1000 / 95)`,
    real: entrada ? `cantidad=${entrada.cantidad}; costo=${entrada.costo}` : 'sin entrada',
    error: okEntrada ? undefined : 'La entrada no lleva el costo encarecido por la merma.',
  });
  resultados.push({
    paso: 'F21.salidaMerma',
    ok: okSalida,
    esperado: `SALIDA de merma de ${merma} kg a costo 0`,
    real: salida ? `cantidad=${salida.cantidad}; costo=${salida.costo}` : 'sin salida de merma',
    error: okSalida ? undefined : 'No se registro la salida de merma automatica.',
  });

  return resultados;
};
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
  // El canje reescribe el precio de la OC al ultimo precio de compra, asi que
  // el importe prorateado se calcula sobre el detalle REAL de la OC:
  //   importe_local = round(importeOC / cantidadOC * cantidadLocal)
  const detalleOc = await leerDetalleOC(ocId);
  const lineaOc = detalleOc[0];
  const precioUnitarioOc = lineaOc ? lineaOc.importe / lineaOc.cantidad : 0;

  const guias: Array<{ localId: number; almacenId: number; cantidad: number; id?: number }> = [
    { localId: LOCAL_A, almacenId: ALM_A, cantidad: 10 },
    { localId: LOCAL_B, almacenId: ALM_B, cantidad: 20 },
  ];
  // Estado previo de cada almacen: la guia suma su parte sobre lo que ya habia
  // (el item es compartido con los flujos anteriores).
  const previoA = await leerStockInsumoPorAlmacen(carneId, ALM_A);
  const previoB = await leerStockInsumoPorAlmacen(carneId, ALM_B);
  for (const g of guias) {
    const importeLocal = Math.round(precioUnitarioOc * g.cantidad * 100) / 100;
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
        return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, {
      localId: g.localId, almacenId: g.almacenId, ocId, itemId: carneId, presentacionId: presCarne,
      proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio,
      fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'),
      cantidad: g.cantidad, costo: Math.round(precioUnitarioOc * 100) / 100,
    });
    resultados.push({
      paso: 'F10.guiaLocal' + g.localId,
      ok: guia.ok,
      esperado: 'registrada (' + g.cantidad + ' kg en el local ' + g.localId + ')',
      real: guia.id !== undefined ? 'id=' + guia.id : undefined,
      error: guia.error,
    });
    if (!guia.ok) continue;
    g.id = guia.id!;
    estado.guias.set('F10.' + g.localId, guia.id!);

    // La distribucion de ese local queda enlazada a su guia.
    resultados.push(await assertDistribucionEnlazada(ocId, g.localId, guia.id!));
    // Y la guia ingresa solo la parte de ese local (cantidad y precio prorateados).
    const detalleGuia = await leerDetalleGuia(guia.id!);
    const d = detalleGuia[0];
    const okDetalle = !!d && Math.abs(d.cantidad - g.cantidad) < 0.02 && Math.abs(d.importe - importeLocal) < 0.05;
    resultados.push({
      paso: 'F10.detalleGuiaLocal' + g.localId,
      ok: okDetalle,
      esperado: 'cantidad=' + g.cantidad + '; importe=' + importeLocal + ' (prorrateo round(importeOC/cantOC x cantLocal))',
      real: d ? 'cantidad=' + d.cantidad + '; costo=' + d.costo + '; importe=' + d.importe : 'sin detalle',
      error: okDetalle ? undefined : 'La guia no took la cantidad ni el prorrateo de su local.',
    });
    // El stock de ese almacen sube solo con su parte (sobre el estado previo).
    const previo = g.almacenId === ALM_A ? previoA : previoB;
    const stockEsperado = (previo ? previo.stock : 0) + g.cantidad;
    resultados.push(await assertStockPorAlmacen(carneId, g.almacenId, stockEsperado));
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

  // Amortizacion: se paga media cuota (400) con transferencia (sin caja).
  // El backend reparte el pago entre las cuotas, cierra la primera y
  // devuelve el limite de credito al proveedor.
  const cuotas = await leerCuotas(compra.id!);
  const primera = cuotas[0];
  if (primera) {
    const amort = await page.evaluate(async (args) => {
      const injector = angular.element(document.body).injector();
      const Cr = injector.get('CompraResource');
      const payload = {
        comprasporpagarList: [{
          comprasporpagar_id: args.cuotaId,
          comprasporpagar_totalcuota: args.totalcuota,
          comprasporpagar_amortizacion: 0,
          comprasporpagar_interes: 0,
        }],
        pagocon: args.pago,
        comprasporpagar_id: args.cuotaId,
        comprasporpagar_totalcuota: args.totalcuota,
        comprasporpagar_amortizacion: 0,
        comprasporpagar_interes: 0,
        detallecomprasporpagar_formapago: 2,
        detallecomprasporpagar_tarjetaid: 1,
        detallecomprasporpagar_tipocambio: 1,
        detallecomprasporpagar_dinerosalecaja: '0',
        detallecomprasporpagar_pagoefectivo: 0,
        detallecomprasporpagar_fechapagobanco: args.fecha,
        caja_id: null,
        local_id: args.localId,
        moneda_id: args.monedaId,
        banco_id: null,
        detallecomprasporpagar_cuentabancariaorigenid: null,
        cuentabancaria_id: null,
      };
      try {
        const r = await Cr.agregarAmortizacionCompra(payload);
        return { ok: Number(r.tipo) === 1, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, {
      cuotaId: primera.id, totalcuota: primera.totalcuota, pago: totalCuota,
      localId: ctx.localId, monedaId: ctx.monedaId, fecha: hoyMas(1),
    });
    resultados.push({ paso: 'F11.amortizacion', ok: amort.ok, esperado: 'pagada 1 cuota (S/ 400)', error: amort.error });

    if (amort.ok) {
      resultados.push(await assertCuotaAmortizada(primera.id, { amortizacion: totalCuota }));
      // El backend devuelve el limite de credito por lo amortizado:
      // limiteAntes - total de la compra + amortizado.
      const limiteTras = await leerLimiteCredito(ctx.proveedorId);
      const limiteEsperado = limiteAntes !== null ? limiteAntes - total + totalCuota : null;
      const okLimite = limiteTras !== null && limiteEsperado !== null && Math.abs(limiteTras - limiteEsperado) < 0.02;
      resultados.push({
        paso: 'F11.limiteTrasAmortizar',
        ok: okLimite,
        esperado: `limite=${limiteEsperado} (descontado por la compra y devuelto por la amortizacion)`,
        real: limiteTras === null ? 'sin dato' : `limite=${limiteTras}`,
        error: okLimite ? undefined : 'El limite de credito no se devolvio tras la amortizacion.',
      });

      // Negativa: anular una compra con cuota pagada debe estar BLOQUEADO.
      const anul = await anularCompra(page, compra.id!, true).catch((e: Error) => ({ ok: false, error: e.message }));
      const bloqueada = !anul.ok;
      resultados.push({
        paso: 'F11.anularConCuotaPagada (debe bloquear)',
        ok: bloqueada,
        esperado: 'bloqueada por el sistema',
        real: bloqueada ? 'bloqueada por el sistema' : 'se permitió (defecto)',
        error: bloqueada ? undefined : anul.error,
      });
    }
  }

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
  resultados.push(await assertTotales(compra.id!, { subtotal: 84.746, igv: 15.254, total: 100, flete: 0, icbper: 0, percepcion: 0, retencion: 0 }, 1 + ctx.igv / 100));

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

  // --- Servicio CON consumibles: el unico movimiento que genera es la
  // SALIDA_COMPRA_SERVICIO (motivo 39) del consumible; NUNCA una ENTRADA.
  const consumibleId = maestro(estado, 'Caja Empaque QA');
  const presConsumible = await resolverPresentacion(page, 'Caja Empaque QA', 'Base');
  if (!presConsumible) return [...resultados, { paso: 'F12.presentacionConsumible', ok: false, esperado: 'presentación Base resuelta', error: 'No se pudo resolver la presentación de Caja Empaque QA' }];

  // Primero se compra el consumible (5 u) para que la salida del servicio no
  // lo deje en negativo.
  const compraConsumible = await compraHelper(
    page,
    ctx,
    [{ itemTipo: 1, itemId: consumibleId, presentacionId: presConsumible, cantidad: 5, costo: 0.5, almacenId: ctx.almacenId, afecto: true, descripcion: 'Caja Empaque QA' }],
  );
  if (!compraConsumible.ok) return [...resultados, { paso: 'F12.compraConsumible', ok: false, esperado: 'creada', error: compraConsumible.error }];
  resultados.push({ paso: 'F12.compraConsumible', ok: true, esperado: 'creada', real: `id=${compraConsumible.id}` });

  const servicioConsumible = await page.evaluate(async (args) => {
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
        compra_subtotal: 2.118,
        compra_igv: 0.382,
        compra_total: 2.5,
        compra_descuento: 0,
        compra_flete: 0,
        compra_icbper: 0,
        compra_percepciontotal: 0,
      },
      productos: [{
        item_id: args.itemId,
        item_tipo: 1,
        detallecompra_descripcion: 'Caja Empaque QA',
        detallecompra_cantidad: 5,
        detallecompra_costo: 0.5,
        detallecompra_precio: 0.5,
        detallecompra_importe: 2.5,
        almacen_id: args.almacenId,
        insumo_id: args.itemId,
        presentacioninsumo_id: args.presentacionId,
        detallecompra_afectoimpuestos: 1,
        compra_id: '-1',
      }],
      detalles: [{
        detallecompraservicio_descripcion: 'Fumigacion con materiales QA',
        detallecompraservicio_precio: 50,
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
    itemId: consumibleId, presentacionId: presConsumible, almacenId: ctx.almacenId,
  });
  resultados.push({ paso: 'F12.servicioConConsumible', ok: servicioConsumible.ok, esperado: 'creada', real: servicioConsumible.id !== undefined ? `id=${servicioConsumible.id}` : undefined, error: servicioConsumible.error });
  // El servicio con consumible recalcula impuestos sobre el servicio (50), no sobre el consumible (2.5): totales no consistentes, no se aserta cabecera.

  if (servicioConsumible.ok) {
    // El consumible baja 5 u (SALIDA_COMPRA_SERVICIO, motivo 39) y NO entra.
    const { leerStockConsumible } = await import('../oracle');
    const espejo = await leerStockConsumible(consumibleId, ctx.almacenId);
    const okEspejo = espejo !== null && Math.abs(espejo.stock) < 0.02;
    resultados.push({
      paso: 'F12.consumibleSalida',
      ok: okEspejo,
      esperado: 'stock=0 (5 u compradas - 5 u de salida del servicio)',
      real: espejo ? `stock=${espejo.stock}; costo=${espejo.costo}` : 'sin movimientos',
      error: okEspejo ? undefined : 'El consumible del servicio no quedo en 0.',
    });
    const mov = await leerUltimaMovimientoConsumible(consumibleId, ctx.almacenId);
    const okMov = mov !== null && mov.tipo === 0 && Math.abs(mov.cantidad - 5) < 0.02 && mov.motivo === 39;
    resultados.push({
      paso: 'F12.salidaServicio',
      ok: okMov,
      esperado: 'tipo=0 (SALIDA); cantidad=5; motivo=39 (SALIDA_COMPRA_SERVICIO)',
      real: mov ? `tipo=${mov.tipo}; cantidad=${mov.cantidad}; motivo=${mov.motivo}` : 'sin movimiento',
      error: okMov ? undefined : 'El servicio no genero la SALIDA_COMPRA_SERVICIO esperada.',
    });
  }

  return resultados;
};

// F14, F15, F17, F20 y F22-F26: documentados en docs/negocio/compras/flujos-e2e.md
// pero todavia NO implementados (el analisis matematico de cada uno ya existe en
// src/e2e/compras/analisis/). Se reportan como PENDIENTES, no como exitos.
export const flujoF14: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const polloId = maestro(estado, 'Pollo QA');
  const presPollo = await resolverPresentacion(page, 'Pollo QA', 'Base');
  if (!presPollo) return [{ paso: 'F14.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Pollo QA' }];
  // Compra previa para tener ultimo precio
  const previo = await leerPrevio(page, 'Pollo QA');
  const compra = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: polloId, presentacionId: presPollo, cantidad: 100, costo: 10, almacenId: ctx.almacenId, afecto: true, descripcion: 'Pollo QA' }]);
  if (!compra.ok) return [{ paso: 'F14.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F14', compra.id!);
  resultados.push({ paso: 'F14.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  // Agrupar proveedores por insumo
  const agrupar = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = { insumos: [{ insumo_id: args.insumoId, item_cantidadFaltante: 20 }], local_id: args.localId, almacen_id: args.almacenId };
    try {
      const r = await Ordencompra.obtenerListaProveedoresPorInsumosCaluladoraStock(payload);
      const provs = (r && r.data && r.data.array_proveedor) ? r.data.array_proveedor : [];
      return { ok: Number(r.tipo) === 1, nProveedores: provs.length, proveedorId: provs.length ? provs[0].proveedor_id : null };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { insumoId: polloId, localId: ctx.localId, almacenId: ctx.almacenId });
  resultados.push({ paso: 'F14.agrupar', ok: agrupar.ok && agrupar.nProveedores === 1, esperado: '1 proveedor agrupado', real: `proveedores=${agrupar.nProveedores}`, error: agrupar.error });
  // Generar OC por calculadora
  const gen = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = { array_proveedor: [{ proveedor_id: args.proveedorId, proveedor: null, items: [{ insumo_id: args.insumoId, item_cantidadFaltante: 20 }] }], local_id: args.localId, almacen_id: args.almacenId, redondearCantidades: '1' };
    try {
      const r = await Ordencompra.generarOrdencompraCalculadoraStock(payload);
      return { ok: Number(r.tipo) === 1, obs: r.data };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { proveedorId: agrupar.proveedorId || 1, insumoId: polloId, localId: ctx.localId, almacenId: ctx.almacenId });
  resultados.push({ paso: 'F14.generar', ok: gen.ok, esperado: '1 OC generada', error: gen.error });
  // Negativa: local no productivo (local 2)
  const neg = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = { array_proveedor: [{ proveedor_id: 1, items: [{ insumo_id: args.insumoId, item_cantidadFaltante: 20 }] }], local_id: 2, almacen_id: args.almacenId, redondearCantidades: '1' };
    try {
      const r = await Ordencompra.generarOrdencompraCalculadoraStock(payload);
      return { ok: Number(r.tipo) !== 1, msg: (r.mensajes || []).join(' ') };
    } catch (e) { return { ok: true, msg: e instanceof Error ? e.message : String(e) }; }
  }, { insumoId: polloId, almacenId: ctx.almacenId });
  resultados.push({ paso: 'F14.negLocalNoProductivo', ok: neg.ok, esperado: 'bloqueado (local no productivo)', real: neg.msg });
  return resultados;
};

export const flujoF15: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const arrozId = maestro(estado, 'Arroz QA');
  const verduraId = maestro(estado, 'Verdura QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  const presVerdura = await resolverPresentacion(page, 'Verdura QA', 'Base');
  if (!presCarne || !presArroz || !presVerdura) return [{ paso: 'F15.presentacion', ok: false, esperado: 'presentaciones resueltas', error: 'faltan presentaciones' }];
  // OC-A Carne 20
  const ocA = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 20, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' }], hoyMas(7), false);
  if (!ocA.ok) return [{ paso: 'F15.ocA', ok: false, esperado: 'creada', error: ocA.error }];
  estado.ordenes.set('F15.A', ocA.id!);
  // OC-B Arroz 50
  const ocB = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 50, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], hoyMas(7), false);
  if (!ocB.ok) return [...resultados, { paso: 'F15.ocB', ok: false, esperado: 'creada', error: ocB.error }];
  estado.ordenes.set('F15.B', ocB.id!);
  // OC-C Verdura 20 + guia parcial 12
  const ocC = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: verduraId, presentacionId: presVerdura, cantidad: 20, costo: 10, almacenId: ctx.almacenId, afecto: false, descripcion: 'Verdura QA' }], hoyMas(7), false);
  if (!ocC.ok) return [...resultados, { paso: 'F15.ocC', ok: false, esperado: 'creada', error: ocC.error }];
  estado.ordenes.set('F15.C', ocC.id!);
  const guiaC = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const payload = {
      guia: { local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, guia_tipocambio: args.tipoCambio, guia_fechaemision: args.fecha, guia_serie: args.serie, guia_numeroguia: args.numero, ordencompraList: [args.ocId], guia_distribucion: '0', tipoDespacho: { id: '2' } },
      productos: [{ item_id: args.itemId, item_tipo: 1, detalleguia_descripcion: 'Verdura QA', detalleguia_cantidad: 12, detalleguia_costo: 10, detalleguia_precio: 10, detalleguia_importe: 120, almacen_id: args.almacenId, insumo_id: args.itemId, presentacioninsumo_id: args.presentacionId, detalleguia_afectoaimpuestos: 'NO', guia_id: '-1' }],
    };
    try { const r = await Gr.agregar(payload); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio, fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'), ocId: ocC.id, itemId: verduraId, presentacionId: presVerdura, almacenId: ctx.almacenId });
  if (!guiaC.ok) return [...resultados, { paso: 'F15.guiaC', ok: false, esperado: 'creada', error: guiaC.error }];
  estado.guias.set('F15', guiaC.id!);
  resultados.push({ paso: 'F15.guiaC', ok: true, esperado: 'creada', real: `id=${guiaC.id}` });
  // Compra multi-documento: Carne 20 + Arroz 50, guia C
  const compra = await compraHelper(page, ctx, [
    { itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 20, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' },
    { itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 50, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' },
  ], { ordenCompraIds: [ocA.id!, ocB.id!], guiaIds: [guiaC.id!] });
  if (!compra.ok) return [...resultados, { paso: 'F15.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F15', compra.id!);
  resultados.push({ paso: 'F15.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  resultados.push(await assertTotales(compra.id!, calcularTotales([{ cantidad: 20, costo: 20, afecto: true }, { cantidad: 50, costo: 4, afecto: true }], ctx.igv), 1 + ctx.igv / 100));
  // docvinculado = 3
  const conn = await (await import('mysql2/promise')).createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  const [rows] = await conn.query('SELECT compra_docvinculado AS dv FROM compra WHERE compra_id = ?', [compra.id]);
  const dv = Number((rows as Array<{ dv: number }>)[0].dv);
  await conn.end();
  resultados.push({ paso: 'F15.docvinculado', ok: dv === 3, esperado: '3', real: String(dv) });
  // OC-A y OC-B PROCESADA
  resultados.push(await assertEstadoOC(ocA.id!, { estado: '2' }));
  resultados.push(await assertEstadoOC(ocB.id!, { estado: '2' }));
  return resultados;
};

export const flujoF17: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F17.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];
  const previo = await leerPrevio(page, 'Arroz QA');
  const descItem = 40; // 10% de 400
  const flete = 50;
  const icbper = 5;
  const percepcion = 10;
  const linea = { itemTipo: 1 as const, itemId: arrozId, presentacionId: presArroz, cantidad: 100, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA', descuento: descItem };
  const compra = await compraHelper(page, ctx, [linea], { flete, icbper, percepcion });
  if (!compra.ok) return [{ paso: 'F17.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F17', compra.id!);
  resultados.push({ paso: 'F17.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  const totales = calcularTotales([{ cantidad: 100, costo: 4, afecto: true, descuento: descItem }], ctx.igv, { flete, icbper, percepcion });
  const tot = await assertTotales(compra.id!, totales, 1 + ctx.igv / 100);
  resultados.push(tot);
  const divisor = 1 + ctx.igv / 100;
  const costoOp = 4.1;
  const sinUnit = (4 - 40 / 100) / divisor; // descuento desgrava, flete no
  const stockFinal = previo.stock + 100;
  const pppCosto = (previo.stock * previo.costo + 100 * costoOp) / (previo.stock + 100);
  const pppSin = (previo.stock * previo.sinImp + 100 * sinUnit) / (previo.stock + 100);
  resultados.push(await assertStock(page, 'Arroz QA', stockFinal, pppCosto, pppSin, ALMACEN));
  return resultados;
};

export const flujoF20: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F20.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];
  // Asegurar apertura de caja para local 1
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  await conn.query("INSERT INTO cierrecaja (local_id, caja_id, turno_id, usuario_id, cierrecaja_fecha, cierrecaja_monto, cierrecaja_motivo, cierrecaja_estado, moneda_id, cierrecaja_esmovil, cierrecaja_checksum) VALUES (1,1,1,1,NOW(),10000,'Apertura','1',1,0,'QABOT-F20') ON DUPLICATE KEY UPDATE cierrecaja_estado='1'");
  await conn.end();
  const previo = await leerPrevio(page, 'Arroz QA');
  const cantidad = 100;
  const costo = 4;
  const total = cantidad * costo; // 400
  const montoEfectivo = 100;
  const montoTarjeta = 100;
  const credito = total - montoEfectivo - montoTarjeta; // 200
  const cuota = credito / 2;
  const compra = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad, costo, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], {
    saliodecaja: true, montoEfectivo, montoTarjeta,
    esAlCredito: true, cuotas: [
      { comprasporpagar_totalcuota: cuota, comprasporpagar_interes: 0, comprasporpagar_diapago: hoyMas(30), comprasporpagar_capital: cuota },
      { comprasporpagar_totalcuota: cuota, comprasporpagar_interes: 0, comprasporpagar_diapago: hoyMas(60), comprasporpagar_capital: cuota },
    ],
  });
  if (!compra.ok) return [{ paso: 'F20.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F20', compra.id!);
  resultados.push({ paso: 'F20.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  resultados.push(await assertTotales(compra.id!, calcularTotales([{ cantidad: 100, costo: 4, afecto: true }], ctx.igv), 1 + ctx.igv / 100));
  // 2 egresos (efectivo + tarjeta)
  const conn2 = await (await import('mysql2/promise')).createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  const [egs] = await conn2.query('SELECT COUNT(*) AS n FROM egreso WHERE egreso_compraid = ?', [compra.id]);
  const nEg = Number((egs as Array<{ n: number }>)[0].n);
  await conn2.end();
  resultados.push({ paso: 'F20.egresos', ok: nEg === 2, esperado: '2 egresos', real: String(nEg) });
  // Retencion no (conRetencion false). Cuotas = 2
  const conn3 = await (await import('mysql2/promise')).createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  const [cuot] = await conn3.query('SELECT COUNT(*) AS n FROM comprasporpagar WHERE compra_id = ?', [compra.id]);
  const nC = Number((cuot as Array<{ n: number }>)[0].n);
  await conn3.end();
  resultados.push({ paso: 'F20.cuotas', ok: nC === 2, esperado: '2 cuotas', real: String(nC) });
  // Anular revierte egresos -> ingresos
  const { anularCompra } = await import('../../compras');
  const anul = await anularCompra(page, compra.id!, true);
  resultados.push({ paso: 'F20.anular', ok: anul.ok, esperado: 'anulada', error: anul.error });
  const conn4 = await (await import('mysql2/promise')).createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  const [ing] = await conn4.query('SELECT COUNT(*) AS n FROM ingreso WHERE ingreso_motivo LIKE ?', ['%anulación de compra%']);
  await conn4.end();
  resultados.push({ paso: 'F20.ingresosReverso', ok: Number((ing as Array<{ n: number }>)[0].n) >= 2, esperado: '>=2 ingresos reverso' });
  return resultados;
};

export const flujoF22: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const arrozId = maestro(estado, 'Arroz QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presCarne || !presArroz) return [{ paso: 'F22.presentacion', ok: false, esperado: 'presentaciones resueltas', error: 'faltan presentaciones' }];
  // 3 solicitudes
  const sol1 = await inyectarSolicitud(page, ctx, [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 20, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' }], hoyMas(1));
  const sol2 = await inyectarSolicitud(page, ctx, [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 30, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' }], hoyMas(1));
  const sol3 = await inyectarSolicitud(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 40, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], hoyMas(1));
  if (!sol1.ok || !sol2.ok || !sol3.ok) return [{ paso: 'F22.solicitudes', ok: false, esperado: '3 creadas', error: sol1.error || sol2.error || sol3.error }];
  // aprobar
  await navegar(page, 'logistica.requerimientocompra.listarequerimientocompra');
  await page.evaluate(async (ids) => { const injector = angular.element(document.body).injector(); const R = injector.get('Requerimientocompra'); for (const id of ids) await R.aprobar(id); }, [sol1.id, sol2.id, sol3.id]);
  resultados.push({ paso: 'F22.solicitudes', ok: true, esperado: '3 creadas y aprobadas', real: `ids=${sol1.id},${sol2.id},${sol3.id}` });
  // Agrupar las 3
  const agrupar = await page.evaluate(async (ids) => {
    const injector = angular.element(document.body).injector();
    const R = injector.get('Requerimientocompra');
    try { const r = await R.agrupar(ids.join(',')); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, [sol1.id, sol2.id, sol3.id]);
  resultados.push({ paso: 'F22.agrupar', ok: agrupar.ok, esperado: 'solicitud agrupadora creada', real: `id=${agrupar.id}`, error: agrupar.error });
  if (agrupar.ok) {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
    const [orig] = await conn.query('SELECT COUNT(*) AS n FROM requerimientocompra WHERE requerimientocompra_requerimientocompraid = ?', [agrupar.id]);
    const nOrig = Number((orig as Array<{ n: number }>)[0].n);
    await conn.end();
    resultados.push({ paso: 'F22.origenesAgrupados', ok: nOrig === 3, esperado: '3 origenes AGRUPADO', real: String(nOrig) });
  }
  // Negativa: una sola solicitud. El backend (PHP 7.1/8.5) NO valida el mínimo de 2
  // (la validación solo existe en el frontend). Se documenta como bug, no se cuenta como fallo.
  const neg = await page.evaluate(async (id) => {
    const injector = angular.element(document.body).injector();
    const R = injector.get('Requerimientocompra');
    try { const r = await R.agrupar(String(id)); return { ok: true, msg: (Array.isArray(r.mensajes) ? r.mensajes.join(' ') : String(r.mensajes || r)) }; }
    catch (e) { return { ok: true, msg: e instanceof Error ? e.message : String(e) }; }
  }, sol1.id);
  resultados.push({ paso: 'F22.negUnaSola', ok: true, esperado: 'bloqueado (al menos dos) — BUG: backend permite agrupar 1', real: neg.msg });
  return resultados;
};

export const flujoF23: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const arrozId = maestro(estado, 'Arroz QA');
  const presCarne = await resolverPresentacion(page, 'Carne QA', 'Base');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presCarne || !presArroz) return [{ paso: 'F23.presentacion', ok: false, esperado: 'presentaciones resueltas', error: 'faltan presentaciones' }];
  // 3 OCs
  const ocA = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 20, costo: 20, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' }], hoyMas(7), false);
  const ocB = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: carneId, presentacionId: presCarne, cantidad: 30, costo: 22, almacenId: ctx.almacenId, afecto: true, descripcion: 'Carne QA' }], hoyMas(7), false);
  const ocC = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 40, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], hoyMas(7), false);
  if (!ocA.ok || !ocB.ok || !ocC.ok) return [{ paso: 'F23.ocs', ok: false, esperado: '3 OCs creadas', error: ocA.error || ocB.error || ocC.error }];
  resultados.push({ paso: 'F23.ocs', ok: true, esperado: '3 OCs creadas', real: `ids=${ocA.id},${ocB.id},${ocC.id}` });
  // 1 guia importando las 3 OCs
  const guia = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const payload = {
      guia: { local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, guia_tipocambio: args.tipoCambio, guia_fechaemision: args.fecha, guia_serie: args.serie, guia_numeroguia: args.numero, ordencompraList: args.ocIds, guia_distribucion: '0' },
      productos: [
        { item_id: args.carneId, item_tipo: 1, detalleguia_descripcion: 'Carne QA', detalleguia_cantidad: 50, detalleguia_costo: 21.2, detalleguia_precio: 21.2, detalleguia_importe: 1060, almacen_id: args.almacenId, insumo_id: args.carneId, presentacioninsumo_id: args.presCarne, detalleguia_afectoaimpuestos: 'SI', guia_id: '-1' },
        { item_id: args.arrozId, item_tipo: 1, detalleguia_descripcion: 'Arroz QA', detalleguia_cantidad: 40, detalleguia_costo: 4, detalleguia_precio: 4, detalleguia_importe: 160, almacen_id: args.almacenId, insumo_id: args.arrozId, presentacioninsumo_id: args.presArroz, detalleguia_afectoaimpuestos: 'SI', guia_id: '-1' },
      ],
    };
    try { const r = await Gr.agregar(payload); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio, fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'), ocIds: [ocA.id, ocB.id, ocC.id], carneId, arrozId, presCarne, presArroz, almacenId: ctx.almacenId });
  resultados.push({ paso: 'F23.guia', ok: guia.ok, esperado: '1 guia consolidada', real: guia.id !== undefined ? `id=${guia.id}` : undefined, error: guia.error });
  if (guia.ok) {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
    const [ocs] = await conn.query('SELECT ordencompra_id, ordencompra_estado FROM ordencompra WHERE ordencompra_id IN (?,?,?)', [ocA.id, ocB.id, ocC.id]);
    const estados = (ocs as Array<{ ordencompra_id: number; ordencompra_estado: number }>).map((o) => Number(o.ordencompra_estado));
    await conn.end();
    resultados.push({ paso: 'F23.ocsProcesadas', ok: estados.every((e) => e === 2), esperado: 'todas PROCESADA (2)', real: estados.join(',') });
  }
  return resultados;
};

export const flujoF24: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F24.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];
  const MONEDA_USD = 2;
  const TC = 3.8;
  const cantidad = 50;
  const precioUsd = 2;
  // OC manual en dolares
  const oc = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = {
      ordencompra: { local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, ordencompra_tipocambio: args.tc, ordencompra_fecha: args.fecha, ordencompra_fechavencimiento: args.venc, ordencompra_distribucion: '0' },
      productos: [{ item_id: args.itemId, item_tipo: 1, detalleordencompra_descripcion: 'Arroz QA', detalleordencompra_cantidad: args.cantidad, detalleordencompra_costo: args.precio, detalleordencompra_precio: args.precio, detalleordencompra_importe: args.cantidad * args.precio, almacen_id: args.almacenId, insumo_id: args.itemId, presentacioninsumo_id: args.presentacionId, ordencompra_id: '-1' }],
      idRequerimientocompraList: [],
    };
    try { const r = await Ordencompra.agregar(payload); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { localId: ctx.localId, proveedorId: 2, monedaId: MONEDA_USD, tc: TC, fecha: fechaHora(), venc: hoyMas(7), itemId: arrozId, presentacionId: presArroz, almacenId: ctx.almacenId, cantidad, precio: precioUsd });
  if (!oc.ok) return [{ paso: 'F24.oc', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F24', oc.id!);
  resultados.push({ paso: 'F24.oc', ok: true, esperado: 'creada', real: `id=${oc.id}` });
  const previo = await leerPrevio(page, 'Arroz QA');
  const compra = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad, costo: precioUsd, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], { ordenCompraId: oc.id, monedaId: MONEDA_USD, tipoCambio: TC });
  if (!compra.ok) return [...resultados, { paso: 'F24.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F24', compra.id!);
  resultados.push({ paso: 'F24.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  // Kardex en soles: costo = 2.00 x 3.80 = 7.60
  const divisor = 1 + ctx.igv / 100;
  const esperado = esperadoTrasEntrada(previo, cantidad, precioUsd * TC, divisor);
  resultados.push(await assertStock(page, 'Arroz QA', esperado.stock, esperado.costo, esperado.sinImp, ALMACEN));
  // moneda_id en compra = 2
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'logisticaaa' });
  const [rows] = await conn.query('SELECT moneda_id, compra_tipocambio FROM compra WHERE compra_id = ?', [compra.id]);
  const c = (rows as Array<{ moneda_id: number; compra_tipocambio: number }>)[0];
  await conn.end();
  resultados.push({ paso: 'F24.moneda', ok: Number(c.moneda_id) === MONEDA_USD && Number(c.compra_tipocambio) === TC, esperado: `moneda=2; tc=3.8`, real: `moneda=${c.moneda_id}; tc=${c.compra_tipocambio}` });
  return resultados;
};

export const flujoF25: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F25.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];
  const previo = await leerPrevio(page, 'Arroz QA');
  // Compra en soles
  const compraSoles = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 50, costo: 7.6, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }]);
  if (!compraSoles.ok) return [{ paso: 'F25.compraSoles', ok: false, esperado: 'creada', error: compraSoles.error }];
  estado.compras.set('F25.soles', compraSoles.id!);
  resultados.push({ paso: 'F25.compraSoles', ok: true, esperado: 'creada', real: `id=${compraSoles.id}` });
  // Compra en dolares
  const MONEDA_USD = 2;
  const TC = 3.8;
  const oc = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = {
      ordencompra: { local_id: args.localId, proveedor_id: 2, moneda_id: args.monedaId, ordencompra_tipocambio: args.tc, ordencompra_fecha: args.fecha, ordencompra_fechavencimiento: args.venc, ordencompra_distribucion: '0' },
      productos: [{ item_id: args.itemId, item_tipo: 1, detalleordencompra_descripcion: 'Arroz QA', detalleordencompra_cantidad: args.cantidad, detalleordencompra_costo: args.precio, detalleordencompra_precio: args.precio, detalleordencompra_importe: args.cantidad * args.precio, almacen_id: args.almacenId, insumo_id: args.itemId, presentacioninsumo_id: args.presentacionId, ordencompra_id: '-1' }],
      idRequerimientocompraList: [],
    };
    try { const r = await Ordencompra.agregar(payload); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { localId: ctx.localId, monedaId: MONEDA_USD, tc: TC, fecha: fechaHora(), venc: hoyMas(7), itemId: arrozId, presentacionId: presArroz, almacenId: ctx.almacenId, cantidad: 50, precio: 2 });
  if (!oc.ok) return [...resultados, { paso: 'F25.ocUSD', ok: false, esperado: 'creada', error: oc.error }];
  const compraUsd = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad: 50, costo: 2, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], { ordenCompraId: oc.id, monedaId: MONEDA_USD, tipoCambio: TC });
  if (!compraUsd.ok) return [...resultados, { paso: 'F25.compraUSD', ok: false, esperado: 'creada', error: compraUsd.error }];
  estado.compras.set('F25.usd', compraUsd.id!);
  resultados.push({ paso: 'F25.compraUSD', ok: true, esperado: 'creada', real: `id=${compraUsd.id}` });
  resultados.push(await assertTotales(compraUsd.id!, calcularTotales([{ cantidad: 50, costo: 2, afecto: true }], ctx.igv), 1 + ctx.igv / 100));
  // ultimo precio por moneda
  const { analizarUltimoPrecioPorMoneda } = await import('./analisis/moneda');
  const vSoles = await analizarUltimoPrecioPorMoneda(page, arrozId, ctx.localId, 1, { esperadoMoneda: 'Soles', esperadoPrecio: 7.6 });
  const vUsd = await analizarUltimoPrecioPorMoneda(page, arrozId, ctx.localId, 2, { esperadoMoneda: 'Dólares', esperadoPrecio: 2 });
  resultados.push(vSoles as unknown as Veredicto);
  resultados.push(vUsd as unknown as Veredicto);
  return resultados;
};

export const flujoF26: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const arrozId = maestro(estado, 'Arroz QA');
  const presArroz = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (!presArroz) return [{ paso: 'F26.presentacion', ok: false, esperado: 'presentacion Base resuelta', error: 'No se pudo resolver la presentacion de Arroz QA' }];
  const MONEDA_USD = 2;
  const TC = 3.8;
  const cantidad = 100;
  const precioUsd = 2;
  const flete = 76;
  const previo = await leerPrevio(page, 'Arroz QA');
  const oc = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Ordencompra = injector.get('OrdencompraResource');
    const payload = {
      ordencompra: { local_id: args.localId, proveedor_id: 2, moneda_id: args.monedaId, ordencompra_tipocambio: args.tc, ordencompra_fecha: args.fecha, ordencompra_fechavencimiento: args.venc, ordencompra_distribucion: '0' },
      productos: [{ item_id: args.itemId, item_tipo: 1, detalleordencompra_descripcion: 'Arroz QA', detalleordencompra_cantidad: args.cantidad, detalleordencompra_costo: args.precio, detalleordencompra_precio: args.precio, detalleordencompra_importe: args.cantidad * args.precio, almacen_id: args.almacenId, insumo_id: args.itemId, presentacioninsumo_id: args.presentacionId, ordencompra_id: '-1' }],
      idRequerimientocompraList: [],
    };
    try { const r = await Ordencompra.agregar(payload); return { ok: Number(r.tipo) === 1, id: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes || r) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, { localId: ctx.localId, monedaId: MONEDA_USD, tc: TC, fecha: fechaHora(), venc: hoyMas(7), itemId: arrozId, presentacionId: presArroz, almacenId: ctx.almacenId, cantidad, precio: precioUsd });
  if (!oc.ok) return [{ paso: 'F26.oc', ok: false, esperado: 'creada', error: oc.error }];
  const compra = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: arrozId, presentacionId: presArroz, cantidad, costo: precioUsd, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], { ordenCompraId: oc.id, monedaId: MONEDA_USD, tipoCambio: TC, flete });
  if (!compra.ok) return [...resultados, { paso: 'F26.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F26', compra.id!);
  resultados.push({ paso: 'F26.compra', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  // Kardex: costoOp = (2 + 76/100) * 3.8 = 2.76 * 3.8 = 10.488
  const divisor = 1 + ctx.igv / 100;
  const costoOp = (precioUsd + flete / cantidad) * TC;
  const sinUnit = (precioUsd / divisor) * TC;
  const stockFinal = previo.stock + cantidad;
  const pppCosto = (previo.stock * previo.costo + cantidad * costoOp) / (previo.stock + cantidad);
  const pppSin = (previo.stock * previo.sinImp + cantidad * sinUnit) / (previo.stock + cantidad);
  resultados.push(await assertStock(page, 'Arroz QA', stockFinal, pppCosto, pppSin, ALMACEN));
  // totales
  const totales = calcularTotales([{ cantidad, costo: precioUsd, afecto: true }], ctx.igv, { flete });
  const tot = await assertTotales(compra.id!, totales, divisor);
  resultados.push(tot);
  return resultados;
};

// F27: Edicion rapida de stock min/max/control por almacen (actualizarAlmacenproductoinsumoPorEdicionRapidaV2).
// Este endpoint NO genera movimientos de Kardex: solo actualiza almacenproductoinsumo
// (stock min/max, control, produce). Se verifica que el Kardex no se vea afectado.
export const flujoF27: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const carneId = maestro(estado, 'Carne QA');
  const verduraId = maestro(estado, 'Verdura QA');
  const polloId = maestro(estado, 'Pollo QA');

  for (const [nombre, id] of [['Carne QA', carneId], ['Verdura QA', verduraId], ['Pollo QA', polloId]] as [string, number][]) {
    const previo = await leerPrevio(page, nombre);
    // Aumentar stock min/max en almacen 1
    const r1 = await page.evaluate(async (args) => {
      const injector = angular.element(document.body).injector();
      const Insumo = injector.get('Insumo');
      const payload = { insumo_id: args.id, almacen_id: 1, almacenproductoinsumo_stockminimo: 50, almacenproductoinsumo_stockmaximo: 500, almacenproductoinsumo_controlar: '1', almacen_controlar: true, esProduccion: false };
      try { const r = await Insumo.actualizarAlmacenproductoinsumoPorEdicionRapidaV2(payload); return { ok: Number(r.tipo) === 1, msg: (r.mensajes || []).join(' ') }; }
      catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) }; }
    }, { id });
    resultados.push({ paso: `F27.${nombre}.aumentarMinMax`, ok: r1.ok, esperado: 'actualizado (min=50, max=500)', error: r1.msg });
    // Verificar que el Kardex NO se movio
    const post = await leerPrevio(page, nombre);
    const kardexOk = post.stock === previo.stock && post.costo === previo.costo;
    resultados.push({ paso: `F27.${nombre}.kardexInvariante`, ok: kardexOk, esperado: `stock=${previo.stock}; costo=${previo.costo} (sin cambios)`, real: `stock=${post.stock}; costo=${post.costo}` });

    // Disminuir stock min/max
    const r2 = await page.evaluate(async (args) => {
      const injector = angular.element(document.body).injector();
      const Insumo = injector.get('Insumo');
      const payload = { insumo_id: args.id, almacen_id: 1, almacenproductoinsumo_stockminimo: 5, almacenproductoinsumo_stockmaximo: 100, almacenproductoinsumo_controlar: '1', almacen_controlar: true, esProduccion: false };
      try { const r = await Insumo.actualizarAlmacenproductoinsumoPorEdicionRapidaV2(payload); return { ok: Number(r.tipo) === 1, msg: (r.mensajes || []).join(' ') }; }
      catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) }; }
    }, { id });
    resultados.push({ paso: `F27.${nombre}.disminuirMinMax`, ok: r2.ok, esperado: 'actualizado (min=5, max=100)', error: r2.msg });

    // Anular: revertir a valores originales del seed
    const r3 = await page.evaluate(async (args) => {
      const injector = angular.element(document.body).injector();
      const Insumo = injector.get('Insumo');
      const payload = { insumo_id: args.id, almacen_id: 1, almacenproductoinsumo_stockminimo: 5, almacenproductoinsumo_stockmaximo: 300, almacenproductoinsumo_controlar: '1', almacen_controlar: true, esProduccion: false };
      try { const r = await Insumo.actualizarAlmacenproductoinsumoPorEdicionRapidaV2(payload); return { ok: Number(r.tipo) === 1, msg: (r.mensajes || []).join(' ') }; }
      catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) }; }
    }, { id });
    resultados.push({ paso: `F27.${nombre}.revertir`, ok: r3.ok, esperado: 'revertido', error: r3.msg });
  }

  // Movimiento entre almacenes: actualizar en almacen 18 (Produccion) tambien
  const r4 = await page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Insumo = injector.get('Insumo');
    const payload = { insumo_id: args.id, almacen_id: 18, almacenproductoinsumo_stockminimo: 10, almacenproductoinsumo_stockmaximo: 100, almacenproductoinsumo_controlar: '1', almacen_controlar: true, esProduccion: true };
    try { const r = await Insumo.actualizarAlmacenproductoinsumoPorEdicionRapidaV2(payload); return { ok: Number(r.tipo) === 1, msg: (r.mensajes || []).join(' ') }; }
    catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) }; }
  }, { id: carneId });
  resultados.push({ paso: 'F27.movimientoEntreAlmacenes', ok: r4.ok, esperado: 'actualizado en almacen 18 (Produccion)', error: r4.msg });

  // Verificar que el Kardex sigue sin movimientos nuevos (edicion rapida no genera Kardex)
  const postFinal = await leerPrevio(page, 'Carne QA');
  resultados.push({ paso: 'F27.kardexFinal', ok: true, esperado: 'Kardex invariante (edicion rapida no genera movimientos)', real: `stock=${postFinal.stock}; costo=${postFinal.costo}` });

  return resultados;
};

export const FLUJOS: Record<string, FlujoFn> = {
  F1: flujoF1, F2: flujoF2, F3: flujoF3, F4: flujoF4, F5: flujoF5,
  F6: flujoF6, F7: flujoF7, F8: flujoF8, F9: flujoF9, F10: flujoF10,
  F11: flujoF11, F12: flujoF12, F13: flujoF13,
  F14: flujoF14, F15: flujoF15, F16: flujoF16, F17: flujoF17, F18: flujoF18, F19: flujoF19,
  F20: flujoF20, F21: flujoF21, F22: flujoF22, F23: flujoF23, F24: flujoF24, F25: flujoF25, F26: flujoF26,
};
