// flujosDefectos.ts — Flujos F42-F55: verificación de defectos conocidos del módulo de compras.
//
// Cada flujo comprueba el COMPORTAMIENTO CORRECTO: mientras el defecto exista, su paso clave sale en FALLO.
// Las fichas de cada defecto están en docs/negocio/compras/bugs-*.md (BUG-1..9, G1..G4, OC-A, OC-B).
// Verificados contra el backend master_php85 el 2026-11-16 (líneas citadas en cada descripción).
//
// | Flujo | Defecto | Qué se comprueba |
// | F42 | BUG-1 | Editar una compra pagada con caja (2 egresos) no debe dejar egresos de más |
// | F43 | BUG-2 | Dos compras «Sin comprobante» del mismo proveedor y su edición se aceptan |
// | F44 | BUG-3 | Registrar sin compra_fechatributacion la deja igual a compra_fecha |
// | F45 | BUG-5 | El último precio de compra distingue el almacén |
// | F46 | BUG-6 | Cambiar la orden de servicio de una compra libera la anterior |
// | F47 | BUG-7 | La plantilla de compra devuelve el costo unitario sin dividir por la cantidad |
// | F48 | BUG-8 | La plantilla conserva flete y tipo de cambio |
// | F49 | BUG-9 | Anular devolviendo stock una compra que vino de guía devuelve el stock |
// | F50 | G1 | Los mensajes de error de guía no hablan de «Compra» (verificación estática del código) |
// | F51 | G2 | Modificar una guía con consumo posterior se bloquea como al anular |
// | F52 | G3 | Anular una guía de INSUMO con consumo posterior se bloquea (control: producto) |
// | F53 | G4 | Una guía usada por una compra no queda anulada con la compra apuntándola |
// | F54 | OC-A | Una OC aprobada no se puede editar |
// | F55 | OC-B | Una OC ya evaluada no se puede reevaluar |
import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { ContextoCompra, EstadoSuite, LineaDetalle, ResultadoOperacion } from './tipos';
import { hoyMas, fechaHora, serieUnica, inyectarOrdenCompra, resolverPresentacion } from './helpers';
import { Veredicto } from './oraculo';
import { compraHelper, leerPrevio, FlujoFn } from './flujos';
import { resolverPresentacionProducto } from './seed';
import { anularCompra, modificarCompra } from '../../compras';
import { anularGuia, modificarGuia } from '../../guias';
import { registrarSalidaConsumible } from '../consumibles.spec';
import { actualizarOC } from '../ediciones.spec';

declare const angular: any;

const TOL = 0.02;
const ALMACEN_SUCURSAL = 18;

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

function maestro(estado: EstadoSuite, nombre: string): number | null {
  const id = estado.maestros.get(nombre);
  return id === undefined ? null : id;
}

function falta(paso: string, que: string): Veredicto[] {
  return [{ paso, ok: false, esperado: que, error: 'Precondición no disponible: ' + que }];
}

/** Rechazo esperado del backend: si acepta, es el defecto. */
function debeRechazar(paso: string, r: { ok: boolean; id?: number; error?: string }, esperado: string, descripcion: string): Veredicto {
  return { paso, ok: !r.ok, esperado, real: r.ok ? 'se aceptó' + (r.id !== undefined ? ` (id=${r.id})` : '') + ' (defecto)' : r.error, descripcion };
}

/** Caja abierta para compras que salen de caja (mismo recurso que F20). */
async function abrirCaja(): Promise<void> {
  await consultar(
    "INSERT INTO cierrecaja (local_id, caja_id, turno_id, usuario_id, cierrecaja_fecha, cierrecaja_monto, cierrecaja_motivo, cierrecaja_estado, moneda_id, cierrecaja_esmovil, cierrecaja_checksum) " +
      "VALUES (1,1,1,1,NOW(),10000,'Apertura','1',1,0,'QABOT-DEF') ON DUPLICATE KEY UPDATE cierrecaja_estado='1'",
  );
}

/** Fecha y hora de hace N días (la guía queda antes de la merma que se registra ahora). */
function haceDias(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  const f = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${f(d.getMonth() + 1)}-${f(d.getDate())} ${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}`;
}

interface LineaGuia {
  itemTipo: 1 | 2;
  itemId: number;
  presentacionId: number;
  cantidad: number;
  costo: number;
  descripcion: string;
}

/** Guía de compra por API (GuiaResource.agregar → guiacompra/guardarGuia), de insumo o de producto. */
async function registrarGuia(page: Page, ctx: ContextoCompra, l: LineaGuia, fecha: string): Promise<ResultadoOperacion> {
  return page.evaluate(async (args) => {
    const injector = angular.element(document.body).injector();
    const Gr = injector.get('GuiaResource');
    const esProducto = args.l.itemTipo === 2;
    const payload = {
      guia: {
        local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, guia_tipocambio: args.tipoCambio,
        guia_fechaemision: args.fecha, guia_serie: args.serie, guia_numeroguia: args.numero, ordencompraList: [], guia_distribucion: '0',
      },
      productos: [{
        item_id: args.l.itemId, item_tipo: args.l.itemTipo, detalleguia_descripcion: args.l.descripcion,
        detalleguia_cantidad: args.l.cantidad, detalleguia_costo: args.l.costo, detalleguia_precio: args.l.costo,
        detalleguia_importe: args.l.cantidad * args.l.costo, almacen_id: args.almacenId,
        insumo_id: esProducto ? null : args.l.itemId,
        producto_id: esProducto ? args.l.itemId : null,
        presentacioninsumo_id: esProducto ? null : args.l.presentacionId,
        presentacioncompraproducto_id: esProducto ? args.l.presentacionId : null,
        detalleguia_afectoaimpuestos: 'SI', guia_id: '-1',
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
    fecha, serie: serieUnica('G'), numero: serieUnica('G'), almacenId: ctx.almacenId, l,
  });
}

async function lineaInsumo(page: Page, estado: EstadoSuite, nombre: string, cantidad: number, costo: number): Promise<LineaGuia | null> {
  const id = maestro(estado, nombre);
  const pres = await resolverPresentacion(page, nombre, 'Base');
  return id !== null && pres ? { itemTipo: 1, itemId: id, presentacionId: pres, cantidad, costo, descripcion: nombre } : null;
}

async function lineaProducto(estado: EstadoSuite, nombre: string, cantidad: number, costo: number): Promise<LineaGuia | null> {
  const id = maestro(estado, nombre);
  const pres = await resolverPresentacionProducto(nombre, 'UNIDAD');
  return id !== null && pres ? { itemTipo: 2, itemId: id, presentacionId: pres, cantidad, costo, descripcion: nombre } : null;
}

/** Serie, número y líneas guardadas de una compra, para editarla por API con los mismos datos. */
async function compraGuardada(compraId: number): Promise<{ serie: string; numero: string; lineas: Array<{ id: number }> }> {
  const cab = (await consultar<{ s: string; n: string }>('SELECT compra_seriedoc AS s, compra_nrodoc AS n FROM compra WHERE compra_id = ?', [compraId]))[0];
  const lineas = await consultar<{ id: number }>('SELECT detallecompra_id AS id FROM detallecompra WHERE compra_id = ? ORDER BY detallecompra_id', [compraId]);
  return { serie: cab ? String(cab.s) : '', numero: cab ? String(cab.n) : '', lineas };
}

/**
 * La semilla SQL crea los productos sin producto general, y la búsqueda de productos exige
 * pg.productogeneral_estado = '1' (ProductoLogisticaDB::busquedaSensitivaProducto). Se completa en la BD QA
 * para que el producto se pueda buscar como uno creado por la pantalla.
 */
async function asegurarProductoBuscable(nombre: string): Promise<void> {
  const p = (await consultar<{ id: number; pg: number | null }>('SELECT producto_id AS id, productogeneral_id AS pg FROM producto WHERE producto_descripcion = ? LIMIT 1', [nombre]))[0];
  if (!p || p.pg) return;
  const c = await conexion();
  try {
    const [res] = await c.query(
      "INSERT INTO productogeneral (productogeneral_descripcion, productogeneral_unidadmedida, productogeneral_esfavorito, productogeneral_restaurante, " +
        "productogeneral_discoteca, productogeneral_hotel, productogeneral_estado, productogeneral_noconsumible, productogeneral_descripcionplato, " +
        "productogeneral_escombo, productogeneral_tranformado, productogeneral_checksum) VALUES (?, 'UNIDAD', '0', '1', '0', '0', '1', '0', '', '0', 0, 'QABOT')",
      [nombre],
    );
    await c.query('UPDATE producto SET productogeneral_id = ? WHERE producto_id = ?', [(res as { insertId: number }).insertId, p.id]);
  } finally {
    await c.end();
  }
}

function aLineaCompra(l: LineaGuia, almacenId: number): LineaDetalle {
  return { itemTipo: l.itemTipo, itemId: l.itemId, presentacionId: l.presentacionId, cantidad: l.cantidad, costo: l.costo, almacenId, afecto: true, descripcion: l.descripcion };
}

// ---------------------------------------------------------------------------------------------------
// F42 — BUG-1: editar una compra que salió de caja con efectivo + tarjeta.
// generarEgresoCaja (CompraLogistica.php:1454-1481) crea un egreso por medio de pago; al editar,
// eliminarEgresosGeneradosAlActualizarCompra (1807-1823) → Egreso::egresoDeCajaAbierta (Egreso.php:665-686)
// borra solo el primero ([0]) y luego se regeneran todos.
export const flujoF42: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const l = await lineaInsumo(page, estado, 'Arroz QA', 50, 4);
  if (!l) return falta('F42.maestro', "maestro 'Arroz QA' con presentación Base");
  await abrirCaja();

  const compra = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], { saliodecaja: true, montoEfectivo: 100, montoTarjeta: 100 });
  if (!compra.ok) return [{ paso: 'F42.compra contado (efectivo 100 + tarjeta 100)', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F42', compra.id!);
  const contar = async (): Promise<number> =>
    Number((await consultar<{ n: number }>("SELECT COUNT(*) AS n FROM egreso WHERE egreso_compraid = ? AND egreso_estado = '1'", [compra.id]))[0].n);
  const antes = await contar();
  resultados.push({
    paso: 'F42.compra contado (efectivo 100 + tarjeta 100)', ok: antes === 2, esperado: '2 egresos activos', real: `id=${compra.id}; egresos=${antes}`,
    descripcion: 'Compra de S/ 200 pagada con caja: S/ 100 en efectivo y S/ 100 con tarjeta. El backend crea un egreso por cada medio de pago.',
  });

  // Por API: la pantalla de edición no trae la caja seleccionada («No se encontro una caja seleccionada»).
  const g = await compraGuardada(compra.id!);
  const edit = await compraHelper(page, ctx, [{ ...aLineaCompra(l, ctx.almacenId), detallecompraId: g.lineas[0] ? Number(g.lineas[0].id) : undefined }],
    { saliodecaja: true, montoEfectivo: 100, montoTarjeta: 100, serie: g.serie, numero: g.numero, actualizarCompraId: compra.id });
  resultados.push({ paso: 'F42.editar sin cambios', ok: edit.ok, esperado: 'actualizada', error: edit.error,
    descripcion: 'Se vuelve a guardar la compra con los mismos datos (actualizarCompra), como al abrirla en edición y guardar sin cambios.' });
  if (!edit.ok) return resultados;
  const despues = await contar();
  resultados.push({
    paso: 'F42.egresos tras editar (BUG-1)', ok: despues === 2, esperado: '2 egresos activos', real: `egresos=${despues}`,
    error: despues === 2 ? undefined : 'Al editar solo se borra el primer egreso y se vuelven a crear todos.',
    descripcion: 'Defecto BUG-1: al editar, eliminarEgresosGeneradosAlActualizarCompra (CompraLogistica.php:1807-1823) borra un solo egreso ' +
      '(Egreso::egresoDeCajaAbierta, Egreso.php:665-686, toma [0]) y generarEgresoCaja vuelve a crear los dos: la caja queda con un egreso de más. ' +
      'El borrado de cuotas con pagos ya lo frena el validador («La compra es al crédito y tiene cuotas pagadas»).',
  });
  return resultados;
};

// F43 — BUG-2: «Sin comprobante». nuevacompra envía serie y número vacíos; generarDatosComprobanteInterno
// (CompraLogistica.php:2477-2483) guarda «-»/«-» después de validar, y existeCompra (CompraLogisticaValidator.php:695-713)
// compara por igualdad: al editar se reenvía «-»/«-» y choca con la otra compra.
export const flujoF43: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const l = await lineaInsumo(page, estado, 'Arroz QA', 5, 4);
  if (!l) return falta('F43.maestro', "maestro 'Arroz QA' con presentación Base");
  const opts = { tipodoc: 'Sin comprobante', serie: '', numero: '' };
  const a = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], opts);
  const b = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], opts);
  resultados.push({ paso: 'F43.compra A «Sin comprobante»', ok: a.ok, esperado: 'creada', real: a.id !== undefined ? `id=${a.id}` : undefined, error: a.error,
    descripcion: 'Compra sin comprobante: la pantalla envía serie y número vacíos y el backend guarda «-».' });
  resultados.push({ paso: 'F43.compra B «Sin comprobante» mismo proveedor', ok: b.ok, esperado: 'creada', real: b.id !== undefined ? `id=${b.id}` : undefined, error: b.error,
    descripcion: 'Segunda compra sin comprobante del mismo proveedor: debe aceptarse (no hay número que pueda duplicarse).' });
  if (!a.ok || !b.ok) return resultados;
  estado.compras.set('F43', a.id!);
  // 1) Desde la pantalla de edición.
  let pantalla: { ok: boolean; error?: string };
  try {
    pantalla = await modificarCompra(page, a.id!, [{ nombre: 'Arroz QA', insumoId: l.itemId, cantidad: 5, precio: 4 }]);
  } catch (e) {
    pantalla = { ok: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
  resultados.push({
    paso: 'F43.editar compra «Sin comprobante» desde la pantalla (BUG-2b, frontend)', ok: pantalla.ok, esperado: 'actualizada', error: pantalla.error,
    descripcion: 'Defecto del frontend: editarcompra.controller.js declara vm.comprobanteInterno («Sin comprobante», línea 63) pero nunca lo agrega a vm.comprobanteList ' +
      'ni lo asigna; al cargar la compra no encuentra su comprobante (línea 1818) y al guardar fnActualizarCompra lee vm.compra.comprobante.comprobantecompra_descripcion ' +
      '(línea 1540) sobre null: «Cannot read properties of null». Una compra sin comprobante no se puede editar desde la pantalla.',
  });

  // 2) Por API, con la serie y el número que guardó el backend («-»/«-»), como los reenviaría la pantalla.
  const g = await compraGuardada(a.id!);
  const api = await compraHelper(page, ctx, [{ ...aLineaCompra(l, ctx.almacenId), detallecompraId: g.lineas[0] ? Number(g.lineas[0].id) : undefined }],
    { tipodoc: 'Sin comprobante', serie: g.serie, numero: g.numero, actualizarCompraId: a.id });
  resultados.push({
    paso: 'F43.editar compra A por API (BUG-2)', ok: api.ok, esperado: 'actualizada', real: `serie/número guardados: «${g.serie}»/«${g.numero}»`, error: api.error,
    descripcion: 'Defecto BUG-2: el backend guarda «-»/«-» (generarDatosComprobanteInterno, CompraLogistica.php:2477-2483) y existeCompra ' +
      '(CompraLogisticaValidator.php:695-713) los compara por igualdad: al reenviarlos en la edición choca con la otra compra sin comprobante del mismo proveedor ' +
      'y la rechaza como duplicada.',
  });
  return resultados;
};

// F44 — BUG-3: CompraLogistica::inicializar (230-329) y registrar (561+) no inicializan compra_fechatributacion.
export const flujoF44: FlujoFn = async (page, ctx, estado) => {
  const l = await lineaInsumo(page, estado, 'Arroz QA', 5, 4);
  if (!l) return falta('F44.maestro', "maestro 'Arroz QA' con presentación Base");
  const compra = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], { sinFechaTributacion: true });
  if (!compra.ok) return [{ paso: 'F44.compra sin fecha de tributación', ok: false, esperado: 'creada', error: compra.error }];
  estado.compras.set('F44', compra.id!);
  const rows = await consultar<{ f: string | null; t: string | null }>(
    "SELECT DATE_FORMAT(compra_fecha, '%Y-%m-%d %H:%i:%s') AS f, DATE_FORMAT(compra_fechatributacion, '%Y-%m-%d %H:%i:%s') AS t FROM compra WHERE compra_id = ?", [compra.id]);
  const r = rows[0];
  const ok = !!r && r.t !== null && r.t === r.f;
  return [{
    paso: 'F44.compra_fechatributacion (BUG-3)', ok, esperado: `= compra_fecha (${r ? r.f : '?'})`, real: r ? String(r.t) : 'sin fila',
    error: ok ? undefined : 'La compra quedó sin fecha de tributación.',
    descripcion: 'Defecto BUG-3: si el cliente no envía compra_fechatributacion, ni inicializar() ni registrar() la completan y queda NULL. ' +
      'Los reportes caen en fallbacks distintos (informecompras.php → fecharegistro; ContabilidadRestPe.php → compra_fecha), así que la compra se periodifica distinto según el reporte.',
  }];
};

// F45 — BUG-5: DetallecompraLogistica::obtenerUltimoPrecioCompraPorInsumoProducto (1142-1210) filtra solo por
// local, moneda y fecha; el endpoint ni siquiera recibe el almacén.
export const flujoF45: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const l = await lineaInsumo(page, estado, 'Carne QA', 3, 21);
  if (!l) return falta('F45.maestro', "maestro 'Carne QA' con presentación Base (controla Principal y Producción)");
  const a = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)]);
  await new Promise((res) => setTimeout(res, 1500));
  const b = await compraHelper(page, ctx, [{ ...aLineaCompra(l, ALMACEN_SUCURSAL), costo: 33 }]);
  resultados.push({ paso: 'F45.compras en dos almacenes', ok: a.ok && b.ok, esperado: 'Principal @21 y Producción @33', error: a.error || b.error,
    descripcion: 'Dos compras de Carne QA en el mismo local y moneda: primero en el Almacén Principal a S/ 21, después en Producción a S/ 33.' });
  if (!a.ok || !b.ok) return resultados;
  const r = await page.evaluate(async (args) => {
    try {
      const R = angular.element(document.body).injector().get('DetallecompraResource');
      const resp = await R.obtenerUltimoPrecioCompraPorInsumoProducto(0, args.pres, args.local, args.moneda);
      return { ok: Number(resp.tipo) === 1, precio: resp.data ? Number(resp.data.ultimoPrecio) : null };
    } catch (e) {
      return { ok: false, precio: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, { pres: l.presentacionId, local: ctx.localId, moneda: ctx.monedaId });
  const ok = r.precio !== null && Math.abs(r.precio - 21) < TOL;
  resultados.push({
    paso: 'F45.último precio para el Almacén Principal (BUG-5)', ok, esperado: '21 (última compra en ese almacén)', real: r.precio === null ? 'sin dato' : String(r.precio),
    error: ok ? undefined : 'El último precio mezcla almacenes: devuelve el de Producción.',
    descripcion: 'Defecto BUG-5: el último precio que sugiere la compra (obtenerUltimoPrecioCompraPorInsumoProducto, DetallecompraLogistica.php:1142-1210) ' +
      'filtra por local, moneda y fecha, nunca por almacén; el endpoint (compra/obtenerUltimoPrecioCompraPorInsumoProducto/{tipo}/{id}/{local}/{moneda}) no recibe almacén. ' +
      'Para el Almacén Principal sugiere el precio de Producción.',
  });
  return resultados;
};

// F46 — BUG-6: CompraLogistica::actualizarCompraServicio (3778-3782) canjea la nueva orden de servicio sin liberar la anterior.
async function asegurarCategoriaServicio(): Promise<number> {
  const rows = await consultar<{ id: number }>("SELECT categoriaserviciocompra_id AS id FROM categoriaserviciocompra WHERE categoriaserviciocompra_estado = '1' LIMIT 1");
  if (rows.length) return Number(rows[0].id);
  const c = await conexion();
  try {
    const [res] = await c.query("INSERT INTO categoriaserviciocompra (categoriaserviciocompra_descripcion, categoriaserviciocompra_estado) VALUES ('Servicios QA', '1')");
    return Number((res as { insertId: number }).insertId);
  } finally {
    await c.end();
  }
}

async function crearOrdenServicio(page: Page, ctx: ContextoCompra, categoriaId: number, descripcion: string): Promise<ResultadoOperacion> {
  return page.evaluate(async (args) => {
    try {
      const R = angular.element(document.body).injector().get('OrdenservicioResource');
      const reg = await R.registrar({
        ordenservicio: {
          ordenservicio_descripcion: args.descripcion, ordenservicio_observacion: '', ordenservicio_fechaservicio: args.fecha,
          ordenservicio_numeroreferencia: args.ref, ordenservicio_total: 100, local_id: args.localId, moneda_id: args.monedaId,
          proveedor_id: args.proveedorId, categoriaserviciocompra_id: args.categoriaId, ordenservicio_tipocambio: args.tipoCambio,
          ordenservicio_tipo: '0', ordenservicio_esplantilla: '0',
        },
        detalles: [{ detalleordenservicio_descripcion: args.descripcion, detalleordenservicio_precio: 100 }],
        productos: [], productosEliminados: [], detallesEliminados: [],
      });
      if (Number(reg.tipo) !== 1) return { ok: false, error: 'registrar: ' + JSON.stringify(reg.mensajes) };
      const id = Number(reg.data);
      const apr = await R.aprobar(id);
      if (Number(apr.tipo) !== 1) return { ok: false, id, error: 'aprobar: ' + JSON.stringify(apr.mensajes) };
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { ...ctxArgs(ctx), categoriaId, descripcion, fecha: fechaHora(), ref: serieUnica('OS') });
}

function ctxArgs(ctx: ContextoCompra): { localId: number; proveedorId: number; monedaId: number; tipoCambio: number } {
  return { localId: ctx.localId, proveedorId: ctx.proveedorId, monedaId: ctx.monedaId, tipoCambio: ctx.tipoCambio };
}

export const flujoF46: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const categoriaId = await asegurarCategoriaServicio();
  const osA = await crearOrdenServicio(page, ctx, categoriaId, 'Mantenimiento QA A');
  const osB = await crearOrdenServicio(page, ctx, categoriaId, 'Mantenimiento QA B');
  resultados.push({ paso: 'F46.órdenes de servicio A y B aprobadas', ok: osA.ok && osB.ok, esperado: '2 OS aprobadas', real: `A=${osA.id} B=${osB.id}`, error: osA.error || osB.error,
    descripcion: 'Se crean y aprueban dos órdenes de servicio de S/ 100 del mismo proveedor.' });
  if (!osA.ok || !osB.ok) return resultados;

  const base = {
    compra_tipodoc: 'FACTURA', compra_tipo: 2, compra_esalcredito: '0', compra_subtotal: 84.746, compra_igv: 15.254, compra_total: 100,
    compra_descuento: 0, compra_flete: 0, compra_icbper: 0, compra_percepciontotal: 0,
  };
  const compra = await page.evaluate(async (args) => {
    try {
      const Cr = angular.element(document.body).injector().get('CompraResource');
      const compra = { ...args.base, local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, compra_tipocambio: args.tipoCambio,
        compra_fecha: args.fecha, compra_fechatributacion: args.fecha, compra_seriedoc: args.serie, compra_nrodoc: args.numero, ordenservicio_id: args.osA };
      const detalles = [{ detallecompraservicio_descripcion: 'Mantenimiento QA', detallecompraservicio_precio: 100, detallecompraservicio_estado: '1' }];
      const reg = await Cr.agregarCompraServicio({ compra, productos: [], detalles });
      if (Number(reg.tipo) !== 1) return { ok: false, error: 'registrar: ' + JSON.stringify(reg.mensajes) };
      const id = Number(reg.data);
      const upd = await Cr.actualizarCompraServicio({ compra: { ...compra, compra_id: id, ordenservicio_id: args.osB }, productos: [], detalles, cuotas: [] });
      if (Number(upd.tipo) !== 1) return { ok: false, id, error: 'actualizar: ' + JSON.stringify(upd.mensajes) };
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { ...ctxArgs(ctx), base, fecha: fechaHora(), serie: serieUnica('S'), numero: serieUnica('S'), osA: osA.id, osB: osB.id });
  resultados.push({ paso: 'F46.compra de servicio canjeando A y editada a B', ok: compra.ok, esperado: 'creada y actualizada', real: compra.id !== undefined ? `id=${compra.id}` : undefined, error: compra.error,
    descripcion: 'Compra de servicio que canjea la orden A; luego se edita para que canjee la orden B.' });
  if (!compra.ok) return resultados;
  estado.compras.set('F46', compra.id!);

  const os = await consultar<{ id: number; estado: string; compra: number | null }>(
    'SELECT ordenservicio_id AS id, ordenservicio_estado AS estado, compra_id AS compra FROM ordenservicio WHERE ordenservicio_id IN (?, ?)', [osA.id, osB.id]);
  const a = os.find((x) => Number(x.id) === osA.id);
  const b = os.find((x) => Number(x.id) === osB.id);
  const okA = !!a && String(a.estado) === '2' && a.compra === null;
  resultados.push({
    paso: 'F46.orden A liberada (BUG-6)', ok: okA, esperado: 'A: estado 2 (aprobada), compra_id NULL',
    real: a ? `A: estado ${a.estado}, compra_id ${a.compra}` : 'sin fila',
    error: okA ? undefined : 'La orden de servicio anterior sigue canjeada por la compra.',
    descripcion: 'Defecto BUG-6: actualizarCompraServicio (CompraLogistica.php:3778-3782) marca la nueva orden como CANJEADA con el compra_id, ' +
      'pero no desvincula la anterior (desvincularCompraVinculada solo se llama al anular). Dos órdenes quedan apuntando a la misma compra y la vieja no se puede volver a usar.',
  });
  resultados.push({ paso: 'F46.orden B canjeada', ok: !!b && String(b.estado) === '4' && Number(b.compra) === compra.id, esperado: 'B: estado 4 (canjeada), compra_id = compra',
    real: b ? `B: estado ${b.estado}, compra_id ${b.compra}` : 'sin fila', descripcion: 'Control: la orden nueva sí queda canjeada por la compra.' });
  return resultados;
};

// F47/F48 — BUG-7 y BUG-8: avance (plantilla) de compra.
/**
 * Guarda una plantilla (avance) de compra. guardarAvanceCompra responde data = null al registrar
 * (CompraLogisticaController.php:388 asigna el retorno vacío de AvancecompraLogistica::registrar), así que el id
 * se busca por el nombre de la plantilla.
 */
async function guardarAvance(page: Page, ctx: ContextoCompra, l: LineaGuia, extra: Record<string, unknown>): Promise<ResultadoOperacion> {
  const nombre = 'Plantilla QA ' + serieUnica('P');
  const r = await guardarAvanceApi(page, ctx, l, { ...extra, compra_nombreplantilla: nombre });
  if (!r.ok || (r.id !== undefined && r.id > 0)) return r;
  const fila = (await consultar<{ id: number }>('SELECT avancecompra_id AS id FROM avancecompra WHERE avancecompra_nombreplantilla = ? ORDER BY avancecompra_id DESC LIMIT 1', [nombre]))[0];
  return fila ? { ok: true, id: Number(fila.id) } : { ok: false, error: 'Plantilla guardada pero no encontrada: ' + nombre };
}

async function guardarAvanceApi(page: Page, ctx: ContextoCompra, l: LineaGuia, extra: Record<string, unknown>): Promise<ResultadoOperacion> {
  return page.evaluate(async (args) => {
    try {
      const Cr = angular.element(document.body).injector().get('CompraResource');
      const r = await Cr.guardarAvanceCompra({
        compra: {
          local_id: args.localId, proveedor_id: args.proveedorId, moneda_id: args.monedaId, compra_tipocambio: args.tipoCambio,
          compra_fecha: args.fecha, compra_tipodoc: 'FACTURA', compra_seriedoc: args.serie, compra_nrodoc: args.numero,
          compra_esalcredito: '0', compra_total: args.l.cantidad * args.l.costo, compra_esplantilla: '1', compra_nombreplantilla: 'Plantilla QA ' + args.serie,
          ...args.extra,
        },
        productos: [{
          item_id: args.l.itemId, item_tipo: 1, presentacioninsumo_id: args.l.presentacionId, almacen_id: args.almacenId,
          detallecompra_cantidad: args.l.cantidad, detallecompra_costo: args.l.costo, detallecompra_precio: args.l.costo,
          detallecompra_importe: args.l.cantidad * args.l.costo, detallecompra_afectoimpuestos: true, detallecompra_descripcion: args.l.descripcion,
        }],
      });
      const id = Number(r.data);
      return { ok: Number(r.tipo) === 1, id: Number.isFinite(id) && id > 0 ? id : undefined, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { ...ctxArgs(ctx), l, extra, almacenId: ctx.almacenId, fecha: fechaHora(), serie: serieUnica('P'), numero: serieUnica('P') });
}

async function leerPlantilla(page: Page, id: number): Promise<{ ok: boolean; data?: any; error?: string }> {
  return page.evaluate(async (pid) => {
    try {
      const Cr = angular.element(document.body).injector().get('CompraResource');
      const r = await Cr.obtenerPlantillaDeCompra(pid);
      return { ok: Number(r.tipo) === 1, data: r.data, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, id);
}

export const flujoF47: FlujoFn = async (page, ctx, estado) => {
  const l = await lineaInsumo(page, estado, 'Arroz QA', 4, 10);
  if (!l) return falta('F47.maestro', "maestro 'Arroz QA' con presentación Base");
  const av = await guardarAvance(page, ctx, l, {});
  if (!av.ok) return [{ paso: 'F47.guardar plantilla (4 @10)', ok: false, esperado: 'guardada', error: av.error }];
  const p = await leerPlantilla(page, av.id!);
  const prod = p.data && Array.isArray(p.data.productos) ? p.data.productos[0] : null;
  const costo = prod ? Number(prod.item_costo) : NaN;
  const ok = Math.abs(costo - 10) < TOL;
  return [
    { paso: 'F47.guardar plantilla (4 @10)', ok: true, esperado: 'guardada', real: `avancecompra_id=${av.id}`,
      descripcion: 'Se guarda una plantilla de compra con 4 unidades de Arroz QA a S/ 10.' },
    { paso: 'F47.costo unitario al leer la plantilla (BUG-7)', ok, esperado: 'item_costo = 10', real: p.ok ? `item_costo=${prod ? prod.item_costo : 'sin productos'}` : p.error,
      error: ok ? undefined : 'El costo leído está dividido por la cantidad.',
      descripcion: 'Defecto BUG-7: obtenerPlantillaDeCompra (CompraLogistica.php:2723 producto, 2777 insumo) calcula item_costo = item_precio / item_cantidad, ' +
        'pero detalleavancecompra_precio ya es unitario (AvancecompraLogistica.php:188). Con 4 unidades a S/ 10 la pantalla muestra S/ 2.50 y la variación de precio sale falsa.' },
  ];
};

export const flujoF48: FlujoFn = async (page, ctx, estado) => {
  const l = await lineaInsumo(page, estado, 'Arroz QA', 2, 10);
  if (!l) return falta('F48.maestro', "maestro 'Arroz QA' con presentación Base");
  const av = await guardarAvance(page, ctx, l, { compra_flete: 15, compra_tipocambio: 3.8 });
  if (!av.ok) return [{ paso: 'F48.guardar plantilla con flete y TC', ok: false, esperado: 'guardada', error: av.error }];
  const p = await leerPlantilla(page, av.id!);
  const cab = p.data ? (p.data.compra || p.data) : null;
  const flete = cab ? Number(cab.compra_flete) : NaN;
  const tc = cab ? Number(cab.compra_tipocambio) : NaN;
  const ok = Math.abs(flete - 15) < TOL && Math.abs(tc - 3.8) < TOL;
  return [
    { paso: 'F48.guardar plantilla con flete y TC', ok: true, esperado: 'guardada', real: `avancecompra_id=${av.id}`,
      descripcion: 'Se guarda una plantilla con flete de S/ 15 y tipo de cambio 3.80.' },
    { paso: 'F48.flete y tipo de cambio al leer (BUG-8)', ok, esperado: 'flete=15; tipocambio=3.8',
      real: p.ok ? `flete=${cab ? cab.compra_flete : '?'}; tipocambio=${cab ? cab.compra_tipocambio : '?'}` : p.error,
      error: ok ? undefined : 'La plantilla no conserva flete ni tipo de cambio.',
      descripcion: 'Defecto BUG-8: AvancecompraLogistica::procesarObjetoAvanceCompra (21-73) no copia flete, tipo de cambio, cuotas, impuestos ni percepciones, ' +
        'y las tablas avancecompra/detalleavancecompra no tienen columnas para ellos: la compra que nace de la plantilla los pierde.' },
  ];
};

// F49 — BUG-9: compra desde guía, anulada devolviendo stock. La compra con guía no hace entrada propia
// (CompraLogistica.php:275-278, alteraStock = NO); al anular salta _descontarStockPorDevolucion y la llamada
// _descontarStockAGuiasVinculadas está comentada (2589-2599): el stock de la guía nunca vuelve.
export const flujoF49: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const l = await lineaInsumo(page, estado, 'Arroz QA', 7, 4);
  if (!l) return falta('F49.maestro', "maestro 'Arroz QA' con presentación Base");
  const previo = await leerPrevio(page, 'Arroz QA');
  const guia = await registrarGuia(page, ctx, l, fechaHora());
  if (!guia.ok) return [{ paso: 'F49.guía (7 u)', ok: false, esperado: 'creada', error: guia.error }];
  const compra = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], { guiaId: guia.id });
  resultados.push({ paso: 'F49.guía + compra que la canjea', ok: compra.ok, esperado: 'creadas', real: `guía=${guia.id}; compra=${compra.id}`, error: compra.error,
    descripcion: 'Entran 7 unidades de Arroz QA con una guía y luego se registra la compra que la factura (la compra no mueve stock).' });
  if (!compra.ok) return resultados;
  const anul = await anularCompra(page, compra.id!, true);
  resultados.push({ paso: 'F49.anular compra devolviendo stock', ok: anul.ok, esperado: 'anulada', error: anul.error,
    descripcion: 'Se anula la compra marcando «devolver stock».' });
  if (!anul.ok) return resultados;
  await new Promise((res) => setTimeout(res, 1100));
  const real = await leerPrevio(page, 'Arroz QA');
  const okStock = Math.abs(real.stock - previo.stock) < TOL;
  resultados.push({
    paso: 'F49.stock devuelto (BUG-9)', ok: okStock, esperado: `stock=${previo.stock} (antes de la guía)`, real: `stock=${real.stock}`,
    error: okStock ? undefined : 'Se anuló la compra devolviendo stock, pero el stock de la guía sigue.',
    descripcion: 'Defecto BUG-9: la compra que factura una guía no hace entrada propia (CompraLogistica.php:275-278). Al anularla con «devolver stock», ' +
      'anular() salta _descontarStockPorDevolucion y _descontarStockAGuiasVinculadas está comentada (2589-2599): la compra queda anulada y con devolverstock=1, ' +
      'pero el stock que entró con la guía no se devuelve y la guía queda activa y desvinculada (liberarCompraVinculada).',
  });
  return resultados;
};

// F50 — G1: GuiaLogisticaController.php:100 y :395. Ningún request llega a esas ramas (el validador frena antes y los
// errores de BD salen como HTTP), así que se verifica leyendo el código fuente del backend.
export const flujoF50: FlujoFn = async () => {
  const raiz = process.env.WEBAPP_PATH || 'C:/laragon/www/webapp';
  const archivo = path.join(raiz, 'logistica/controllers/GuiaLogisticaController.php');
  const descripcion = 'Defecto G1: en guías, la rama de error de guardarGuia dice «Se produjo un error al crear tu Compra» (GuiaLogisticaController.php:100) ' +
    'y la de actualizarGuia «…crear tu actualizar…» (:395). Ningún request llega a esas ramas (el validador frena antes), así que se verifica leyendo el código. ' +
    'Ruta del backend configurable con WEBAPP_PATH.';
  if (!fs.existsSync(archivo)) {
    return [{ paso: 'F50.literales de error de guía (G1)', ok: false, pendiente: true, esperado: 'código del backend accesible', real: archivo, descripcion }];
  }
  const lineas = fs.readFileSync(archivo, 'utf8').split(/\r?\n/);
  const malas = lineas.map((t, i) => ({ t, n: i + 1 })).filter((x) => /crear tu (Compra|actualizar)/.test(x.t));
  return [{
    paso: 'F50.literales de error de guía (G1)', ok: malas.length === 0, esperado: 'sin «crear tu Compra» ni «crear tu actualizar»',
    real: malas.length ? malas.map((x) => `línea ${x.n}`).join(', ') : 'sin coincidencias',
    error: malas.length ? 'Los mensajes de error de guía hablan de «Compra».' : undefined, descripcion,
  }];
};

// F51 — G2: GuiaLogisticaValidator::_validarModificacion tiene comentada la llamada a guiaTieneProductosConOperaciones2
// (109-116) que _validarAnulacion sí ejecuta (131-135). Se usa un PRODUCTO (el chequeo solo cubre productos, ver F52).
export const flujoF51: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  await asegurarProductoBuscable('Gaseosa QA');
  const l = await lineaProducto(estado, 'Gaseosa QA', 6, 3);
  if (!l) return falta('F51.maestro', "producto 'Gaseosa QA' con presentación UNIDAD");
  const guia = await registrarGuia(page, ctx, l, haceDias(1));
  if (!guia.ok) return [{ paso: 'F51.guía de producto (ayer, 6 u)', ok: false, esperado: 'creada', error: guia.error }];
  const merma = await registrarSalidaConsumible(page, 'Gaseosa QA', 1, 'QA consumo posterior G2');
  resultados.push({ paso: 'F51.guía de ayer + salida de hoy', ok: merma.ok, esperado: 'guía y merma registradas', real: `guía=${guia.id}; merma=${merma.id}`, error: merma.error,
    descripcion: 'Entran 6 Gaseosa QA con una guía fechada ayer y hoy sale 1 por merma: lo que trajo la guía ya se usó.' });
  if (!merma.ok) return resultados;
  const mod = await modificarGuia(page, guia.id!, [{ nombre: 'Gaseosa QA', cantidad: 4, precio: 3 }]);
  resultados.push(debeRechazar('F51.modificar guía con consumo posterior (G2)', mod, 'rechazada: el producto ya fue usado en otra operación',
    'Defecto G2: anular esta guía se bloquea («ya ha sido usado para otra operación, verifica el kardex», GuiaLogisticaValidator.php:131-135), ' +
    'pero modificarla no: en _validarModificacion la misma comprobación está comentada (109-116). Bajar la cantidad recalcula el diferencial y descuadra el kárdex hacia atrás.'));
  return resultados;
};

// F52 — G3: el chequeo de movimientos posteriores solo evalúa productos (GuiaLogisticaValidator.php:300); la rama de
// insumos está comentada (316-323).
export const flujoF52: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  await asegurarProductoBuscable('Gaseosa QA');
  const li = await lineaInsumo(page, estado, 'Arroz QA', 5, 4);
  const lp = await lineaProducto(estado, 'Gaseosa QA', 5, 3);
  if (!li || !lp) return falta('F52.maestros', "insumo 'Arroz QA' y producto 'Gaseosa QA'");

  const gi = await registrarGuia(page, ctx, li, haceDias(1));
  const mi = gi.ok ? await registrarSalidaConsumible(page, 'Arroz QA', 1, 'QA consumo posterior G3') : { ok: false, error: gi.error };
  resultados.push({ paso: 'F52.guía de insumo (ayer) + salida de hoy', ok: gi.ok && mi.ok, esperado: 'registradas', real: `guía=${gi.id}`, error: mi.error,
    descripcion: 'Entran 5 Arroz QA con una guía de ayer y hoy sale 1 por merma.' });
  if (gi.ok && mi.ok) {
    const an = await anularGuia(page, gi.id!, true);
    resultados.push(debeRechazar('F52.anular guía de INSUMO con consumo posterior (G3)', an, 'rechazada: el insumo ya fue usado',
      'Defecto G3: el freno de kárdex posterior al anular solo mira productos (GuiaLogisticaValidator.php:300); la rama de insumos está comentada (316-323). ' +
      'La guía de insumo se anula aunque lo que trajo ya salió, y el kárdex queda negativo hacia atrás.'));
  }

  const gp = await registrarGuia(page, ctx, lp, haceDias(1));
  const mp = gp.ok ? await registrarSalidaConsumible(page, 'Gaseosa QA', 1, 'QA consumo posterior G3 control') : { ok: false, error: gp.error };
  if (gp.ok && mp.ok) {
    const an = await anularGuia(page, gp.id!, true);
    resultados.push(debeRechazar('F52.control: anular guía de PRODUCTO con consumo posterior', an, 'rechazada',
      'Control: con un producto el mismo caso sí se bloquea. Muestra que la diferencia es solo por el tipo de ítem.'));
  } else {
    resultados.push({ paso: 'F52.control guía de producto', ok: false, esperado: 'registrada', error: mp.error || gp.error });
  }
  return resultados;
};

// F53 — G4: GuiaLogistica::anular (438-452) no limpia guia.compra_id ni guia_porcompra y nada impide anular una guía
// ya facturada por una compra activa.
export const flujoF53: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const l = await lineaInsumo(page, estado, 'Arroz QA', 3, 4);
  if (!l) return falta('F53.maestro', "maestro 'Arroz QA' con presentación Base");
  const guia = await registrarGuia(page, ctx, l, fechaHora());
  if (!guia.ok) return [{ paso: 'F53.guía', ok: false, esperado: 'creada', error: guia.error }];
  const compra = await compraHelper(page, ctx, [aLineaCompra(l, ctx.almacenId)], { guiaId: guia.id });
  resultados.push({ paso: 'F53.guía + compra que la canjea', ok: compra.ok, esperado: 'creadas', real: `guía=${guia.id}; compra=${compra.id}`, error: compra.error,
    descripcion: 'Una guía facturada por una compra activa (guia.compra_id = compra, guia_porcompra = 1).' });
  if (!compra.ok) return resultados;
  const an = await anularGuia(page, guia.id!, true);
  const fila = (await consultar<{ estado: string; compra: number | null; porcompra: string }>(
    'SELECT guia_estado AS estado, compra_id AS compra, guia_porcompra AS porcompra FROM guia WHERE guia_id = ?', [guia.id]))[0];
  const huerfana = an.ok && !!fila && fila.compra !== null;
  resultados.push({
    paso: 'F53.anular guía usada por una compra (G4)', ok: !huerfana, esperado: 'rechazada, o anulada con compra_id = NULL',
    real: `anulación=${an.ok ? 'aceptada' : 'rechazada'}; guia_estado=${fila ? fila.estado : '?'}; compra_id=${fila ? fila.compra : '?'}; porcompra=${fila ? fila.porcompra : '?'}`,
    error: huerfana ? 'La guía se anuló y la compra activa sigue apuntándola.' : undefined,
    descripcion: 'Defecto G4: anularGuia no valida que la guía esté facturada, y GuiaLogistica::anular (438-452) desvincula OC y remisión pero no limpia ' +
      'guia.compra_id ni guia_porcompra (existe GuiaLogisticaDB::desvincularCompra, sin usar). La compra queda apuntando a una guía anulada.',
  });
  return resultados;
};

// F54 — OC-A: actualizaOrdencompra (OrdencompraLogisticaController.php:273) corre el validador de OC, pero
// validarEstadoParaEdiccion (OrdencompraLogisticaValidator.php:106-110) busca la OC en la tabla ordenservicio.
export const flujoF54: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const id = maestro(estado, 'Arroz QA');
  const pres = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (id === null || !pres) return falta('F54.maestro', "maestro 'Arroz QA' con presentación Base");
  const oc = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: id, presentacionId: pres, cantidad: 10, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F54.OC', ok: false, esperado: 'creada', error: oc.error }];
  const apr = await page.evaluate(async (ocId) => {
    try {
      const r = await angular.element(document.body).injector().get('OrdencompraResource').aprobar(ocId);
      return { ok: Number(r.tipo) === 1, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, oc.id!);
  const est = (await consultar<{ e: string }>('SELECT ordencompra_estado AS e FROM ordencompra WHERE ordencompra_id = ?', [oc.id]))[0];
  resultados.push({ paso: 'F54.OC aprobada', ok: apr.ok && !!est && String(est.e) === '1', esperado: 'estado 1 (aprobada)', real: `id=${oc.id}; estado=${est ? est.e : '?'}`, error: apr.error,
    descripcion: 'Se crea una OC de 10 Arroz QA a S/ 4 y se aprueba.' });
  if (!apr.ok) return resultados;
  const ed = await actualizarOC(page, oc.id!, 5);
  resultados.push(debeRechazar('F54.editar OC aprobada (OC-A)', ed, 'rechazada: «No se puede editar una orden de compra ya aprobada.»',
    'Defecto OC-A: actualizaOrdencompra (OrdencompraLogisticaController.php:273) corre el validador de OC, pero validarEstadoParaEdiccion ' +
    '(OrdencompraLogisticaValidator.php:106-110) carga la OC con OrdenservicioLogistica::getById, es decir desde la tabla ordenservicio: no la encuentra y la edición pasa. ' +
    'En pantalla lo frena el frontend; por API una OC aprobada se puede reescribir.'));
  return resultados;
};

// F55 — OC-B: evaluarOrdenescompra (OrdencompraLogisticaController.php:629) usa «!= ACEPTADA || != RECHAZADA», siempre verdadero.
export const flujoF55: FlujoFn = async (page, ctx, estado) => {
  const resultados: Veredicto[] = [];
  const id = maestro(estado, 'Arroz QA');
  const pres = await resolverPresentacion(page, 'Arroz QA', 'Base');
  if (id === null || !pres) return falta('F55.maestro', "maestro 'Arroz QA' con presentación Base");
  const oc = await inyectarOrdenCompra(page, ctx, [{ itemTipo: 1, itemId: id, presentacionId: pres, cantidad: 10, costo: 4, almacenId: ctx.almacenId, afecto: true, descripcion: 'Arroz QA' }], hoyMas(7), false);
  if (!oc.ok) return [{ paso: 'F55.OC', ok: false, esperado: 'creada', error: oc.error }];

  // El permiso 121 (evaluar OC) se lee de permisosusuario; en la BD QA el admin lo tiene en 0. Se activa y se restaura.
  const usuarioId = await page.evaluate(() => Number(angular.element(document.body).injector().get('SecurityService').getUsuarioId()));
  const previo = await consultar<{ e: string }>('SELECT permisousuario_estado AS e FROM permisosusuario WHERE permiso_id = 121 AND usuario_id = ?', [usuarioId]);
  if (previo.length) await consultar("UPDATE permisosusuario SET permisousuario_estado = '1' WHERE permiso_id = 121 AND usuario_id = ?", [usuarioId]);
  else await consultar("INSERT INTO permisosusuario (permiso_id, usuario_id, permisousuario_estado) VALUES (121, ?, '1')", [usuarioId]);
  try {
    const evaluar = async (tipo: number): Promise<{ ok: boolean; error?: string }> => page.evaluate(async (args) => {
      try {
        const r = await angular.element(document.body).injector().get('OrdencompraResource')
          .evaluarOrdenescompra({ listaOrdenescomopra: [args.oc], ordencompra_tipoevaluacion: args.tipo });
        return { ok: Number(r.tipo) === 1, error: Number(r.tipo) === 1 ? undefined : JSON.stringify(r.mensajes) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, { oc: oc.id, tipo });
    const ev0 = (await consultar<{ e: string }>('SELECT ordencompra_evaluacion AS e FROM ordencompra WHERE ordencompra_id = ?', [oc.id]))[0];
    let base = ev0 ? String(ev0.e) : '?';
    if (base !== '1') {
      const acept = await evaluar(1);
      resultados.push({ paso: 'F55.aceptar OC', ok: acept.ok, esperado: 'evaluación 1 (aceptada)', error: acept.error });
      base = '1';
    }
    resultados.push({ paso: 'F55.OC aceptada', ok: true, esperado: 'evaluación 1', real: `id=${oc.id}; evaluación=${base}`,
      descripcion: 'Una OC con evaluación final ACEPTADA (con la config 71 en 0 nace aceptada).' });
    const re = await evaluar(3);
    const ev = (await consultar<{ e: string }>('SELECT ordencompra_evaluacion AS e FROM ordencompra WHERE ordencompra_id = ?', [oc.id]))[0];
    resultados.push({
      paso: 'F55.reevaluar OC aceptada como rechazada (OC-B)', ok: !re.ok && !!ev && String(ev.e) === '1', esperado: 'rechazada; evaluación sigue en 1',
      real: `respuesta=${re.ok ? 'éxito' : re.error}; evaluación=${ev ? ev.e : '?'}`,
      error: re.ok ? 'Una OC con evaluación final se pudo reevaluar.' : undefined,
      descripcion: 'Defecto OC-B: evaluarOrdenescompra (OrdencompraLogisticaController.php:629) solo debería evaluar órdenes sin evaluación final, ' +
        'pero la condición «evaluacion != ACEPTADA || evaluacion != RECHAZADA» es siempre verdadera: una OC aceptada se puede rechazar y volver a aceptar por API. ' +
        'El bot activa el permiso 121 del usuario para la prueba y lo restaura al final.',
    });
  } finally {
    if (previo.length) await consultar('UPDATE permisosusuario SET permisousuario_estado = ? WHERE permiso_id = 121 AND usuario_id = ?', [previo[0].e, usuarioId]);
    else await consultar('DELETE FROM permisosusuario WHERE permiso_id = 121 AND usuario_id = ?', [usuarioId]);
  }
  return resultados;
};

export const FLUJOS_DEFECTOS: Record<string, FlujoFn> = {
  F42: flujoF42, F43: flujoF43, F44: flujoF44, F45: flujoF45, F46: flujoF46, F47: flujoF47, F48: flujoF48,
  F49: flujoF49, F50: flujoF50, F51: flujoF51, F52: flujoF52, F53: flujoF53, F54: flujoF54, F55: flujoF55,
};
