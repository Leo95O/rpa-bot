import { Page } from 'playwright';
import { navegar, esperarEndpoint, leerRespuesta } from './bot';
import { volcarScope } from './utils/debugger';

declare const angular: any;
declare const moment: any;

export interface ParamDetalleGuia {
  nombre: string;
  insumoId?: number;
  cantidad: number;
  precio: number;
  presentacion?: string;
}

export interface ParamGuia {
  serie: string;
  numero: string;
  vehiculo?: string;
  partida?: string;
  llegada?: string;
  proveedor?: string;
  local?: string;
  moneda?: string;
  almacen?: string;
  detalle: ParamDetalleGuia[];
  /** Canje guía→OC (GuiaLogistica:178-180 copia a listaOrdenesCompra). */
  ordencompraList?: number[];
}

export interface ResultadoOperacionE2E {
  ok: boolean;
  id?: number;
  error?: string;
}

export async function registrarGuia(page: Page, p: ParamGuia): Promise<ResultadoOperacionE2E> {
  await navegar(page, 'logistica.guiacompra.nuevaguia');
  await esperarGuiaLista(page);

  const endpoint = esperarEndpoint(page, 'guiacompra/guardarGuia', 60000).catch(() => null);

  const inyeccion = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const $rootScope = injector.get('$rootScope');
      const CommonCollection = injector.get('CommonCollection');
      const PARAM = injector.get('PARAM');
      const SecurityService = injector.get('SecurityService');

      function encontrarScope() {
        let found: any = null;
        (function walk(s: any): void {
          if (found) return;
          if (s.vm && s.vm.guia && typeof s.vm.guia.agregar === 'function') {
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

      const scope = encontrarScope();
      if (!scope) return { ok: false, error: 'No se encontró nuevaGuiaCompraCtrl (vm.guia.agregar).' };
      const vm = scope.vm;

      // proveedor
      const respProv = await CommonCollection.obtenerProveedorPorBusqueda(
        args.proveedor || 'GRUPO SEVEN SEAS SAC',
      );
      if (!respProv || !respProv.data || !respProv.data.length) {
        return { ok: false, error: 'Proveedor no encontrado.' };
      }
      vm.guia.proveedorSeleccionado = respProv.data[0];

      // local
      const respLocales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(
        SecurityService.getUsuarioId(),
      );
      const locales = (respLocales && respLocales.data) || [];
      // Espejo de bot.ts (registrarCompra): el backend devuelve el nombre del
      // local en UTF-8 leído como Latin-1 ("CD LogÃ­stico"). Se re-decodifica
      // antes de comparar y, si no hay coincidencia, se usa el local de la
      // sesión. Mantener sincronizado con bot.ts.
      const fixMojibake = (s: any): string => {
        const str = String(s || '');
        if (!str.includes('Ã')) return str;
        try {
          const bytes = new Uint8Array(str.length);
          for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
          return new TextDecoder('utf-8').decode(bytes);
        } catch {
          return str;
        }
      };
      const norm = (s: any): string =>
        fixMojibake(s).normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase();
      const local = locales.find(
        (l: any) => norm(l.local_descripcion || l.local_nombre) === norm(args.local || 'CD Logistico'),
      );
      if (!local) return { ok: false, error: 'Local no encontrado: ' + (args.local || 'CD Logistico') };
      vm.guia.localSeleccionado = local;
      vm.guia.local_id = local.local_id;
      vm.fnCambioLocal(local);
      await new Promise((res) => setTimeout(res, 500));

      // moneda
      const respMon = await CommonCollection.obtenerListaMonedasPorLocal(local.local_id);
      const monedas = (respMon && respMon.data) || [];
      const moneda =
        monedas.find((m: any) => (m.moneda_descripcion || m.moneda_simbolo) === (args.moneda || 'Soles')) ||
        monedas[0];
      if (!moneda) return { ok: false, error: 'Moneda no encontrada.' };
      vm.guia.monedaSeleccionada = moneda;
      vm.guia.moneda_id = moneda.moneda_id;

      // almacenes (fnCambioLocal los carga asíncronamente; esperar y usar lo que ya tenga el controlador)
      const inicio = Date.now();
      while (Date.now() - inicio < 10000) {
        if (vm.guia.almacenList && vm.guia.almacenList.length > 0) break;
        await new Promise((res) => setTimeout(res, 200));
      }
      let almacenes = (vm.guia.almacenList && vm.guia.almacenList.length) ? vm.guia.almacenList : [];
      let almacen =
        almacenes.find((a: any) => a.almacen_descripcion === (args.almacen || 'Almacen Principal')) ||
        vm.guia.almacenSeleccionado ||
        almacenes[0];
      if (!almacen) {
        const respAlm = await CommonCollection.obtenerAlmacenListPorLocal(
          local.local_id,
          PARAM.ESTADO.ACTIVO,
          PARAM.ESTADO.INACTIVO,
          PARAM.ESTADO.INACTIVO,
        );
        almacenes = (respAlm && respAlm.data) || [];
        almacen =
          almacenes.find((a: any) => a.almacen_descripcion === (args.almacen || 'Almacen Principal')) ||
          almacenes[0];
      }
      if (!almacen) return { ok: false, error: 'Almacén no encontrado.' };
      vm.guia.almacenSeleccionado = almacen;
      vm.guia.almacenList = almacenes;

      // cabecera
      vm.guia.guia_serie = args.serie;
      vm.guia.guia_numeroguia = args.numero + '-' + Date.now();
      vm.guia.guia_partida = args.partida || '';
      vm.guia.guia_llegada = args.llegada || '';
      vm.guia.guia_vehiculo = args.vehiculo || '';

      // detalle
      const detalle = [];
      for (const d of args.detalle) {
        const respBusq = await CommonCollection.busquedaSensitivaSegunTipos(
          d.nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local.local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = (respBusq && respBusq.data) || [];
        const item = lista.find(
          (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(d.nombre).trim().toLowerCase(),
        );
        if (!item) return { ok: false, error: 'Item no encontrado: ' + d.nombre };

        let presentacion_id = item.presentacion_id || item.item_presentacionid || null;
        let presentacion_nombre = '';
        let presentacioninsumo_cantidad = 1;
        if (item.presentacionList && item.presentacionList.length) {
          const pres =
            (d.presentacion && item.presentacionList.find((pp: any) => pp.presentacion_nombre === d.presentacion)) ||
            item.presentacionList[0];
          presentacion_id = pres.presentacion_id;
          presentacion_nombre = pres.presentacion_nombre;
          presentacioninsumo_cantidad = pres.presentacion_cantidad || pres.presentacioninsumo_cantidad || 1;
        }

        detalle.push({
          item_id: item.item_id,
          item_tipo: item.item_tipo,
          item_descripcion: item.item_descripcion,
          item_codigo: item.item_codigo,
          item_cantidad: d.cantidad,
          item_precio: d.precio,
          item_descuento: 0,
          item_total: d.cantidad * d.precio,
          item_afectoigv: true,
          unidadmedidainsumo_id: item.unidadmedidainsumo_id || null,
          unidadmedidainsumo: item.unidadmedidainsumo || null,
          presentacion_id,
          presentacion_nombre,
          presentacioninsumo_cantidad,
          almacen,
          almacen_id: almacen.almacen_id,
        });
      }

      vm.guia.detalleguiaList = detalle;
      scope.$apply();

      const guiaNueva = angular.copy(vm.guia);
      if (args.ordencompraList) guiaNueva.ordencompraList = args.ordencompraList;
      guiaNueva.guia_fechaemision = moment().format('YYYY-MM-DD HH:mm:ss');
      guiaNueva.proveedor_id = vm.guia.proveedorSeleccionado.proveedor_id;
      guiaNueva.moneda_id = vm.guia.monedaSeleccionada.moneda_id;
      guiaNueva.local_id = vm.guia.local_id;

      const productos = vm.guia.obtenerFormatoDetalleGuiaBackend(vm.guia.detalleguiaList, vm.guia.guia_id);

      const objEnvio = {
        guia: guiaNueva,
        productos,
        movimientoEmulacionGuiaList: vm.emulacionMovimiento ? vm.emulacionMovimiento.movimientos : undefined,
      };

      vm.guia.agregar(objEnvio);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, p as any);

  if (!inyeccion.ok) return { ok: false, error: inyeccion.error };

  const resp = await endpoint;
  const r = await leerRespuesta(resp);
  if (r.json && Number(r.json.tipo) === 1) return { ok: true, id: r.json.data };
  return {
    ok: false,
    error: r.json
      ? JSON.stringify(r.json.mensajes || r.json)
      : 'Sin respuesta de guardarGuia (HTTP ' + r.status + ').',
  };
}

export async function consultarGuia(page: Page, id: number): Promise<{ ok: boolean; data?: any; error?: string }> {
  return page.evaluate(async (id) => {
    try {
      const injector = angular.element(document.body).injector();
      const Guia = injector.get('Guia');
      const resp = await Guia.obtenerGuia(id);
      return { ok: Number(resp.tipo) === 1, data: resp.data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, id);
}

export async function anularGuia(
  page: Page,
  id: number,
  devolverStock: boolean,
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const Guia = injector.get('Guia');
      const PARAM = injector.get('PARAM');
      const resp = await Guia.anulaGuia(args.id, args.devolverStock ? PARAM.SI : PARAM.NO);
      if (Number(resp.tipo) === 1) return { ok: true };
      return { ok: false, error: resp && resp.mensajes ? resp.mensajes.join('; ') : 'Sin respuesta de anularGuia.' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { id, devolverStock });
}

export async function modificarGuia(
  page: Page,
  id: number,
  detalle: ParamDetalleGuia[],
): Promise<ResultadoOperacionE2E> {
  await navegar(page, 'logistica.guiacompra.editarguia', { idGuia: id });
  const endpoint = esperarEndpoint(page, 'guiacompra/actualizarGuia', 60000).catch(() => null);

  const inyeccion = await page.evaluate(async (args) => {
    try {
      const injector = angular.element(document.body).injector();
      const $rootScope = injector.get('$rootScope');

      function encontrarScope() {
        let found: any = null;
        (function walk(s: any): void {
          if (found) return;
          if (s.vm && s.vm.guia && typeof s.vm.fnobtenerGuia === 'function') {
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
      if (!scope) return { ok: false, error: 'No se encontró editarGuiaCompraCtrl.' };
      const vm = scope.vm;

      // Igual que en modificarCompra: la directiva HandsOnTable pre-puebla
      // `detalleguiaList` con filas vacías antes de que `fnobtenerGuia`
      // resuelva los `productos`, así que esperamos una fila con datos reales.
      const inicio = Date.now();
      let detalleListo = false;
      while (Date.now() - inicio < 20000) {
        const lista = vm.guia && vm.guia.detalleguiaList;
        if (lista && lista.some((x: any) => x && (x.item_id || x.item_descripcion))) {
          detalleListo = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      if (!vm.guia || !vm.guia.detalleguiaList) {
        return { ok: false, error: 'La guía no se cargó para edición.' };
      }
      if (!detalleListo) {
        return { ok: false, error: 'El detalle de la guía cargó sin datos de ítems.' };
      }

      for (const d of args.detalle) {
        const fila = vm.guia.detalleguiaList.find((x: any) => coincide(x, d));
        if (!fila) return { ok: false, error: 'Item no encontrado en la guía: ' + d.nombre };
        fila.item_cantidad = d.cantidad;
        fila.item_precio = d.precio;
        fila.item_total = d.cantidad * d.precio;
      }
      scope.$apply();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, { id, detalle });

  if (!inyeccion.ok) {
    let error = inyeccion.error || 'Error al inyectar la modificación de guía.';
    // Diagnóstico estructural: vuelca la lista real del $scope a /data para
    // ver el anidamiento exacto del item (nunca oculta el error original).
    if (/no se encontr[oó].*tem|no se encontr[oó].*gu[ií]a/i.test(error)) {
      try {
        const v = await volcarScope(page, {
          nombre: 'modificarGuia',
          marcaVm: 'fnobtenerGuia',
          objetivo: 'guia.detalleguiaList',
        });
        if (v.ok && v.path) error += ' Estructura volcada en: ' + v.path;
      } catch {
        /* el volcado es diagnóstico; nunca debe ocultar el error real */
      }
    }
    return { ok: false, error };
  }

  // Continuar (procesarDatosGuia) para mostrar la previsualización
  await page.locator('button[ng-click="vm.procesarDatosGuia()"]').first().click();
  await page.waitForSelector('button[ng-click="vm.fnActualizarGuia()"]', { timeout: 30000 });

  // Editar guía (guardar) mediante click CSS, en lugar de invocar vm.fnActualizarGuia()
  await page.locator('button[ng-click="vm.fnActualizarGuia()"]').first().click();

  // Confirmar el diálogo de confirmación (rpAlert/SweetAlert2)
  await page.waitForSelector('.swal2-confirm', { timeout: 10000 }).catch(() => {});
  const confirmBtn = await page.$('.swal2-confirm');
  if (confirmBtn) await confirmBtn.click();

  const resp = await endpoint;
  const r = await leerRespuesta(resp);
  if (r.json && Number(r.json.tipo) === 1) return { ok: true, id };
  return {
    ok: false,
    error: r.json
      ? JSON.stringify(r.json.mensajes || r.json)
      : 'Sin respuesta de actualizarGuia (HTTP ' + r.status + ').',
  };
}

async function esperarGuiaLista(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        let encontrado = false;
        (function walk(s: any): void {
          if (encontrado) return;
          if (s.vm && s.vm.guia && typeof s.vm.guia.agregar === 'function') {
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
}
