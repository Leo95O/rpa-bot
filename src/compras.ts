import { Page } from 'playwright';
import { CompraAgrupada, CamposExtraCompra } from './types';

declare const angular: any;
import {
  registrarCompra as registrarCompraCore,
  navegar,
  esperarEndpoint,
  leerRespuesta,
} from './bot';
import { volcarScope, escribirMuestra } from './utils/debugger';

export interface ParamDetalleCompra {
  nombre: string;
  insumoId?: number;
  cantidad: number;
  precio: number;
  presentacion?: string;
}

/**
 * Estado forzado de la compra (inyección de estado extendida).
 *
 * Estructura lista para que, tras la inspección visual de la vista real
 * (`nuevaCompraCtrl`), solo haya que pasar el parámetro correcto y el bot lo
 * fuerce sobre `compraNueva` (ver `bot.ts`, bloque "Inyección de estado
 * forzado"). NADA de esto se valida contra el backend aquí: los nombres de
 * campo quedan pendientes de verificación visual.
 *
 * Candidatos (a confirmar):
 *  - `almacenId`: id de almacén destino a forzar (pisa el resuelto de `vm`).
 *  - `afectaKardex`: flag booleano que la vista enviaría (p. ej. `afecta_kardex`).
 *  - `estadoComprobante` / `compraEstado`: estado del documento (p. ej. 'RECIBIDO').
 *  - `distribucionAlmacenes`: array de distribución por almacén si la vista lo pide.
 *  - `extra`: escape hatch — campos crudos `compraNueva.<campo>` tal cual.
 */
export interface EstadoForzadoCompra {
  almacenId?: number;
  afectaKardex?: boolean;
  estadoComprobante?: string;
  compraEstado?: string;
  distribucionAlmacenes?: Array<{ almacen_id: number; cantidad?: number }>;
  extra?: Record<string, string | number | boolean | null>;
}

export interface ParamCompra {
  serie: string;
  numero: string;
  proveedor?: string;
  local?: string;
  moneda?: string;
  tipoComprobante?: string;
  almacen?: string;
  fechaCompra?: string;
  /** Estado a forzar sobre `compraNueva` (opcional; ver `EstadoForzadoCompra`). */
  estado?: EstadoForzadoCompra;
  detalle: ParamDetalleCompra[];
}

export interface ResultadoOperacionE2E {
  ok: boolean;
  id?: number;
  error?: string;
}

/**
 * Fecha-hora local actual con el formato que el backend espera para la compra
 * (`YYYY-MM-DD HH:mm:ss`). Antes se hardcodeaba una fecha fija que, al quedar
 * en el pasado, hacía que el movimiento de la compra se registrara ANTES de la
 * apertura de stock y el Kardex (ordenado por fecha) ignorara el incremento.
 */
export function ahoraLocal(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Traduce `EstadoForzadoCompra` al mapa crudo `CompraCabecera.extra` que
 * `bot.ts` vuelca sobre `compraNueva` con `Object.assign` (precedencia total).
 * Mantener aquí el mapeo nombre-amigable → nombre-de-campo para que, si la
 * inspección visual revela otro nombre real, solo haya que tocar esta función.
 */
export function construirExtraCompra(estado?: EstadoForzadoCompra): CamposExtraCompra {
  const extra: CamposExtraCompra = { ...(estado?.extra ?? {}) };
  if (estado?.almacenId != null) extra['almacen_id'] = estado.almacenId;
  if (estado?.afectaKardex !== undefined) extra['afecta_kardex'] = estado.afectaKardex ? '1' : '0';
  if (estado?.estadoComprobante !== undefined) extra['compra_estado'] = estado.estadoComprobante;
  if (estado?.compraEstado !== undefined && extra['compra_estado'] === undefined) {
    extra['compra_estado'] = estado.compraEstado;
  }
  if (estado?.distribucionAlmacenes !== undefined) {
    extra['distribucion_almacenes'] = JSON.stringify(estado.distribucionAlmacenes);
  }
  return extra;
}

export async function registrarCompra(page: Page, p: ParamCompra): Promise<ResultadoOperacionE2E> {
  const compra: CompraAgrupada = {
    idOperacion: 'E2E-COMPRA-' + Date.now(),
    cabecera: {
      local: p.local || 'CD Logistico',
      proveedor: p.proveedor || 'GRUPO SEVEN SEAS SAC',
      moneda: p.moneda || 'Soles',
      tipoComprobante: p.tipoComprobante || 'Factura',
      serie: p.serie,
      numero: p.numero + '-' + Date.now(),
      fechaCompra: p.fechaCompra || ahoraLocal(),
      fechaTributacion: p.fechaCompra || ahoraLocal(),
      almacen: p.almacen || 'Almacen Principal',
      notas: '',
      impuestosIncluidos: true,
      descuentoGlobal: 0,
      extra: construirExtraCompra(p.estado),
    },
    detalle: p.detalle.map((d) => ({
      tipoItem: 'INSUMO',
      itemCodigo: '',
      itemNombre: d.nombre,
      cantidad: d.cantidad,
      precio: d.precio,
      descuento: 0,
      afectoIgv: true,
      presentacion: d.presentacion,
    })),
  };

  const r = await registrarCompraCore(page, compra);
  if (r.ok) return { ok: true, id: r.idGenerado };
  return { ok: false, error: r.error };
}

export async function consultarCompra(page: Page, id: number): Promise<{ ok: boolean; data?: any; error?: string }> {
  return page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const Compra = injector.get('Compra');
      const PARAM = injector.get('PARAM');
      const resp = await Compra.obtenerCompra(id, PARAM.NO);
      return { ok: Number(resp.tipo) === 1, data: resp.data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, id);
}

export async function anularCompra(
  page: Page,
  id: number,
  devolverStock: boolean,
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const Compra = injector.get('Compra');
      const PARAM = injector.get('PARAM');
      const resp = await Compra.anulaCompra(args.id, args.devolverStock ? PARAM.SI : PARAM.NO);
      if (Number(resp.tipo) === 1) return { ok: true };
      return { ok: false, error: resp && resp.mensajes ? resp.mensajes.join('; ') : 'Sin respuesta de anularCompra.' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { id, devolverStock });
}

export async function modificarCompra(
  page: Page,
  id: number,
  detalle: ParamDetalleCompra[],
): Promise<ResultadoOperacionE2E> {
  await navegar(page, 'logistica.compra.editarcompra', { idCompra: id });

  await page.waitForFunction(
    () => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        let encontrado = false;
        (function walk(s: any): void {
          if (encontrado) return;
          if (s.vm && typeof s.vm.fnActualizarCompra === 'function') {
            encontrado = true;
            return;
          }
          let c = s.$$childHead;
          while (c) {
            walk(c);
            c = c.$$nextSibling;
          }
        })($rootScope);
        return encontrado;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 25000 },
  );

  const endpoint = esperarEndpoint(page, 'compra/actualizarCompra', 60000).catch(() => null);

  const inyeccion = await page.evaluate(
    async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');

        function encontrarScope() {
          let found: any = null;
          (function walk(s: any): void {
            if (found) return;
            if (s.vm && typeof s.vm.fnActualizarCompra === 'function') {
              found = s;
              return;
            }
            let c = s.$$childHead;
            while (c) {
              walk(c);
              c = c.$$nextSibling;
            }
          })($rootScope);
          return found;
        }

        // Espejo de utils/deepFind.ts (deepFindId): page.evaluate no puede
        // importar módulos, así que el algoritmo vive inline aquí. Mantener
        // sincronizado: 1) match directo en item_id/insumo_id, 2) barrido
        // recursivo de claves con pinta de ID a cualquier profundidad,
        // 3) fallback de texto.
        function idEnNodo(nodo: any, objetivo: number, prof: number, vistos: any[]): boolean {
          if (nodo === null || nodo === undefined) return false;
          const t = typeof nodo;
          if (t === 'number' || t === 'string') {
            const s = String(nodo).trim();
            return s !== '' && !Number.isNaN(Number(s)) && Number(s) === objetivo;
          }
          if (t !== 'object') return false;
          if (prof > 8 || vistos.indexOf(nodo) >= 0) return false;
          vistos.push(nodo);
          try {
            const claves: Array<string | number> = Array.isArray(nodo)
              ? nodo.map((_: unknown, i: number) => i)
              : Object.keys(nodo);
            const esClaveId = (k: string): boolean =>
              /^(item_id|insumo_id|producto_id|presentacioninsumo_id|presentacion_id|detallecompra_id|detalleguia_id)$/i.test(k) ||
              /insumo.*id|id.*insumo/i.test(k);
            for (const k of claves) {
              const ks = String(k);
              if (ks.charAt(0) === '$') continue;
              if (!esClaveId(ks)) continue;
              if (idEnNodo((nodo as any)[k], objetivo, prof + 1, vistos)) return true;
            }
            for (const k of claves) {
              const ks = String(k);
              if (ks.charAt(0) === '$') continue;
              const v = (nodo as any)[k];
              if (v !== null && typeof v === 'object') {
                if (idEnNodo(v, objetivo, prof + 1, vistos)) return true;
              }
            }
            for (const k of claves) {
              const ks = String(k);
              if (ks.toLowerCase() !== 'id') continue;
              if (idEnNodo((nodo as any)[k], objetivo, prof + 1, vistos)) return true;
            }
            return false;
          } finally {
            const i = vistos.indexOf(nodo);
            if (i >= 0) vistos.splice(i, 1);
          }
        }

        function coincide(item: any, d: any): boolean {
          if (d.insumoId != null) {
            const ids = [item.item_id, item.insumo_id];
            if (ids.some((id: any) => id != null && Number(id) === Number(d.insumoId))) return true;
            if (idEnNodo(item, Number(d.insumoId), 0, [])) return true;
          }
          const n = String(d.nombre || '').trim().toLowerCase();
          if (!n) return false;
          const campos = [
            item.item_descripcion,
            item.descripcion,
            item.item_nombre,
            item.insumo_nombre,
            item.insumo && item.insumo.insumo_nombre,
            item.insumo && item.insumo.insumo_descripcion,
            item.insumo && item.insumo.nombre,
            item.item && item.item.insumo_nombre,
            item.producto && item.producto.producto_descripcion,
          ];
          for (const c of campos) {
            if (String(c || '').trim().toLowerCase() === n) return true;
          }
          try {
            if (JSON.stringify(item).toLowerCase().indexOf(n) >= 0) return true;
          } catch {
            /* ignore */
          }
          return false;
        }

        const scope = encontrarScope();
        if (!scope) return { ok: false, error: 'No se encontró editarCompraCtrl (vm.fnActualizarCompra).' };
        const vm = scope.vm;

        // Esperar a que el detalle cargue con datos REALES. La directiva
        // HandsOnTable (rp-hot) pre-puebla `detallecompraList` con filas
        // vacías antes de que `fnCargarCompra` resuelva los `productos`, por lo
        // que `length > 0` no basta: hay que esperar a que exista al menos una
        // fila con `item_id` (o `item_descripcion`) real.
        const inicio = Date.now();
        let detalleListo = false;
        while (Date.now() - inicio < 20000) {
          const lista = vm.compra && vm.compra.detallecompraList;
          if (lista && lista.some((x: any) => x && (x.item_id || x.item_descripcion))) {
            detalleListo = true;
            break;
          }
          await new Promise((res) => setTimeout(res, 200));
        }
        if (!vm.compra || !vm.compra.detallecompraList) {
          return { ok: false, error: 'La compra no se cargó para edición.' };
        }
        if (!detalleListo) {
          return { ok: false, error: 'El detalle de la compra cargó sin datos de ítems.' };
        }

        for (const d of args.detalle) {
          const fila = vm.compra.detallecompraList.find((x: any) => coincide(x, d));
          if (!fila) return { ok: false, error: 'No se encontró el item "' + d.nombre + '" en la compra.' };
          fila.item_cantidad = d.cantidad;
          fila.item_precio = d.precio;
          fila.item_total = d.cantidad * d.precio;
        }

        // Regenerar el formato backend desde el detalle editado (igual que
        // fnActualizarCompra / procesarDatosCompra). Enviar el
        // detallecompraListParaBackend "viejo" provocaba
        // "La lista de productos y/o insumos está vacía.".
        try {
          vm.compra.detallecompraListParaBackend = vm.compra.obtenerFormatoDetalleCompraBackend(
            vm.compra.detallecompraList,
            vm.compra.impuestoList,
            vm.compra.compra_id,
          );
        } catch (e) {
          return { ok: false, error: 'No se pudo regenerar detallecompraListParaBackend: ' + (e instanceof Error ? e.message : String(e)) };
        }

        scope.$apply();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    { id, detalle },
  );

  if (!inyeccion.ok) {
    let error = inyeccion.error || 'Error al inyectar la modificación.';
    // Diagnóstico estructural: si no se encontró el item, volcamos la lista
    // real del $scope a /data para ver su forma exacta (nunca oculta el error).
    if (/no se encontr[oó] el item/i.test(error)) {
      try {
        const v = await volcarScope(page, {
          nombre: 'modificarCompra',
          marcaVm: 'fnActualizarCompra',
          objetivo: 'compra.detallecompraList',
        });
        if (v.ok && v.path) error += ' Estructura volcada en: ' + v.path;
      } catch {
        /* el volcado es diagnóstico; nunca debe ocultar el error real */
      }
    }
    return { ok: false, error };
  }

  // El botón "Guardar cambios" solo existe tras la previsualización
  // (ng-if="mostrarPrevisualizacionMovimientoCompra"), así que se invoca
  // vm.fnActualizarCompra() directamente: el controlador reconstruye el
  // objEnvio desde el detalle regenerado y muestra el rpAlert de
  // confirmación antes de disparar actualizarCompra.
  await page.evaluate(() => {
    const injector = angular.element(document.body).injector();
    const $rootScope = injector.get('$rootScope');
    let found: any = null;
    (function walk(s: any): void {
      if (found) return;
      if (s.vm && typeof s.vm.fnActualizarCompra === 'function') {
        found = s;
        return;
      }
      let c = s.$$childHead;
      while (c) {
        walk(c);
        c = c.$$nextSibling;
      }
    })($rootScope);
    if (!found) throw new Error('No se encontró editarCompraCtrl para guardar.');
    found.vm.fnActualizarCompra();
  });
  await page.waitForSelector('.swal2-confirm', { timeout: 15000 }).catch(() => {});
  const confirmBtn = await page.$('.swal2-confirm');
  if (confirmBtn) await confirmBtn.click();

  const resp = await endpoint;
  const r = await leerRespuesta(resp);
  // Dejar que el stock se asiente y cerrar el alert de éxito antes de validar.
  await page.waitForTimeout(800).catch(() => {});
  try {
    const okBtn = await page.$('.swal2-confirm');
    if (okBtn) await okBtn.click();
  } catch { /* ignore */ }
  await page.waitForTimeout(400).catch(() => {});
  if (r.json && Number(r.json.tipo) === 1) return { ok: true, id };
  return {
    ok: false,
    error: r.json
      ? JSON.stringify(r.json.mensajes || r.json)
      : 'Sin respuesta de actualizarCompra (HTTP ' + r.status + ').',
  };
}

export async function registrarNotaCredito(
  page: Page,
  compraId: number,
  devoluciones: Array<{ nombre: string; insumoId?: number; cantidad: number }>,
): Promise<ResultadoOperacionE2E> {
  const inyeccion: { ok: boolean; id?: number; error?: string; muestra?: unknown } = await page.evaluate(
    async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const Compra = injector.get('Compra');
        const PARAM = injector.get('PARAM');

        const respCompra = await Compra.obtenerCompra(args.compraId, PARAM.NO);
        if (Number(respCompra.tipo) !== 1 || !respCompra.data) {
          return { ok: false, error: 'No se pudo obtener la compra ' + args.compraId + '.' };
        }
        const compra = respCompra.data.compra;
        const productos = respCompra.data.productos || [];

        // Espejo de utils/deepFind.ts (ver comentario en modificarCompra).
        function idEnNodo(nodo: any, objetivo: number, prof: number, vistos: any[]): boolean {
          if (nodo === null || nodo === undefined) return false;
          const t = typeof nodo;
          if (t === 'number' || t === 'string') {
            const s = String(nodo).trim();
            return s !== '' && !Number.isNaN(Number(s)) && Number(s) === objetivo;
          }
          if (t !== 'object') return false;
          if (prof > 8 || vistos.indexOf(nodo) >= 0) return false;
          vistos.push(nodo);
          try {
            const claves: Array<string | number> = Array.isArray(nodo)
              ? nodo.map((_: unknown, i: number) => i)
              : Object.keys(nodo);
            const esClaveId = (k: string): boolean =>
              /^(item_id|insumo_id|producto_id|presentacioninsumo_id|presentacion_id|detallecompra_id|detalleguia_id)$/i.test(k) ||
              /insumo.*id|id.*insumo/i.test(k);
            for (const k of claves) {
              const ks = String(k);
              if (ks.charAt(0) === '$') continue;
              if (!esClaveId(ks)) continue;
              if (idEnNodo((nodo as any)[k], objetivo, prof + 1, vistos)) return true;
            }
            for (const k of claves) {
              const ks = String(k);
              if (ks.charAt(0) === '$') continue;
              const v = (nodo as any)[k];
              if (v !== null && typeof v === 'object') {
                if (idEnNodo(v, objetivo, prof + 1, vistos)) return true;
              }
            }
            for (const k of claves) {
              const ks = String(k);
              if (ks.toLowerCase() !== 'id') continue;
              if (idEnNodo((nodo as any)[k], objetivo, prof + 1, vistos)) return true;
            }
            return false;
          } finally {
            const i = vistos.indexOf(nodo);
            if (i >= 0) vistos.splice(i, 1);
          }
        }

        function coincide(item: any, d: any): boolean {
          if (d.insumoId != null) {
            const ids = [item.item_id, item.insumo_id];
            if (ids.some((id: any) => id != null && Number(id) === Number(d.insumoId))) return true;
            if (idEnNodo(item, Number(d.insumoId), 0, [])) return true;
          }
          const n = String(d.nombre || '').trim().toLowerCase();
          if (!n) return false;
          const campos = [
            item.item_descripcion,
            item.descripcion,
            item.item_nombre,
            item.insumo_nombre,
            item.insumo && item.insumo.insumo_nombre,
            item.insumo && item.insumo.insumo_descripcion,
            item.insumo && item.insumo.nombre,
            item.item && item.item.insumo_nombre,
            item.producto && item.producto.producto_descripcion,
          ];
          for (const c of campos) {
            if (String(c || '').trim().toLowerCase() === n) return true;
          }
          try {
            if (JSON.stringify(item).toLowerCase().indexOf(n) >= 0) return true;
          } catch {
            /* ignore */
          }
          return false;
        }

        // Proyección segura (solo escalares + claves): evita circularidad sin
        // necesidad de sanitizador dentro del navegador.
        function resumir(x: any): any {
          return {
            claves: x && typeof x === 'object' ? Object.keys(x) : [],
            item_id: x ? x.item_id : undefined,
            insumo_id: x ? x.insumo_id : undefined,
            producto_id: x ? x.producto_id : undefined,
            item_descripcion: x ? x.item_descripcion : undefined,
            item_codigo: x ? x.item_codigo : undefined,
            detallecompra_id: x ? x.detallecompra_id : undefined,
            presentacion_id: x ? x.presentacion_id : undefined,
            almacen_id: x ? x.almacen_id : undefined,
          };
        }

        const detalle = [];
        for (const d of args.devoluciones) {
          const item = productos.find((x: any) => coincide(x, d));
          if (!item) {
            return {
              ok: false,
              error: 'Item no encontrado en la compra: ' + d.nombre,
              muestra: {
                compraId: args.compraId,
                criterio: args.devoluciones,
                totalProductos: productos.length,
                candidatos: productos.slice(0, 3).map(resumir),
              },
            };
          }
          detalle.push({
            detallenotacreditocompra_cantidad: d.cantidad,
            detallenotacreditocompra_montodescuento: 0,
            detallenotacreditocompra_precio: item.item_precio,
            detallecompra_costo: item.item_precio,
            detallecompra_cantidad: item.item_cantidad,
            detallecompra_descuento: item.item_descuento || 0,
            detallecompra_importe: item.item_total,
            detallecompra_id: item.detallecompra_id,
            presentacionactivo_id: null,
            producto_id: item.item_tipo === 2 ? item.item_id : null,
            presentacioninsumo_id: item.item_tipo !== 2 ? item.presentacion_id : null,
            item_descripcion: item.item_descripcion,
            almacen_id: item.almacen_id,
            item_total: item.item_total,
            productoDescontar: d.cantidad > 0 ? PARAM.SI : PARAM.NO,
          });
        }

        const payload = {
          local_id: compra.local_id,
          compra_id: args.compraId,
          notacreditocompra_fecha: compra.compra_fecha,
          notacreditocompra_total: 0,
          notacreditocompra_tipodoc: compra.compra_tipodoc,
          notacreditocompra_numdoc: 'NC-E2E',
          notacreditocompra_seriedoc: '001',
          esPorDescuentoGeneral: PARAM.NO,
          esPorDescuentoEnItems: PARAM.NO,
          compra_tipo: compra.compra_tipo || '1',
          detallenotacreditocompra: detalle,
        };

        const resp = await Compra.registrarNotacreditocompra(payload);
        if (Number(resp.tipo) === 1) return { ok: true, id: resp.data };
        return { ok: false, error: resp && resp.mensajes ? resp.mensajes.join('; ') : 'Sin respuesta de registrarNotacreditocompra.' };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    { compraId, devoluciones },
  );

  if (!inyeccion.ok) {
    let error = inyeccion.error || 'Error al inyectar la nota de crédito.';
    // Diagnóstico estructural: la nota de crédito no navega a ningún vm con
    // lista (todo sale del modelo `Compra`), así que se vuelca la muestra que
    // el navegador ya devolvió, sanitizada y a archivo, sin ensuciar consola.
    if (inyeccion.muestra) {
      try {
        const ruta = await escribirMuestra('notaCredito', inyeccion.muestra);
        error += ' Muestra volcada en: ' + ruta;
      } catch {
        /* el volcado es diagnóstico; nunca debe ocultar el error real */
      }
    }
    return { ok: false, error };
  }
  return { ok: true, id: inyeccion.id != null ? Number(inyeccion.id) : undefined };
}
