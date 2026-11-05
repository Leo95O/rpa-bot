// flujosManual.ts — Flujos F28-F41: presentación con CONVERSIÓN MANUAL (config general 197).
//
// Contrato (backend docs/agenteia/compras/conversion-manual-presentacion.md):
//  - En una línea manual el usuario escribe lo que entra al stock (detallecompra_cantidadmanual /
//    detalleguia_cantidadmanual), ya en la unidad de control. No se multiplica por la presentación.
//  - Costo base = costo × cantidad comprada ÷ cantidad manual (PresentacioninsumoLogistica::obtenerInsumoConCantidadManual).
//  - Compra/guía con presentación manual sin cantidad > 0 se rechaza (CompraLogisticaValidator::validarCantidadManualEnLineas).
//  - Canje de guía a compra: la compra no mueve stock (ya lo hizo la guía).
//  - NC por cantidad: sale lo escrito en "Manual a devolver" (detallenotacreditocompra_cantidadmanual),
//    obligatorio y ≤ comprado − devuelto en NC activas (NotacreditocompraLogisticaValidator::_validarCantidadManualEnDevolucion).
//  - NC por precio: nuevoCosto = (importe - descuento × cantidad) ÷ cantidad manual (NotacreditocompraLogistica:264-276).
//  - Anular NC por cantidad: se elimina su salida (NotacreditocompraLogistica::anular).
//  - Anular NC por precio: se re-clona la entrada con `item_precio` (precio de la presentación), no con el
//    costo base manual (NotacreditocompraLogistica:640-650): F38 lo verifica.
//  - El buscador oculta la presentación manual salvo que se pida incluirConversionManual (solo compra, guía y OC).
import { Page } from 'playwright';
import { ContextoCompra, EstadoSuite, LineaDetalle, ResultadoOperacion } from './tipos';
import { hoyMas, fechaHora, serieUnica, inyectarOrdenCompra, ppp, buscarItems } from './helpers';
import { assertStock, leerMovimientos, Veredicto } from './oraculo';
import { compraHelper, esperadoTrasEntrada, leerPrevio, PrevioStock, FlujoFn } from './flujos';
import { anularCompra, anularNotaCredito, registrarNotaCredito } from '../../compras';
import { crearInsumo } from '../../bot';

declare const angular: any;

const ALMACEN = 'Almacen Principal';
const INSUMO = 'Pollo Manual QA';
const PRES_MANUAL = 'Kilo';
const CONFIG_CONVERSION_MANUAL = 197;
const TOL = 0.02;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Adjunta la explicación de negocio que el HTML/PDF muestra en la columna Descripción. */
function con(v: Veredicto, descripcion: string): Veredicto {
  return { ...v, descripcion };
}

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

async function consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await conexion();
  try {
    const [rows] = await c.query(sql, params);
    return rows as T[];
  } finally {
    await c.end();
  }
}

/**
 * La config 197 es general (maestra `configuracion`) y nace apagada. La BD QA es desechable:
 * se enciende si hace falta, en la maestra y en todos los locales, como lo hace Ajustes de logística.
 */
async function asegurarConfigConversionManual(): Promise<Veredicto> {
  const paso = 'config 197 (conversión manual) activa';
  const descripcion = 'Precondición: la configuración general 197 habilita las presentaciones con conversión manual en compras, guías y órdenes de compra. Si estaba apagada, el bot la enciende en la BD de QA.';
  try {
    const rows = await consultar<{ v: string }>('SELECT configuracion_valor AS v FROM configuracion WHERE configuracion_id = ?', [CONFIG_CONVERSION_MANUAL]);
    if (!rows.length) return { paso, ok: false, esperado: 'fila 197 en configuracion', error: 'No existe la configuración 197 (falta migración).', descripcion };
    if (String(rows[0].v) === '1') return { paso, ok: true, esperado: '1', real: '1', descripcion };
    await consultar('UPDATE configuracion SET configuracion_valor = ? WHERE configuracion_id = ?', ['1', CONFIG_CONVERSION_MANUAL]);
    await consultar('UPDATE configuracionlocal SET configuracionlocal_valor = ? WHERE configuracion_id = ?', ['1', CONFIG_CONVERSION_MANUAL]);
    return { paso, ok: true, esperado: '1', real: 'estaba en ' + rows[0].v + '; encendida por el bot', descripcion };
  } catch (e) {
    return { paso, ok: false, esperado: '1', error: e instanceof Error ? e.message : String(e), descripcion };
  }
}

interface PresentacionBD {
  id: number;
  nombre: string;
  manual: string;
  control: string;
  venta: string;
  estandar: string;
}

async function leerPresentaciones(insumoId: number): Promise<PresentacionBD[]> {
  return consultar<PresentacionBD>(
    'SELECT presentacioninsumo_id AS id, presentacioninsumo_nombre AS nombre, presentacioninsumo_conversionmanual AS manual, ' +
      'presentacioninsumo_agruparstock AS control, presentacioninsumo_seusaparaventa AS venta, presentacioninsumo_estandar AS estandar ' +
      "FROM presentacioninsumo WHERE insumo_id = ? AND presentacioninsumo_estado = '1'",
    [insumoId],
  );
}

interface CtxManual {
  insumoId: number;
  presManualId: number;
  presBaseId: number | null;
  divisor: number;
}

/** Contexto del maestro manual ya creado por F28 (los demás flujos lo reusan). */
async function ctxManual(ctx: ContextoCompra, estado: EstadoSuite): Promise<CtxManual | null> {
  const insumoId = estado.maestros.get(INSUMO);
  if (insumoId === undefined) return null;
  const pres = await leerPresentaciones(insumoId);
  const manual = pres.find((p) => p.nombre === PRES_MANUAL);
  const base = pres.find((p) => p.nombre === 'Base');
  if (!manual) return null;
  return { insumoId, presManualId: Number(manual.id), presBaseId: base ? Number(base.id) : null, divisor: 1 + ctx.igv / 100 };
}

function sinMaestro(fid: string): Veredicto[] {
  return [{ paso: `${fid}.maestro`, ok: false, esperado: `${INSUMO} con '${PRES_MANUAL}'`, error: 'Sin maestro manual (ver F28).' }];
}

/** Maestro del módulo: control en Unidad, presentación de compra "Kilo" (Kilogramo) con conversión manual. */
async function asegurarMaestro(page: Page, ctx: ContextoCompra, estado: EstadoSuite, resultados: Veredicto[]): Promise<CtxManual | null> {
  const existente = await ctxManual(ctx, estado);
  if (existente) return existente;

  resultados.push(await asegurarConfigConversionManual());

  const r = await crearInsumo(page, {
    nombre: INSUMO,
    unidadMedida: 'Unidad',
    stockApertura: 0,
    costoApertura: 0,
    presentacionesExtra: [{
      nombre: PRES_MANUAL, cantidad: 1, unidadMedida: 'Kilogramo', costo: 0, precioMinimo: 0, precioMaximo: 0,
      unidadControl: false, seVende: false, precioVenta: 0, esEstandar: false, activa: true, conversionManual: true,
    }],
  });
  resultados.push({
    paso: `crearInsumo('${INSUMO}') con presentación manual '${PRES_MANUAL}'`, ok: r.ok, esperado: 'creado', real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error,
    descripcion: `Se da de alta "${INSUMO}": se controla en Unidad y se compra en la presentación "${PRES_MANUAL}" (Kilogramo) con conversión manual, porque cuántos pollos trae cada kilo cambia en cada compra.`,
  });
  if (!r.ok || r.id === undefined) return null;
  estado.maestros.set(INSUMO, r.id);

  // El backend fuerza la manual a no-control, no-venta y no-estándar (InsumoLogistica::normalizarConversionManual).
  const pres = (await leerPresentaciones(r.id)).find((p) => p.nombre === PRES_MANUAL);
  const flags = pres ? `manual=${pres.manual}; control=${pres.control}; venta=${pres.venta}; estandar=${pres.estandar}` : 'sin presentación';
  const okFlags = !!pres && String(pres.manual) === '1' && String(pres.control) !== '1' && String(pres.venta) !== '1' && String(pres.estandar) !== '1';
  resultados.push({
    paso: `presentación '${PRES_MANUAL}' guardada como manual`, ok: okFlags, esperado: 'manual=1; control=0; venta=0; estandar=0', real: flags,
    error: okFlags ? undefined : 'La presentación no quedó como conversión manual.',
    descripcion: 'Una presentación manual no convierte cantidades, así que el backend no la deja ser la unidad de control, venderse ni ser la estándar. Se verifica en la tabla presentacioninsumo.',
  });
  if (!pres) return null;

  // Fuera de compra/guía/OC la presentación manual no se ofrece (convertiría con ella). Se busca una
  // fila por presentación (agruparInsumo = NO), como busquedaParaCompras: agrupado solo sale una fila.
  const sinFlag = await buscarItems(page, INSUMO);
  const conFlag = await buscarItems(page, INSUMO, { incluirConversionManual: true });
  const ve = (filas: typeof sinFlag): boolean => filas.some((f) => f.presentacionId === Number(pres.id));
  const nombres = (filas: typeof sinFlag): string => filas.map((f) => f.presentacion).join(', ') || 'sin filas';
  resultados.push({
    paso: 'buscador sin incluirConversionManual oculta la presentación manual', ok: sinFlag.length > 0 && !ve(sinFlag), esperado: `Base, sin '${PRES_MANUAL}'`, real: nombres(sinFlag),
    descripcion: 'Fuera de compras, guías y órdenes de compra (recetas, movimientos, producción, cuadres) la presentación manual no debe ofrecerse: esos módulos convertirían con ella. El buscador solo debe mostrar la Base.',
  });
  resultados.push({
    paso: 'buscador de compras (incluirConversionManual) la ofrece', ok: ve(conFlag), esperado: `con '${PRES_MANUAL}'`, real: nombres(conFlag),
    descripcion: 'El buscador de compras, guías y órdenes de compra pide también las presentaciones manuales: el usuario debe poder elegir "Kilo" al comprar.',
  });

  resultados.push(...await casoKardexAgrupadoManualPrimero(page));

  const base = (await leerPresentaciones(r.id)).find((p) => p.nombre === 'Base');
  return { insumoId: r.id, presManualId: Number(pres.id), presBaseId: base ? Number(base.id) : null, divisor: 1 + ctx.igv / 100 };
}

/**
 * El buscador del Kardex agrupa por insumo (`group by i.insumo_id`) y MySQL devuelve una fila cualquiera
 * del grupo; luego el PHP descarta las filas de presentación manual (InsumoLogistica.php:1909). Si la fila
 * elegida es la manual, el insumo entero desaparece del Kardex. Se fuerza ese caso creando la manual
 * ANTES que la Base (nace con id menor, que suele ser la fila que MySQL toma).
 */
async function casoKardexAgrupadoManualPrimero(page: Page): Promise<Veredicto[]> {
  const resultados: Veredicto[] = [];
  const nombre = 'Pollo Manual Primero QA ' + Date.now().toString(36).slice(-5).toUpperCase();
  const r = await crearInsumo(page, {
    nombre, unidadMedida: 'Unidad', stockApertura: 0, costoApertura: 0, presentacionesExtraPrimero: true,
    presentacionesExtra: [{
      nombre: PRES_MANUAL, cantidad: 1, unidadMedida: 'Kilogramo', costo: 0, precioMinimo: 0, precioMaximo: 0,
      unidadControl: false, seVende: false, precioVenta: 0, esEstandar: false, activa: true, conversionManual: true,
    }],
  });
  resultados.push({
    paso: `crearInsumo('${nombre}') con '${PRES_MANUAL}' antes que Base`, ok: r.ok, esperado: 'creado', real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error,
    descripcion: 'Se crea un segundo insumo escribiendo la fila manual ANTES que la de control en la grilla de presentaciones, como podría hacerlo un usuario.',
  });
  if (!r.ok || r.id === undefined) return resultados;

  const pres = await leerPresentaciones(r.id);
  const manual = pres.find((p) => p.nombre === PRES_MANUAL);
  const base = pres.find((p) => p.nombre === 'Base');
  const orden = pres.map((p) => `${p.nombre}=${p.id}`).join(', ');
  const manualPrimero = !!manual && !!base && Number(manual.id) < Number(base.id);
  resultados.push({
    paso: 'precondición: la manual nace con id menor que Base', ok: manualPrimero, esperado: `${PRES_MANUAL} < Base`, real: orden || 'sin presentaciones',
    descripcion: 'Precondición del caso: la presentación manual debe tener el id más bajo, que es la fila que MySQL suele tomar al agrupar por insumo.',
  });

  const kardex = await buscarItems(page, nombre, { agruparInsumo: true });
  const aparece = kardex.some((f) => f.itemId === r.id);
  resultados.push({
    paso: 'buscador del Kardex (agrupado) encuentra el insumo con manual primero', ok: aparece, esperado: 'presente',
    real: aparece ? 'presente: ' + kardex.map((f) => f.presentacion || '(sin presentación)').join(', ') : 'ausente (el filtro PHP descartó la única fila del grupo)',
    error: aparece ? undefined : 'Defecto backend: el insumo desaparece del Kardex cuando la fila agrupada es la presentación manual.',
    descripcion: 'Kárdex individual, ingredientes de receta, movimientos de producción y varios filtros buscan agrupando por insumo (una fila por insumo). El backend agrupa en SQL y después descarta en PHP las filas manuales (InsumoLogistica.php:1909): si la fila que quedó del grupo es la manual, el insumo desaparece sin error. Debe seguir apareciendo.',
  });

  const general = await buscarItems(page, nombre);
  const soloBase = general.length > 0 && general.every((f) => f.presentacionId !== Number(manual?.id));
  resultados.push({
    paso: 'buscador por presentación muestra Base y oculta la manual', ok: soloBase, esperado: `Base, sin '${PRES_MANUAL}'`, real: general.map((f) => f.presentacion).join(', ') || 'sin filas',
    descripcion: 'Control: buscando una fila por presentación, el mismo insumo sí aparece con su Base y sin la manual.',
  });
  return resultados;
}

function lineaManual(m: CtxManual, ctx: ContextoCompra, cantidad: number, costo: number, cantidadManual?: number): LineaDetalle {
  return {
    itemTipo: 1, itemId: m.insumoId, presentacionId: m.presManualId, cantidad, costo,
    almacenId: ctx.almacenId, afecto: true, descripcion: INSUMO, cantidadManual,
  };
}

/** Lo que guardó la línea de compra: comprado vs. lo que entró al stock. */
async function assertLineaCompra(compraId: number, cantidad: number, manual: number): Promise<Veredicto> {
  const paso = `detallecompra(compra=${compraId}) cantidad/manual`;
  const esperado = `cantidad=${cantidad}; manual=${manual}`;
  const descripcion = `La línea de compra guarda las dos cantidades: ${cantidad} ${PRES_MANUAL} comprados (detallecompra_cantidad) y ${manual} unidades que entraron al stock (detallecompra_cantidadmanual).`;
  try {
    const rows = await consultar<{ cant: number; manual: number | null }>(
      'SELECT detallecompra_cantidad AS cant, detallecompra_cantidadmanual AS manual FROM detallecompra WHERE compra_id = ?',
      [compraId],
    );
    const real = rows.map((x) => `cantidad=${Number(x.cant)}; manual=${x.manual == null ? 'NULL' : Number(x.manual)}`).join(' | ') || 'sin líneas';
    const ok = rows.length === 1 && Math.abs(Number(rows[0].cant) - cantidad) < TOL && Math.abs(Number(rows[0].manual) - manual) < TOL;
    return { paso, ok, esperado, real, error: ok ? undefined : 'La línea no guardó la cantidad manual esperada.', descripcion };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e), descripcion };
  }
}

/** Último movimiento vivo del Kardex: una línea manual entra/sale por la cantidad escrita, no la convertida. */
async function assertUltimoMovimiento(m: CtxManual, ctx: ContextoCompra, cantidad: number, costo: number | null, etiqueta: string): Promise<Veredicto> {
  const movs = await leerMovimientos(m.insumoId, ctx.almacenId);
  const ult = movs[movs.length - 1];
  const esperado = `cantidad=${cantidad}` + (costo !== null ? `; costoOperacion=${r3(costo)}` : '');
  const descripcion = `Última fila del Kárdex (${etiqueta}): debe mover ${cantidad} unidades, la cantidad escrita en la línea manual y no la convertida desde Kilos` +
    (costo !== null ? `, con costo de operación S/ ${r3(costo)} (total de la línea ÷ cantidad manual).` : '.');
  if (!ult) return { paso: `kardex ${etiqueta}`, ok: false, esperado, error: 'Sin movimientos.', descripcion };
  const real = `cantidad=${ult.cantidad}; costoOperacion=${r3(ult.costo)}; motivo=${ult.motivo}`;
  const ok = Math.abs(ult.cantidad - cantidad) < TOL && (costo === null || Math.abs(ult.costo - costo) < TOL);
  return { paso: `kardex ${etiqueta}`, ok, esperado, real, error: ok ? undefined : 'El Kardex no movió la cantidad manual.', descripcion };
}

/** Movimientos de ENTRADA_COMPRA (motivo 2) de una compra: origen eliminado y clon vivo tras una NC por precio. */
async function entradasDeCompra(insumoId: number, almacenId: number, compraId: number): Promise<Array<{ cant: number; costo: number; elim: string | null }>> {
  const rows = await consultar<{ cant: number; costo: number; elim: string | null }>(
    'SELECT movimientoalmaceninsumo_cantidad AS cant, movimientoalmaceninsumo_costooperacion AS costo, movimientoalmaceninsumo_fueeliminado AS elim ' +
      'FROM movimientoalmaceninsumo WHERE insumo_id = ? AND almacen_id = ? AND movimientoalmaceninsumo_motivo = 2 AND movimientoalmaceninsumo_idmotivo = ? ' +
      'ORDER BY movimientoalmaceninsumo_id',
    [insumoId, almacenId, compraId],
  );
  return rows.map((x) => ({ cant: Number(x.cant), costo: Number(x.costo), elim: x.elim == null ? null : String(x.elim) }));
}

const fmtEntradas = (rows: Array<{ cant: number; costo: number; elim: string | null }>): string =>
  rows.map((x) => `cant=${x.cant} costo=${r3(x.costo)} elim=${x.elim}`).join(' | ') || 'sin movimientos';

async function assertManualNC(ncId: number, esperado: number): Promise<Veredicto> {
  const paso = `detallenotacreditocompra(nc=${ncId}).cantidadmanual`;
  const descripcion = `La línea de la NC guarda lo que salió del stock en la unidad de control ("Manual a devolver" = ${esperado}). Ese valor descuenta del disponible para las próximas NC.`;
  try {
    const rows = await consultar<{ manual: number | null }>(
      'SELECT detallenotacreditocompra_cantidadmanual AS manual FROM detallenotacreditocompra WHERE notacreditocompra_id = ? AND detallenotacreditocompra_cantidadmanual > 0', [ncId],
    );
    const real = rows.map((x) => String(Number(x.manual))).join(', ') || 'sin línea manual';
    const ok = rows.length === 1 && Math.abs(Number(rows[0].manual) - esperado) < TOL;
    return { paso, ok, esperado: String(esperado), real, descripcion };
  } catch (e) {
    return { paso, ok: false, esperado: String(esperado), error: String(e), descripcion };
  }
}

/** Solo el stock (para NC por precio, donde el costo cambia y se verifica aparte). */
async function assertSoloStock(page: Page, fid: string, previo: PrevioStock, descripcion: string): Promise<Veredicto> {
  const real = await leerPrevio(page, INSUMO);
  const ok = Math.abs(real.stock - previo.stock) < TOL;
  return { paso: `${fid}.stock sin cambio`, ok, esperado: `stock=${previo.stock}`, real: `stock=${real.stock}; costo=${real.costo}`, descripcion };
}

/** Rechazo esperado: si el backend acepta, se registra como defecto. */
function rechazo(paso: string, r: { ok: boolean; id?: number; error?: string }, esperado: string, descripcion: string): Veredicto {
  return { paso, ok: !r.ok, esperado, real: r.ok ? `se registró id=${r.id} (defecto)` : r.error, descripcion };
}

function guardarPrevio(estado: EstadoSuite, flujo: string, previo: PrevioStock): void {
  if (!estado.preEstados) estado.preEstados = new Map();
  estado.preEstados.set(flujo, previo);
}

async function registrarGuiaManual(
  page: Page, ctx: ContextoCompra, m: CtxManual, cantidad: number, costo: number, cantidadManual: number | undefined,
): Promise<ResultadoOperacion> {
  return page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const payload = {
      guia: {
        local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, guia_tipocambio: args.tipoCambio,
        guia_fechaemision: args.fecha, guia_serie: args.serie, guia_numeroguia: args.numero, ordencompraList: [], guia_distribucion: '0',
      },
      productos: [{
        item_id: args.itemId, item_tipo: 1, detalleguia_descripcion: args.nombre,
        detalleguia_cantidad: args.cantidad, detalleguia_costo: args.costo, detalleguia_precio: args.costo,
        detalleguia_importe: args.cantidad * args.costo, almacen_id: args.almacenId, insumo_id: args.itemId,
        presentacioninsumo_id: args.presId, detalleguia_afectoaimpuestos: 'SI', guia_id: '-1',
        ...(args.manual !== undefined ? { detalleguia_cantidadmanual: args.manual } : {}),
      }],
    };
    try {
      const r = await Gr.agregar(payload);
      return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, {
    localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio,
    fecha: fechaHora(), serie: serieUnica('G'), numero: serieUnica('G'), itemId: m.insumoId, nombre: INSUMO,
    almacenId: ctx.almacenId, presId: m.presManualId, cantidad, costo, manual: cantidadManual,
  });
}

// F28: Compra directa con presentación manual. 10 Kilo a S/ 9.50 (con IGV) y 8 de ingreso:
// entran 8 unidades a 95 ÷ 8 = S/ 11.875 (ejemplo del doc del backend).
export const flujoF28: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await asegurarMaestro(page, ctx, estado, resultados);
  if (!m) return [...resultados, { paso: 'F28.maestro', ok: false, esperado: `${INSUMO} con '${PRES_MANUAL}'`, error: 'Sin maestro manual: se omiten F28-F41.' }];

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 10, 9.5, 8)]);
  if (!compra.ok) return [...resultados, { paso: 'F28.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F28', compra.id!);
  resultados.push({
    paso: 'F28.compra(10 Kilo @9.50, manual 8)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra directa: 10 Kilos a S/ 9.50 (total S/ 95.00) y el usuario escribe 8 en "Cant. ingreso": entran 8 unidades, no 10.',
  });

  resultados.push(await assertLineaCompra(compra.id!, 10, 8));
  const costoBase = (10 * 9.5) / 8;
  const esp = esperadoTrasEntrada(previo, 8, costoBase, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN),
    `Stock y costo promedio tras la compra: +8 unidades a S/ ${r3(costoBase)} (95 ÷ 8). Esperado ${esp.stock} u a S/ ${esp.costo} (sin IGV S/ ${esp.sinImp}).`));
  resultados.push(await assertUltimoMovimiento(m, ctx, 8, costoBase, 'entrada compra manual'));
  return resultados;
};

// F29: NC por cantidad sobre la línea manual de F28. Primero las dos validaciones del backend
// (sin "Manual a devolver" y por encima de lo disponible), luego devuelve 2 Kilo con 1.5 de manual:
// salen 1.5 unidades y el PPP no cambia (una salida no promedia).
export const flujoF29: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const compraId = estado.compras.get('F28');
  const m = await ctxManual(ctx, estado);
  if (!compraId || !m) return [{ paso: 'F29.compra', ok: false, esperado: 'compra F28 existente', error: 'No hay compra F28 en el estado' }];
  const insumoId = m.insumoId;

  const sinManual = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2 }]);
  resultados.push(rechazo('F29.nc sin cantidad manual (debe rechazar)', sinManual, 'rechazada: escribe la cantidad manual a devolver',
    'NC por cantidad sobre una línea manual sin escribir "Manual a devolver": el backend debe rechazarla, porque lo que sale del stock no se puede deducir de los Kilos devueltos.'));
  if (sinManual.ok) estado.nc.set('F29-sinmanual', sinManual.id!);

  const excede = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2, cantidadManual: 9 }]);
  resultados.push(rechazo('F29.nc manual 9 > disponible 8 (debe rechazar)', excede, 'rechazada: excede la disponible',
    'NC que intenta sacar 9 unidades cuando la compra solo ingresó 8: el backend debe rechazarla por exceder lo disponible.'));
  if (excede.ok) estado.nc.set('F29-excede', excede.id!);

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2, cantidadManual: 1.5 }]);
  if (!nc.ok) return [...resultados, { paso: 'F29.nc(2 Kilo, manual 1.5)', ok: false, esperado: 'creada', error: nc.error }];
  estado.nc.set('F29', nc.id!);
  resultados.push({
    paso: 'F29.nc(2 Kilo, manual 1.5)', ok: true, esperado: 'creada', real: `id=${nc.id}`,
    descripcion: 'Se devuelven 2 Kilos al proveedor y el usuario escribe que salen 1.5 unidades del stock.',
  });
  resultados.push(await assertManualNC(nc.id!, 1.5));
  resultados.push(con(await assertStock(page, INSUMO, r3(previo.stock - 1.5), previo.costo, previo.sinImp, ALMACEN),
    'Tras la NC el stock baja 1.5 unidades y el costo promedio no cambia: una salida no promedia.'));
  resultados.push(await assertUltimoMovimiento(m, ctx, 1.5, null, 'salida NC manual'));
  return resultados;
};

// F30: Compra con presentación manual SIN cantidad de ingreso: el backend la rechaza y el stock no cambia.
export const flujoF30: FlujoFn = async (page, ctx, estado) => {
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F30');
  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 5, 10)]);
  if (compra.ok) estado.compras.set('F30-defecto', compra.id!);
  return [
    rechazo('F30.compra manual sin cantidad (debe rechazar)', compra, 'rechazada: necesita la cantidad manual',
      'Compra con la presentación "Kilo" sin escribir "Cant. ingreso": el backend debe rechazarla, porque no sabe cuántas unidades entran.'),
    con(await assertStock(page, INSUMO, previo.stock, previo.costo, previo.sinImp, ALMACEN), 'La compra rechazada no debe mover el stock ni el costo.'),
  ];
};

// F31: Guía con presentación manual (5 Kilo @10, ingreso 6) mueve el stock; la compra que canjea esa
// guía repite la cantidad manual pero NO vuelve a mover stock.
export const flujoF31: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F31');

  const sinManual = await registrarGuiaManual(page, ctx, m, 5, 10, undefined);
  resultados.push(rechazo('F31.guia manual sin cantidad (debe rechazar)', sinManual, 'rechazada: necesita la cantidad manual',
    'Guía de compra con la presentación manual sin "Cant. ingreso": el backend debe rechazarla igual que la compra.'));

  const previo = await leerPrevio(page, INSUMO);
  const guia = await registrarGuiaManual(page, ctx, m, 5, 10, 6);
  if (!guia.ok) return [...resultados, { paso: 'F31.guia(5 Kilo @10, manual 6)', ok: false, esperado: 'creada', error: guia.error }];
  estado.guias.set('F31', guia.id!);
  resultados.push({
    paso: 'F31.guia(5 Kilo @10, manual 6)', ok: true, esperado: 'creada', real: `id=${guia.id}`,
    descripcion: 'Llega la mercadería con guía: 5 Kilos a S/ 10 y entran 6 unidades. La guía es la que mueve el stock.',
  });

  try {
    const rows = await consultar<{ manual: number | null }>('SELECT detalleguia_cantidadmanual AS manual FROM detalleguia WHERE guia_id = ?', [guia.id]);
    const ok = rows.length === 1 && Math.abs(Number(rows[0].manual) - 6) < TOL;
    resultados.push({ paso: 'F31.detalleguia_cantidadmanual', ok, esperado: '6', real: rows.map((x) => String(x.manual)).join(', '),
      descripcion: 'La línea de la guía guarda las 6 unidades que entraron al stock (detalleguia_cantidadmanual).' });
  } catch (e) {
    resultados.push({ paso: 'F31.detalleguia_cantidadmanual', ok: false, esperado: '6', error: String(e) });
  }

  const costoBase = (5 * 10) / 6;
  const espGuia = esperadoTrasEntrada(previo, 6, costoBase, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, espGuia.stock, espGuia.costo, espGuia.sinImp, ALMACEN),
    `Tras la guía: +6 unidades a S/ ${r3(costoBase)} (50 ÷ 6).`));
  resultados.push(await assertUltimoMovimiento(m, ctx, 6, costoBase, 'entrada guía manual'));

  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 5, 10, 6)], { guiaId: guia.id });
  if (!compra.ok) return [...resultados, { paso: 'F31.compra canje guía', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F31', compra.id!);
  resultados.push({
    paso: 'F31.compra canje guía', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Llega la factura y se registra la compra canjeando la guía: la cantidad manual viene de la guía (6).',
  });
  resultados.push(await assertLineaCompra(compra.id!, 5, 6));
  resultados.push(con(await assertStock(page, INSUMO, espGuia.stock, espGuia.costo, espGuia.sinImp, ALMACEN),
    'La compra que canjea una guía NO vuelve a mover el stock: ya lo hizo la guía.'));
  return resultados;
};

// F32: OC con la presentación manual (la OC no guarda cantidad manual) → compra que la canjea con
// 4 Kilo @12 e ingreso 5: entran 5 a 48 ÷ 5 = S/ 9.60.
export const flujoF32: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F32');

  const oc = await inyectarOrdenCompra(page, ctx, [lineaManual(m, ctx, 4, 12)], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F32.oc(4 Kilo @12)', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F32', oc.id!);
  resultados.push({
    paso: 'F32.oc(4 Kilo @12)', ok: true, esperado: 'creada', real: `id=${oc.id}`,
    descripcion: 'Orden de compra de 4 Kilos a S/ 12 en la presentación manual. La OC no guarda cantidad manual: se pide al canjearla.',
  });

  const previo = await leerPrevio(page, INSUMO);
  guardarPrevio(estado, 'F32', previo);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 4, 12, 5)], { ordenCompraId: oc.id });
  if (!compra.ok) return [...resultados, { paso: 'F32.compra canje OC (manual 5)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F32', compra.id!);
  resultados.push({
    paso: 'F32.compra canje OC (manual 5)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra que canjea la OC: al recibir, el usuario escribe que entraron 5 unidades.',
  });

  resultados.push(await assertLineaCompra(compra.id!, 4, 5));
  const costoBase = (4 * 12) / 5;
  const esp = esperadoTrasEntrada(previo, 5, costoBase, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN),
    `Tras la compra: +5 unidades a S/ ${r3(costoBase)} (48 ÷ 5).`));
  resultados.push(await assertUltimoMovimiento(m, ctx, 5, costoBase, 'entrada canje OC manual'));
  return resultados;
};

// F33: NC por precio (S/ 2 por Kilo) sobre la línea manual de F32. No mueve stock; la entrada se
// clona con nuevoCosto = (48 - 2 × 4) ÷ 5 = S/ 8.00, repartido sobre la cantidad manual, no la comprada.
export const flujoF33: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const compraId = estado.compras.get('F32');
  const insumoId = estado.maestros.get(INSUMO);
  const previo32 = estado.preEstados?.get('F32');
  if (!compraId || insumoId === undefined || !previo32) return [{ paso: 'F33.compra', ok: false, esperado: 'compra F32 existente', error: 'No hay compra F32 en el estado' }];

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 0, descuentoUnitario: 2 }], { porPrecio: true });
  if (!nc.ok) return [{ paso: 'F33.nc precio(2/Kilo)', ok: false, esperado: 'creada', error: nc.error }];
  estado.nc.set('F33', nc.id!);
  resultados.push({
    paso: 'F33.nc precio(2/Kilo)', ok: true, esperado: 'creada', real: `id=${nc.id}`,
    descripcion: 'NC por precio: el proveedor rebaja S/ 2 por Kilo sobre la compra de F32 (4 Kilos). No se devuelve mercadería.',
  });

  const costoOriginal = (4 * 12) / 5;
  const costoNuevo = (4 * 12 - 2 * 4) / 5;
  try {
    const rows = await entradasDeCompra(insumoId, ctx.almacenId, compraId);
    const origen = rows.find((x) => x.elim === '1' && Math.abs(x.costo - costoOriginal) < TOL);
    const clon = rows.find((x) => x.elim !== '1' && Math.abs(x.costo - costoNuevo) < TOL && Math.abs(x.cant - 5) < TOL);
    const ok = !!origen && !!clon;
    resultados.push({
      paso: 'F33.clon de la entrada manual', ok, esperado: `origen eliminado (5 @ ${r3(costoOriginal)}) + clon vivo (5 @ ${r3(costoNuevo)})`, real: fmtEntradas(rows),
      error: ok ? undefined : 'La NC por precio no repartió el descuento sobre la cantidad manual.',
      descripcion: `El backend anula la entrada original y la clona con el costo rebajado repartido sobre las 5 unidades que entraron: (48 − 2 × 4) ÷ 5 = S/ ${r3(costoNuevo)}. Si dividiera entre los 4 Kilos el costo saldría mal.`,
    });
  } catch (e) {
    resultados.push({ paso: 'F33.clon de la entrada manual', ok: false, esperado: 'clon', error: String(e) });
  }

  // La compra F32 fue la última entrada: el PPP se recalcula como si hubiera entrado a S/ 8.00.
  resultados.push(con(await assertStock(page, INSUMO, previo.stock, r3(ppp(previo32.stock, previo32.costo, 5, costoNuevo)), undefined, ALMACEN),
    'El stock no cambia y el costo promedio se recalcula como si la compra de F32 hubiera entrado a S/ 8.00.'));
  return resultados;
};

// F34: Anular (LIFO, devolviendo stock) una compra manual recién hecha (3 Kilo @10, ingreso 2):
// salen las 2 unidades que entraron, no 3, y el Kardex vuelve al estado previo.
export const flujoF34: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F34');

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 3, 10, 2)]);
  if (!compra.ok) return [{ paso: 'F34.compra(3 Kilo @10, manual 2)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F34', compra.id!);
  resultados.push({ paso: 'F34.compra(3 Kilo @10, manual 2)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra de 3 Kilos a S/ 10 con 2 unidades de ingreso, que luego se anula.' });
  const esp = esperadoTrasEntrada(previo, 2, (3 * 10) / 2, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN), 'Tras la compra: +2 unidades a S/ 15.00 (30 ÷ 2).'));

  const anul = await anularCompra(page, compra.id!, true);
  resultados.push({ paso: 'F34.anularCompra(devolver stock)', ok: anul.ok, esperado: 'anulada', error: anul.error,
    descripcion: 'Se anula la compra devolviendo el stock (LIFO).' });
  if (!anul.ok) return resultados;
  resultados.push(con(await assertStock(page, INSUMO, previo.stock, previo.costo, previo.sinImp, ALMACEN),
    'Al anular salen las 2 unidades que entraron (no 3) y el stock y el costo vuelven al estado previo.'));
  return resultados;
};

/** Compra manual propia para las NC de F35-F38: 6 Kilo @10 con ingreso 5 (costo base S/ 12). */
const F35_COMPRA = { cantidad: 6, costo: 10, manual: 5 };

// F35: Varias NC parciales sobre la MISMA línea manual. Disponible = ingresado − devuelto en NC activas:
// NC-a saca 2 (queda 3); NC-b pide 4 → rechazada; NC-c saca exactamente 3 (tope).
export const flujoF35: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F35');

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, F35_COMPRA.cantidad, F35_COMPRA.costo, F35_COMPRA.manual)]);
  if (!compra.ok) return [{ paso: 'F35.compra(6 Kilo @10, manual 5)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F35', compra.id!);
  resultados.push({ paso: 'F35.compra(6 Kilo @10, manual 5)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra base para las NC parciales: 6 Kilos a S/ 10 con 5 unidades de ingreso (costo base S/ 12).' });
  const costoBase = (F35_COMPRA.cantidad * F35_COMPRA.costo) / F35_COMPRA.manual;
  const esp = esperadoTrasEntrada(previo, F35_COMPRA.manual, costoBase, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN), 'Tras la compra: +5 unidades a S/ 12.00 (60 ÷ 5).'));

  const ncA = await registrarNotaCredito(page, compra.id!, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 2, cantidadManual: 2 }]);
  resultados.push({ paso: 'F35.ncA(2 Kilo, manual 2)', ok: ncA.ok, esperado: 'creada', real: ncA.id !== undefined ? `id=${ncA.id}` : undefined, error: ncA.error,
    descripcion: 'Primera NC parcial: se devuelven 2 Kilos y salen 2 unidades. Quedan 3 unidades disponibles para devolver.' });
  if (ncA.ok) estado.nc.set('F35a', ncA.id!);

  const ncB = await registrarNotaCredito(page, compra.id!, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 3, cantidadManual: 4 }]);
  resultados.push(rechazo('F35.ncB manual 4 > disponible 3 (debe rechazar)', ncB, 'rechazada: excede la disponible (3)',
    'Segunda NC que pide sacar 4 unidades cuando solo quedan 3 (5 ingresadas − 2 ya devueltas): el tope es acumulado, así que debe rechazarse.'));
  if (ncB.ok) estado.nc.set('F35b-defecto', ncB.id!);

  const antesC = await leerPrevio(page, INSUMO);
  const ncC = await registrarNotaCredito(page, compra.id!, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 3, cantidadManual: 3 }]);
  resultados.push({ paso: 'F35.ncC(3 Kilo, manual 3 = tope)', ok: ncC.ok, esperado: 'creada', real: ncC.id !== undefined ? `id=${ncC.id}` : undefined, error: ncC.error,
    descripcion: 'Tercera NC que saca exactamente lo que queda (3 unidades): debe aceptarse.' });
  if (!ncC.ok) return resultados;
  estado.nc.set('F35c', ncC.id!);
  resultados.push(await assertManualNC(ncC.id!, 3));
  resultados.push(con(await assertStock(page, INSUMO, r3(antesC.stock - 3), antesC.costo, antesC.sinImp, ALMACEN),
    'Tras la tercera NC salen 3 unidades y el costo promedio no cambia.'));
  return resultados;
};

// F36: Anular la NC-c de F35: su salida se elimina (vuelven 3 unidades) y lo devuelto deja de contar,
// así que una NC nueva puede volver a sacar hasta 3.
export const flujoF36: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  const compraId = estado.compras.get('F35');
  const ncC = estado.nc.get('F35c');
  if (!m || !compraId || !ncC) return [{ paso: 'F36.nc', ok: false, esperado: 'NC F35c existente', error: 'No hay NC F35c en el estado' }];

  const previo = await leerPrevio(page, INSUMO);
  const anul = await anularNotaCredito(page, ncC);
  resultados.push({ paso: 'F36.anularNC(F35c)', ok: anul.ok, esperado: 'anulada', error: anul.error,
    descripcion: 'Se anula la NC que había sacado 3 unidades de la línea manual.' });
  if (!anul.ok) return resultados;
  resultados.push(con(await assertStock(page, INSUMO, r3(previo.stock + 3), previo.costo, previo.sinImp, ALMACEN),
    'Al anular la NC vuelven las 3 unidades (su salida se elimina del Kárdex) y el costo promedio no cambia.'));

  const ncD = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 3, cantidadManual: 3 }]);
  resultados.push({ paso: 'F36.ncD(manual 3, disponible liberado)', ok: ncD.ok, esperado: 'creada', real: ncD.id !== undefined ? `id=${ncD.id}` : undefined, error: ncD.error,
    descripcion: 'Una NC anulada deja de contar como devuelto: se puede volver a sacar hasta 3 unidades de la misma línea.' });
  if (ncD.ok) {
    estado.nc.set('F36', ncD.id!);
    resultados.push(con(await assertStock(page, INSUMO, previo.stock, previo.costo, previo.sinImp, ALMACEN),
      'Tras la nueva NC el stock vuelve a quedar 3 unidades por debajo.'));
  }
  return resultados;
};

// F37: NC por precio sobre la compra de F35, que ya tiene devoluciones por cantidad. La entrada sigue
// siendo de 5 unidades: el clon queda en (60 − 1 × 6) ÷ 5 = S/ 10.80.
export const flujoF37: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  const compraId = estado.compras.get('F35');
  if (!m || !compraId) return [{ paso: 'F37.compra', ok: false, esperado: 'compra F35 existente', error: 'No hay compra F35 en el estado' }];

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 0, descuentoUnitario: 1 }], { porPrecio: true });
  resultados.push({ paso: 'F37.nc precio(1/Kilo) tras devoluciones', ok: nc.ok, esperado: 'creada', real: nc.id !== undefined ? `id=${nc.id}` : undefined, error: nc.error,
    descripcion: 'NC por precio de S/ 1 por Kilo sobre una compra manual que ya tuvo devoluciones por cantidad.' });
  if (!nc.ok) return resultados;
  estado.nc.set('F37', nc.id!);

  const costoNuevo = (F35_COMPRA.cantidad * F35_COMPRA.costo - 1 * F35_COMPRA.cantidad) / F35_COMPRA.manual;
  const rows = await entradasDeCompra(m.insumoId, ctx.almacenId, compraId);
  const clon = rows.find((x) => x.elim !== '1' && Math.abs(x.costo - costoNuevo) < TOL && Math.abs(x.cant - F35_COMPRA.manual) < TOL);
  resultados.push({
    paso: 'F37.clon de la entrada manual', ok: !!clon, esperado: `clon vivo (5 @ ${r3(costoNuevo)})`, real: fmtEntradas(rows),
    error: clon ? undefined : 'El clon no repartió el descuento sobre la cantidad manual.',
    descripcion: `La entrada de la compra sigue siendo de 5 unidades (las devoluciones son salidas aparte), así que el descuento se reparte entre 5: (60 − 1 × 6) ÷ 5 = S/ ${r3(costoNuevo)}.`,
  });
  resultados.push(await assertSoloStock(page, 'F37', previo, 'La NC por precio no mueve el stock (el costo sí cambia, ver el clon).'));
  return resultados;
};

// F38: Anular la NC por precio de F37: la entrada debe volver a su costo base manual (60 ÷ 5 = S/ 12.00).
// El backend re-clona con item_precio (S/ 10 por Kilo, NotacreditocompraLogistica:640-650).
export const flujoF38: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  const compraId = estado.compras.get('F35');
  const ncId = estado.nc.get('F37');
  if (!m || !compraId || !ncId) return [{ paso: 'F38.nc', ok: false, esperado: 'NC F37 existente', error: 'No hay NC F37 en el estado' }];

  const previo = await leerPrevio(page, INSUMO);
  const anul = await anularNotaCredito(page, ncId);
  resultados.push({ paso: 'F38.anularNC precio(F37)', ok: anul.ok, esperado: 'anulada', error: anul.error,
    descripcion: 'Se anula la NC por precio de F37: el costo de la entrada debe volver al original.' });
  if (!anul.ok) return resultados;

  const costoBase = (F35_COMPRA.cantidad * F35_COMPRA.costo) / F35_COMPRA.manual;
  const rows = await entradasDeCompra(m.insumoId, ctx.almacenId, compraId);
  const vivas = rows.filter((x) => x.elim !== '1');
  const ok = vivas.length === 1 && Math.abs(vivas[0].costo - costoBase) < TOL && Math.abs(vivas[0].cant - F35_COMPRA.manual) < TOL;
  resultados.push({
    paso: 'F38.entrada restaurada al costo base manual', ok, esperado: `1 entrada viva (5 @ ${r3(costoBase)})`, real: fmtEntradas(rows),
    error: ok ? undefined : `Defecto backend: al anular la NC por precio la entrada se restaura con el precio por Kilo (S/ ${F35_COMPRA.costo}) y no con el costo base manual (S/ ${r3(costoBase)}).`,
    descripcion: `Al anular una NC por precio el backend vuelve a clonar la entrada de la compra. En una línea manual el costo correcto es el base: 60 ÷ 5 = S/ ${r3(costoBase)} por unidad. El código usa item_precio (S/ ${F35_COMPRA.costo} por Kilo, NotacreditocompraLogistica.php:640-650), que en una línea manual deja el Kárdex mal valorizado.`,
  });
  resultados.push(await assertSoloStock(page, 'F38', previo, 'Anular la NC por precio no mueve el stock (el costo sí cambia, ver la entrada restaurada).'));
  return resultados;
};

// F39: NC por DESCUENTO GENERAL (monto total repartido en las líneas) sobre una compra manual.
// No devuelve mercadería: el stock no debe moverse.
export const flujoF39: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m) return sinMaestro('F39');

  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 4, 10, 3)]);
  if (!compra.ok) return [{ paso: 'F39.compra(4 Kilo @10, manual 3)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F39', compra.id!);
  resultados.push({ paso: 'F39.compra(4 Kilo @10, manual 3)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra de 4 Kilos a S/ 10 con 3 unidades de ingreso, para la NC por descuento general.' });

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compra.id!, [], { descuentoGeneral: 8 });
  resultados.push({ paso: 'F39.nc descuento general (S/ 8)', ok: nc.ok, esperado: 'creada', real: nc.id !== undefined ? `id=${nc.id}` : undefined, error: nc.error,
    descripcion: 'NC por descuento general de S/ 8 sobre el total de la compra, sin devolver mercadería. No pide "Manual a devolver". ' +
      'El modal la envía con esPorDescuentoGeneral = 1, esPorDescuentoEnItems = 0 y líneas sin cantidad; el backend no lee esPorDescuentoGeneral ' +
      'y valida como NC por cantidad (NotacreditocompraLogisticaValidator::_validarDetalles), así que la rechaza con "tiene cantidad 0".' });

  // Control: la misma NC sobre una compra normal (presentación Base). Si también se rechaza, el defecto
  // no es de la conversión manual sino de la NC por descuento general en cualquier compra.
  if (m.presBaseId !== null) {
    const normal = await compraHelper(page, ctx, [{ itemTipo: 1, itemId: m.insumoId, presentacionId: m.presBaseId, cantidad: 2, costo: 10, almacenId: ctx.almacenId, afecto: true, descripcion: INSUMO }]);
    if (normal.ok) {
      estado.compras.set('F39-normal', normal.id!);
      const ncNormal = await registrarNotaCredito(page, normal.id!, [], { descuentoGeneral: 4 });
      resultados.push({ paso: 'F39.control nc descuento general en compra normal (S/ 4)', ok: ncNormal.ok, esperado: 'creada', real: ncNormal.id !== undefined ? `id=${ncNormal.id}` : undefined, error: ncNormal.error,
        descripcion: 'Control: la misma NC por descuento general sobre una compra sin conversión manual. Si también falla, el defecto afecta a toda NC por descuento general, no solo a las líneas manuales.' });
    } else {
      resultados.push({ paso: 'F39.control compra normal', ok: false, esperado: 'creada', error: normal.error });
    }
  }
  if (!nc.ok) return resultados;
  estado.nc.set('F39', nc.id!);
  const real = await leerPrevio(page, INSUMO);
  resultados.push({
    paso: 'F39.stock sin cambio', ok: Math.abs(real.stock - previo.stock) < TOL, esperado: `stock=${previo.stock}`, real: `stock=${real.stock}; costo=${real.costo} (antes ${previo.costo})`,
    descripcion: 'Un descuento general no devuelve mercadería: el stock no debe moverse. Se informa el costo promedio antes y después: el backend registra esta NC como tipo cantidad con cantidad 0, así que hoy no rebaja el costo en el Kárdex.',
  });
  return resultados;
};

// F40: NC por cantidad sobre la compra que canjeó la guía de F31 (la guía movió el stock, no la compra).
export const flujoF40: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  const compraId = estado.compras.get('F31');
  if (!m || !compraId) return [{ paso: 'F40.compra', ok: false, esperado: 'compra F31 existente', error: 'No hay compra F31 en el estado' }];

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId: m.insumoId, cantidad: 1, cantidadManual: 1 }]);
  resultados.push({ paso: 'F40.nc sobre compra con guía (1 Kilo, manual 1)', ok: nc.ok, esperado: 'creada', real: nc.id !== undefined ? `id=${nc.id}` : undefined, error: nc.error,
    descripcion: 'NC por cantidad sobre la compra que canjeó la guía de F31: aunque el stock entró por la guía, la devolución se hace contra la compra.' });
  if (!nc.ok) return resultados;
  estado.nc.set('F40', nc.id!);
  resultados.push(con(await assertStock(page, INSUMO, r3(previo.stock - 1), previo.costo, previo.sinImp, ALMACEN),
    'Sale 1 unidad del stock y el costo promedio no cambia.'));
  return resultados;
};

// F41: Compra MIXTA (línea normal Base + línea manual Kilo del mismo insumo) y una NC que devuelve de las
// dos: la normal convierte con la presentación (1 × 1 = 1) y la manual saca lo escrito (1).
export const flujoF41: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const m = await ctxManual(ctx, estado);
  if (!m || m.presBaseId === null) return sinMaestro('F41');

  const previo = await leerPrevio(page, INSUMO);
  const lineaBase: LineaDetalle = { itemTipo: 1, itemId: m.insumoId, presentacionId: m.presBaseId, cantidad: 4, costo: 10, almacenId: ctx.almacenId, afecto: true, descripcion: INSUMO };
  const compra = await compraHelper(page, ctx, [lineaBase, lineaManual(m, ctx, 2, 10, 3)]);
  if (!compra.ok) return [{ paso: 'F41.compra mixta', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F41', compra.id!);
  resultados.push({ paso: 'F41.compra mixta (Base 4 @10 + Kilo 2 @10 manual 3)', ok: true, esperado: 'creada', real: `id=${compra.id}`,
    descripcion: 'Compra con dos líneas del mismo insumo: 4 unidades en la presentación Base (convierte 1 a 1) y 2 Kilos en la manual con 3 unidades de ingreso.' });

  // Dos entradas: Base 4 @10 y manual 3 @ 20/3. El backend fecha cada línea un segundo después de la
  // anterior (la 2.ª queda en compra_fecha + 1 s) y el stock solo cuenta movimientos con fecha < ahora
  // (MovimientoalmaceninsumoV2DB.php:109): leer en ese segundo devolvía solo la 1.ª línea (25.5 en vez de 28.5).
  await new Promise((res) => setTimeout(res, 2000));
  const tras1 = esperadoTrasEntrada(previo, 4, 10, m.divisor);
  const tras2 = esperadoTrasEntrada(tras1, 3, 20 / 3, m.divisor);
  resultados.push(con(await assertStock(page, INSUMO, tras2.stock, tras2.costo, tras2.sinImp, ALMACEN),
    `Entran 4 unidades a S/ 10.00 y 3 a S/ ${r3(20 / 3)} (20 ÷ 3): +7 en total.`));

  const sinManual = await registrarNotaCredito(page, compra.id!, [
    { nombre: INSUMO, insumoId: m.insumoId, presentacionId: m.presBaseId, cantidad: 1 },
    { nombre: INSUMO, insumoId: m.insumoId, presentacionId: m.presManualId, cantidad: 1 },
  ]);
  resultados.push(rechazo('F41.nc mixta sin manual en la línea Kilo (debe rechazar)', sinManual, 'rechazada: escribe la cantidad manual a devolver',
    'NC que devuelve de las dos líneas pero no escribe "Manual a devolver" en la manual: debe rechazarse aunque la línea normal esté bien.'));

  const antes = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compra.id!, [
    { nombre: INSUMO, insumoId: m.insumoId, presentacionId: m.presBaseId, cantidad: 1 },
    { nombre: INSUMO, insumoId: m.insumoId, presentacionId: m.presManualId, cantidad: 1, cantidadManual: 1 },
  ]);
  resultados.push({ paso: 'F41.nc mixta (Base 1 + Kilo 1 manual 1)', ok: nc.ok, esperado: 'creada', real: nc.id !== undefined ? `id=${nc.id}` : undefined, error: nc.error,
    descripcion: 'NC que devuelve 1 unidad de la línea Base (convierte con la presentación) y 1 Kilo de la manual con 1 unidad escrita.' });
  if (!nc.ok) return resultados;
  estado.nc.set('F41', nc.id!);
  resultados.push(con(await assertStock(page, INSUMO, r3(antes.stock - 2), antes.costo, antes.sinImp, ALMACEN),
    'Salen 2 unidades en total (1 por cada línea) y el costo promedio no cambia.'));
  return resultados;
};

export const FLUJOS_MANUAL: Record<string, FlujoFn> = {
  F28: flujoF28, F29: flujoF29, F30: flujoF30, F31: flujoF31, F32: flujoF32, F33: flujoF33, F34: flujoF34,
  F35: flujoF35, F36: flujoF36, F37: flujoF37, F38: flujoF38, F39: flujoF39, F40: flujoF40, F41: flujoF41,
};
