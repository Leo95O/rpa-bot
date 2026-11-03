// flujosManual.ts — Flujos F28-F34: presentación con CONVERSIÓN MANUAL (config general 197).
//
// Contrato (backend docs/agenteia/compras/conversion-manual-presentacion.md):
//  - En una línea manual el usuario escribe lo que entra al stock (detallecompra_cantidadmanual /
//    detalleguia_cantidadmanual), ya en la unidad de control. No se multiplica por la presentación.
//  - Costo base = costo × cantidad comprada ÷ cantidad manual (PresentacioninsumoLogistica::obtenerInsumoConCantidadManual).
//  - Compra/guía con presentación manual sin cantidad > 0 se rechaza (CompraLogisticaValidator::validarCantidadManualEnLineas).
//  - Canje de guía a compra: la compra no mueve stock (ya lo hizo la guía).
//  - NC por cantidad: sale lo escrito en "Manual a devolver" (detallenotacreditocompra_cantidadmanual),
//    obligatorio y ≤ disponible (NotacreditocompraLogisticaValidator::_validarCantidadManualEnDevolucion).
//  - NC por precio: nuevoCosto = (importe - descuento × cantidad) ÷ cantidad manual (NotacreditocompraLogistica:264-276).
//  - El buscador oculta la presentación manual salvo que se pida incluirConversionManual (solo compra, guía y OC).
import { Page } from 'playwright';
import { ContextoCompra, EstadoSuite, LineaDetalle, ResultadoOperacion } from './tipos';
import { hoyMas, fechaHora, serieUnica, inyectarOrdenCompra, ppp, buscarItems } from './helpers';
import { assertStock, leerMovimientos, Veredicto } from './oraculo';
import { compraHelper, esperadoTrasEntrada, leerPrevio, PrevioStock, FlujoFn } from './flujos';
import { anularCompra, registrarNotaCredito } from '../../compras';
import { crearInsumo } from '../../bot';

declare const angular: any;

const ALMACEN = 'Almacen Principal';
const INSUMO = 'Pollo Manual QA';
const PRES_MANUAL = 'Kilo';
const CONFIG_CONVERSION_MANUAL = 197;
const TOL = 0.02;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

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
  try {
    const rows = await consultar<{ v: string }>('SELECT configuracion_valor AS v FROM configuracion WHERE configuracion_id = ?', [CONFIG_CONVERSION_MANUAL]);
    if (!rows.length) return { paso, ok: false, esperado: 'fila 197 en configuracion', error: 'No existe la configuración 197 (falta migración).' };
    if (String(rows[0].v) === '1') return { paso, ok: true, esperado: '1', real: '1' };
    await consultar('UPDATE configuracion SET configuracion_valor = ? WHERE configuracion_id = ?', ['1', CONFIG_CONVERSION_MANUAL]);
    await consultar('UPDATE configuracionlocal SET configuracionlocal_valor = ? WHERE configuracion_id = ?', ['1', CONFIG_CONVERSION_MANUAL]);
    return { paso, ok: true, esperado: '1', real: 'estaba en ' + rows[0].v + '; encendida por el bot' };
  } catch (e) {
    return { paso, ok: false, esperado: '1', error: e instanceof Error ? e.message : String(e) };
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
  divisor: number;
}

/** Maestro del módulo: control en Unidad, presentación de compra "Kilo" (Kilogramo) con conversión manual. */
async function asegurarMaestro(page: Page, ctx: ContextoCompra, estado: EstadoSuite, resultados: Veredicto[]): Promise<CtxManual | null> {
  const divisor = 1 + ctx.igv / 100;
  const previo = estado.maestros.get(INSUMO);
  if (previo !== undefined) {
    const pres = (await leerPresentaciones(previo)).find((p) => p.nombre === PRES_MANUAL);
    return pres ? { insumoId: previo, presManualId: Number(pres.id), divisor } : null;
  }

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
  resultados.push({ paso: `crearInsumo('${INSUMO}') con presentación manual '${PRES_MANUAL}'`, ok: r.ok, esperado: 'creado', real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  if (!r.ok || r.id === undefined) return null;
  estado.maestros.set(INSUMO, r.id);

  // El backend fuerza la manual a no-control, no-venta y no-estándar (InsumoLogistica::normalizarConversionManual).
  const pres = (await leerPresentaciones(r.id)).find((p) => p.nombre === PRES_MANUAL);
  const flags = pres ? `manual=${pres.manual}; control=${pres.control}; venta=${pres.venta}; estandar=${pres.estandar}` : 'sin presentación';
  const okFlags = !!pres && String(pres.manual) === '1' && String(pres.control) !== '1' && String(pres.venta) !== '1' && String(pres.estandar) !== '1';
  resultados.push({ paso: `presentación '${PRES_MANUAL}' guardada como manual`, ok: okFlags, esperado: 'manual=1; control=0; venta=0; estandar=0', real: flags, error: okFlags ? undefined : 'La presentación no quedó como conversión manual.' });
  if (!pres) return null;

  // Fuera de compra/guía/OC la presentación manual no se ofrece (convertiría con ella). Se busca una
  // fila por presentación (agruparInsumo = NO), como busquedaParaCompras: agrupado solo sale una fila.
  const sinFlag = await buscarItems(page, INSUMO);
  const conFlag = await buscarItems(page, INSUMO, { incluirConversionManual: true });
  const ve = (filas: typeof sinFlag): boolean => filas.some((f) => f.presentacionId === Number(pres.id));
  const nombres = (filas: typeof sinFlag): string => filas.map((f) => f.presentacion).join(', ') || 'sin filas';
  resultados.push({ paso: 'buscador sin incluirConversionManual oculta la presentación manual', ok: sinFlag.length > 0 && !ve(sinFlag), esperado: `Base, sin '${PRES_MANUAL}'`, real: nombres(sinFlag) });
  resultados.push({ paso: 'buscador de compras (incluirConversionManual) la ofrece', ok: ve(conFlag), esperado: `con '${PRES_MANUAL}'`, real: nombres(conFlag) });

  resultados.push(...await casoKardexAgrupadoManualPrimero(page));

  return { insumoId: r.id, presManualId: Number(pres.id), divisor };
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
  resultados.push({ paso: `crearInsumo('${nombre}') con '${PRES_MANUAL}' antes que Base`, ok: r.ok, esperado: 'creado', real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
  if (!r.ok || r.id === undefined) return resultados;

  const pres = await leerPresentaciones(r.id);
  const manual = pres.find((p) => p.nombre === PRES_MANUAL);
  const base = pres.find((p) => p.nombre === 'Base');
  const orden = pres.map((p) => `${p.nombre}=${p.id}`).join(', ');
  const manualPrimero = !!manual && !!base && Number(manual.id) < Number(base.id);
  resultados.push({ paso: 'precondición: la manual nace con id menor que Base', ok: manualPrimero, esperado: `${PRES_MANUAL} < Base`, real: orden || 'sin presentaciones' });

  const kardex = await buscarItems(page, nombre, { agruparInsumo: true });
  const aparece = kardex.some((f) => f.itemId === r.id);
  resultados.push({
    paso: 'buscador del Kardex (agrupado) encuentra el insumo con manual primero', ok: aparece, esperado: 'presente',
    real: aparece ? 'presente: ' + kardex.map((f) => f.presentacion || '(sin presentación)').join(', ') : 'ausente (el filtro PHP descartó la única fila del grupo)',
    error: aparece ? undefined : 'Defecto backend: el insumo desaparece del Kardex cuando la fila agrupada es la presentación manual.',
  });

  const general = await buscarItems(page, nombre);
  const soloBase = general.length > 0 && general.every((f) => f.presentacionId !== Number(manual?.id));
  resultados.push({ paso: 'buscador por presentación muestra Base y oculta la manual', ok: soloBase, esperado: `Base, sin '${PRES_MANUAL}'`, real: general.map((f) => f.presentacion).join(', ') || 'sin filas' });
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
  try {
    const rows = await consultar<{ cant: number; manual: number | null }>(
      'SELECT detallecompra_cantidad AS cant, detallecompra_cantidadmanual AS manual FROM detallecompra WHERE compra_id = ?',
      [compraId],
    );
    const real = rows.map((x) => `cantidad=${Number(x.cant)}; manual=${x.manual == null ? 'NULL' : Number(x.manual)}`).join(' | ') || 'sin líneas';
    const ok = rows.length === 1 && Math.abs(Number(rows[0].cant) - cantidad) < TOL && Math.abs(Number(rows[0].manual) - manual) < TOL;
    return { paso, ok, esperado, real, error: ok ? undefined : 'La línea no guardó la cantidad manual esperada.' };
  } catch (e) {
    return { paso, ok: false, esperado, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Último movimiento vivo del Kardex: una línea manual entra/sale por la cantidad escrita, no la convertida. */
async function assertUltimoMovimiento(m: CtxManual, ctx: ContextoCompra, cantidad: number, costo: number | null, etiqueta: string): Promise<Veredicto> {
  const movs = await leerMovimientos(m.insumoId, ctx.almacenId);
  const ult = movs[movs.length - 1];
  const esperado = `cantidad=${cantidad}` + (costo !== null ? `; costoOperacion=${r3(costo)}` : '');
  if (!ult) return { paso: `kardex ${etiqueta}`, ok: false, esperado, error: 'Sin movimientos.' };
  const real = `cantidad=${ult.cantidad}; costoOperacion=${r3(ult.costo)}; motivo=${ult.motivo}`;
  const ok = Math.abs(ult.cantidad - cantidad) < TOL && (costo === null || Math.abs(ult.costo - costo) < TOL);
  return { paso: `kardex ${etiqueta}`, ok, esperado, real, error: ok ? undefined : 'El Kardex no movió la cantidad manual.' };
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
  if (!m) return [...resultados, { paso: 'F28.maestro', ok: false, esperado: `${INSUMO} con '${PRES_MANUAL}'`, error: 'Sin maestro manual: se omiten F28-F34.' }];

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 10, 9.5, 8)]);
  if (!compra.ok) return [...resultados, { paso: 'F28.compra', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F28', compra.id!);
  resultados.push({ paso: 'F28.compra(10 Kilo @9.50, manual 8)', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  resultados.push(await assertLineaCompra(compra.id!, 10, 8));
  const costoBase = (10 * 9.5) / 8;
  const esp = esperadoTrasEntrada(previo, 8, costoBase, m.divisor);
  resultados.push(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN));
  resultados.push(await assertUltimoMovimiento(m, ctx, 8, costoBase, 'entrada compra manual'));
  return resultados;
};

// F29: NC por cantidad sobre la línea manual de F28. Primero las dos validaciones del backend
// (sin "Manual a devolver" y por encima de lo disponible), luego devuelve 2 Kilo con 1.5 de manual:
// salen 1.5 unidades y el PPP no cambia (una salida no promedia).
export const flujoF29: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const compraId = estado.compras.get('F28');
  const insumoId = estado.maestros.get(INSUMO);
  if (!compraId || insumoId === undefined) return [{ paso: 'F29.compra', ok: false, esperado: 'compra F28 existente', error: 'No hay compra F28 en el estado' }];
  const m: CtxManual = { insumoId, presManualId: 0, divisor: 1 + ctx.igv / 100 };

  const sinManual = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2 }]);
  resultados.push({
    paso: 'F29.nc sin cantidad manual (debe rechazar)', ok: !sinManual.ok, esperado: 'rechazada: escribe la cantidad manual a devolver',
    real: sinManual.ok ? `se registró id=${sinManual.id} (defecto)` : sinManual.error,
  });
  if (sinManual.ok) estado.nc.set('F29-sinmanual', sinManual.id!);

  const excede = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2, cantidadManual: 9 }]);
  resultados.push({
    paso: 'F29.nc manual 9 > disponible 8 (debe rechazar)', ok: !excede.ok, esperado: 'rechazada: excede la disponible',
    real: excede.ok ? `se registró id=${excede.id} (defecto)` : excede.error,
  });
  if (excede.ok) estado.nc.set('F29-excede', excede.id!);

  const previo = await leerPrevio(page, INSUMO);
  const nc = await registrarNotaCredito(page, compraId, [{ nombre: INSUMO, insumoId, cantidad: 2, cantidadManual: 1.5 }]);
  if (!nc.ok) return [...resultados, { paso: 'F29.nc(2 Kilo, manual 1.5)', ok: false, esperado: 'creada', error: nc.error }];
  estado.nc.set('F29', nc.id!);
  resultados.push({ paso: 'F29.nc(2 Kilo, manual 1.5)', ok: true, esperado: 'creada', real: `id=${nc.id}` });

  try {
    const rows = await consultar<{ manual: number | null }>(
      'SELECT detallenotacreditocompra_cantidadmanual AS manual FROM detallenotacreditocompra WHERE notacreditocompra_id = ?', [nc.id],
    );
    const real = rows.map((x) => (x.manual == null ? 'NULL' : String(Number(x.manual)))).join(', ');
    const ok = rows.length === 1 && Math.abs(Number(rows[0].manual) - 1.5) < TOL;
    resultados.push({ paso: 'F29.detallenotacreditocompra_cantidadmanual', ok, esperado: '1.5', real });
  } catch (e) {
    resultados.push({ paso: 'F29.detallenotacreditocompra_cantidadmanual', ok: false, esperado: '1.5', error: String(e) });
  }

  resultados.push(await assertStock(page, INSUMO, r3(previo.stock - 1.5), previo.costo, previo.sinImp, ALMACEN));
  resultados.push(await assertUltimoMovimiento(m, ctx, 1.5, null, 'salida NC manual'));
  return resultados;
};

// F30: Compra con presentación manual SIN cantidad de ingreso: el backend la rechaza y el stock no cambia.
export const flujoF30: FlujoFn = async (page, ctx, estado) => {
  const insumoId = estado.maestros.get(INSUMO);
  if (insumoId === undefined) return [{ paso: 'F30.maestro', ok: false, esperado: INSUMO, error: 'Sin maestro manual (ver F28).' }];
  const pres = (await leerPresentaciones(insumoId)).find((p) => p.nombre === PRES_MANUAL);
  if (!pres) return [{ paso: 'F30.presentacion', ok: false, esperado: PRES_MANUAL, error: 'Sin presentación manual.' }];
  const m: CtxManual = { insumoId, presManualId: Number(pres.id), divisor: 1 + ctx.igv / 100 };

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 5, 10)]);
  if (compra.ok) estado.compras.set('F30-defecto', compra.id!);
  return [
    {
      paso: 'F30.compra manual sin cantidad (debe rechazar)', ok: !compra.ok,
      esperado: 'rechazada: necesita la cantidad manual', real: compra.ok ? `se registró id=${compra.id} (defecto)` : compra.error,
    },
    await assertStock(page, INSUMO, previo.stock, previo.costo, previo.sinImp, ALMACEN),
  ];
};

// F31: Guía con presentación manual (5 Kilo @10, ingreso 6) mueve el stock; la compra que canjea esa
// guía repite la cantidad manual pero NO vuelve a mover stock.
export const flujoF31: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const insumoId = estado.maestros.get(INSUMO);
  if (insumoId === undefined) return [{ paso: 'F31.maestro', ok: false, esperado: INSUMO, error: 'Sin maestro manual (ver F28).' }];
  const pres = (await leerPresentaciones(insumoId)).find((p) => p.nombre === PRES_MANUAL);
  if (!pres) return [{ paso: 'F31.presentacion', ok: false, esperado: PRES_MANUAL, error: 'Sin presentación manual.' }];
  const m: CtxManual = { insumoId, presManualId: Number(pres.id), divisor: 1 + ctx.igv / 100 };

  const sinManual = await registrarGuiaManual(page, ctx, m, 5, 10, undefined);
  resultados.push({
    paso: 'F31.guia manual sin cantidad (debe rechazar)', ok: !sinManual.ok, esperado: 'rechazada: necesita la cantidad manual',
    real: sinManual.ok ? `se registró id=${sinManual.id} (defecto)` : sinManual.error,
  });

  const previo = await leerPrevio(page, INSUMO);
  const guia = await registrarGuiaManual(page, ctx, m, 5, 10, 6);
  if (!guia.ok) return [...resultados, { paso: 'F31.guia(5 Kilo @10, manual 6)', ok: false, esperado: 'creada', error: guia.error }];
  estado.guias.set('F31', guia.id!);
  resultados.push({ paso: 'F31.guia(5 Kilo @10, manual 6)', ok: true, esperado: 'creada', real: `id=${guia.id}` });

  try {
    const rows = await consultar<{ manual: number | null }>('SELECT detalleguia_cantidadmanual AS manual FROM detalleguia WHERE guia_id = ?', [guia.id]);
    const ok = rows.length === 1 && Math.abs(Number(rows[0].manual) - 6) < TOL;
    resultados.push({ paso: 'F31.detalleguia_cantidadmanual', ok, esperado: '6', real: rows.map((x) => String(x.manual)).join(', ') });
  } catch (e) {
    resultados.push({ paso: 'F31.detalleguia_cantidadmanual', ok: false, esperado: '6', error: String(e) });
  }

  const costoBase = (5 * 10) / 6;
  const espGuia = esperadoTrasEntrada(previo, 6, costoBase, m.divisor);
  resultados.push(await assertStock(page, INSUMO, espGuia.stock, espGuia.costo, espGuia.sinImp, ALMACEN));
  resultados.push(await assertUltimoMovimiento(m, ctx, 6, costoBase, 'entrada guía manual'));

  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 5, 10, 6)], { guiaId: guia.id });
  if (!compra.ok) return [...resultados, { paso: 'F31.compra canje guía', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F31', compra.id!);
  resultados.push({ paso: 'F31.compra canje guía', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  resultados.push(await assertLineaCompra(compra.id!, 5, 6));
  // La compra que canjea una guía no duplica la entrada.
  resultados.push(await assertStock(page, INSUMO, espGuia.stock, espGuia.costo, espGuia.sinImp, ALMACEN));
  return resultados;
};

// F32: OC con la presentación manual (la OC no guarda cantidad manual) → compra que la canjea con
// 4 Kilo @12 e ingreso 5: entran 5 a 48 ÷ 5 = S/ 9.60.
export const flujoF32: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const insumoId = estado.maestros.get(INSUMO);
  if (insumoId === undefined) return [{ paso: 'F32.maestro', ok: false, esperado: INSUMO, error: 'Sin maestro manual (ver F28).' }];
  const pres = (await leerPresentaciones(insumoId)).find((p) => p.nombre === PRES_MANUAL);
  if (!pres) return [{ paso: 'F32.presentacion', ok: false, esperado: PRES_MANUAL, error: 'Sin presentación manual.' }];
  const m: CtxManual = { insumoId, presManualId: Number(pres.id), divisor: 1 + ctx.igv / 100 };

  const oc = await inyectarOrdenCompra(page, ctx, [lineaManual(m, ctx, 4, 12)], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F32.oc(4 Kilo @12)', ok: false, esperado: 'creada', error: oc.error }];
  estado.ordenes.set('F32', oc.id!);
  resultados.push({ paso: 'F32.oc(4 Kilo @12)', ok: true, esperado: 'creada', real: `id=${oc.id}` });

  const previo = await leerPrevio(page, INSUMO);
  guardarPrevio(estado, 'F32', previo);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 4, 12, 5)], { ordenCompraId: oc.id });
  if (!compra.ok) return [...resultados, { paso: 'F32.compra canje OC (manual 5)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F32', compra.id!);
  resultados.push({ paso: 'F32.compra canje OC (manual 5)', ok: true, esperado: 'creada', real: `id=${compra.id}` });

  resultados.push(await assertLineaCompra(compra.id!, 4, 5));
  const costoBase = (4 * 12) / 5;
  const esp = esperadoTrasEntrada(previo, 5, costoBase, m.divisor);
  resultados.push(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN));
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
  resultados.push({ paso: 'F33.nc precio(2/Kilo)', ok: true, esperado: 'creada', real: `id=${nc.id}` });

  const costoOriginal = (4 * 12) / 5;
  const costoNuevo = (4 * 12 - 2 * 4) / 5;
  try {
    const rows = await consultar<{ cant: number; costo: number; elim: string | null }>(
      'SELECT movimientoalmaceninsumo_cantidad AS cant, movimientoalmaceninsumo_costooperacion AS costo, movimientoalmaceninsumo_fueeliminado AS elim ' +
        'FROM movimientoalmaceninsumo WHERE insumo_id = ? AND almacen_id = ? AND movimientoalmaceninsumo_motivo = 2 AND movimientoalmaceninsumo_idmotivo = ?',
      [insumoId, ctx.almacenId, compraId],
    );
    const real = rows.map((x) => `cant=${Number(x.cant)} costo=${r3(Number(x.costo))} elim=${x.elim}`).join(' | ') || 'sin movimientos';
    const origen = rows.find((x) => String(x.elim) === '1' && Math.abs(Number(x.costo) - costoOriginal) < TOL);
    const clon = rows.find((x) => String(x.elim) !== '1' && Math.abs(Number(x.costo) - costoNuevo) < TOL && Math.abs(Number(x.cant) - 5) < TOL);
    const ok = !!origen && !!clon;
    resultados.push({
      paso: 'F33.clon de la entrada manual', ok, esperado: `origen eliminado (5 @ ${r3(costoOriginal)}) + clon vivo (5 @ ${r3(costoNuevo)})`, real,
      error: ok ? undefined : 'La NC por precio no repartió el descuento sobre la cantidad manual.',
    });
  } catch (e) {
    resultados.push({ paso: 'F33.clon de la entrada manual', ok: false, esperado: 'clon', error: String(e) });
  }

  // La compra F32 fue la última entrada: el PPP se recalcula como si hubiera entrado a S/ 8.00.
  resultados.push(await assertStock(page, INSUMO, previo.stock, r3(ppp(previo32.stock, previo32.costo, 5, costoNuevo)), undefined, ALMACEN));
  return resultados;
};

// F34: Anular (LIFO, devolviendo stock) una compra manual recién hecha (3 Kilo @10, ingreso 2):
// salen las 2 unidades que entraron, no 3, y el Kardex vuelve al estado previo.
export const flujoF34: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const insumoId = estado.maestros.get(INSUMO);
  if (insumoId === undefined) return [{ paso: 'F34.maestro', ok: false, esperado: INSUMO, error: 'Sin maestro manual (ver F28).' }];
  const pres = (await leerPresentaciones(insumoId)).find((p) => p.nombre === PRES_MANUAL);
  if (!pres) return [{ paso: 'F34.presentacion', ok: false, esperado: PRES_MANUAL, error: 'Sin presentación manual.' }];
  const m: CtxManual = { insumoId, presManualId: Number(pres.id), divisor: 1 + ctx.igv / 100 };

  const previo = await leerPrevio(page, INSUMO);
  const compra = await compraHelper(page, ctx, [lineaManual(m, ctx, 3, 10, 2)]);
  if (!compra.ok) return [{ paso: 'F34.compra(3 Kilo @10, manual 2)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F34', compra.id!);
  resultados.push({ paso: 'F34.compra(3 Kilo @10, manual 2)', ok: true, esperado: 'creada', real: `id=${compra.id}` });
  const esp = esperadoTrasEntrada(previo, 2, (3 * 10) / 2, m.divisor);
  resultados.push(await assertStock(page, INSUMO, esp.stock, esp.costo, esp.sinImp, ALMACEN));

  const anul = await anularCompra(page, compra.id!, true);
  resultados.push({ paso: 'F34.anularCompra(devolver stock)', ok: anul.ok, esperado: 'anulada', error: anul.error });
  if (!anul.ok) return resultados;
  resultados.push(await assertStock(page, INSUMO, previo.stock, previo.costo, previo.sinImp, ALMACEN));
  return resultados;
};

export const FLUJOS_MANUAL: Record<string, FlujoFn> = {
  F28: flujoF28, F29: flujoF29, F30: flujoF30, F31: flujoF31, F32: flujoF32, F33: flujoF33, F34: flujoF34,
};
