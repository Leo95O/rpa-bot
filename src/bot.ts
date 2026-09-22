import { chromium, Browser, Page, Response } from 'playwright';
import { InsumoAgrupado, CompraAgrupada, ResultadoOperacion } from './types';
import { buscarInsumo } from './kardex';

declare const angular: any;
declare const moment: any;

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:9001';

const STATE_INSUMO_NUEVO = 'logistica.insumos.nuevo';
const STATE_COMPRA_NUEVA = 'logistica.compra.nuevacompra';

const HTTP_SUCCESS = 1;

export async function conectarNavegador(): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(CDP_ENDPOINT);
  } catch (e) {
    if (e instanceof Error && e.message.includes('ECONNREFUSED')) {
      console.error('Asegúrate de cerrar todos los procesos de Chrome y abrirlo con: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-temp"');
    }
    throw e;
  }
}

export async function obtenerPaginaApp(browser: Browser): Promise<Page> {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try {
        const url = p.url();
        if (url.startsWith(APP_BASE_URL) || url.includes('#')) return p;
      } catch {
        /* pestaña cerrada */
      }
    }
  }
  const primerContexto = browser.contexts()[0];
  const paginas = primerContexto ? primerContexto.pages() : [];
  if (paginas.length === 0) throw new Error('No hay pestañas abiertas en el Chrome conectado.');
  return paginas[0];
}

export async function ejecutarInsumos(page: Page, insumos: InsumoAgrupado[]): Promise<ResultadoOperacion[]> {
  const resultados: ResultadoOperacion[] = [];
  for (const insumo of insumos) {
    try {
      const r = await registrarInsumo(page, insumo);
      resultados.push(r);
    } catch (e) {
      resultados.push({
        ok: false,
        idOperacion: insumo.idOperacion,
        tipo: 'insumo',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return resultados;
}

export async function ejecutarCompras(page: Page, compras: CompraAgrupada[]): Promise<ResultadoOperacion[]> {
  const resultados: ResultadoOperacion[] = [];
  for (const compra of compras) {
    try {
      const r = await registrarCompra(page, compra);
      resultados.push(r);
    } catch (e) {
      resultados.push({
        ok: false,
        idOperacion: compra.idOperacion,
        tipo: 'compra',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return resultados;
}

export async function registrarInsumo(page: Page, insumo: InsumoAgrupado): Promise<ResultadoOperacion> {
  await navegar(page, STATE_INSUMO_NUEVO);
  await esperarInsumoListo(page);

  const registrar = esperarEndpoint(page, 'producto/insumo/registrarInsumo').catch(() => null);
  const aperturar = esperarEndpoint(page, 'producto/insumo/aperturarStock').catch(() => null);

  const inyeccion = await page.evaluate(async (grupo: InsumoAgrupado) => {
    try {
      const injector = angular.element(document.body).injector();
      const $rootScope = injector.get('$rootScope');
      const CommonCollection = injector.get('CommonCollection');

      function encontrarScope() {
        let found: any = null;
        (function walk(s: any): void {
          if (found) return;
          if (s.vm && typeof s.vm.registrarInsumo === 'function') {
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
      if (!scope) return { ok: false, error: 'No se encontró el controller nuevoCtrl (vm.registrarInsumo).' };
      const vm = scope.vm;
      const cab = grupo.cabecera;

      const um = vm.listaUnidadesMedida.find(
        (u: any) => u.unidadmedidainsumo_descripcion === cab.unidadMedida,
      );
      if (!um) return { ok: false, error: 'Unidad de medida no encontrada: ' + cab.unidadMedida };

      const cat = vm.listaCategoriainsumo.find(
        (c: any) => c.categoriainsumo_descripcion === cab.categoria,
      );
      if (!cat) return { ok: false, error: 'Categoría no encontrada: ' + cab.categoria };

      let proveedorSeleccionado: any = null;
      if (cab.proveedor) {
        const resp = await CommonCollection.obtenerProveedorPorBusqueda(cab.proveedor);
        if (resp.tipo !== 1 || !resp.data || !resp.data.length) {
          return { ok: false, error: 'Proveedor no encontrado: ' + cab.proveedor };
        }
        proveedorSeleccionado = resp.data[0];
      }

      const presentaciones: any[] = grupo.presentaciones.map((p) => {
        const pum = vm.listaUnidadesMedida.find(
          (u: any) => u.unidadmedidainsumo_descripcion === p.unidadMedida,
        );
        if (!pum) throw new Error('UM de presentación no encontrada: ' + p.unidadMedida);
        return {
          presentacioninsumo_nombre: p.nombre,
          presentacioninsumo_cantidad: p.cantidad,
          unidadmedidainsumo_descripcion: p.unidadMedida,
          unidadmedidainsumo_id: pum.unidadmedidainsumo_id,
          presentacioninsumo_precioaproximado: p.costo,
          presentacioninsumo_preciominimo: p.precioMinimo,
          presentacioninsumo_preciomaximo: p.precioMaximo,
          presentacioninsumo_agruparstock: p.unidadControl,
          seusaparaventa: p.seVende,
          presentacioninsumo_precioventa: p.precioVenta,
          esEstandar: p.esEstandar,
          buscar: p.activa,
          presentacioninsumo_unidadmedida: p.unidadMedida,
        };
      });
      presentaciones.push({});

      grupo.inventario.forEach((inv) => {
        const alm = vm.insumo.almacenes.find(
          (a: any) =>
            a.almacen_descripcion === inv.almacen || String(a.almacen_id) === String(inv.almacen),
        );
        if (!alm) throw new Error('Almacén no encontrado: ' + inv.almacen);
        alm.almacen_controlar = inv.controlarStock;
        alm.inventario_cantidad = inv.stockApertura;
        alm.costoApertura = inv.costoApertura;
        alm.stockMinimo = inv.stockMinimo;
        alm.stockMaximo = inv.stockMaximo;
      });

      vm.insumo.insumo_codigo = cab.codigo;
      vm.insumo.insumo_codigointerno = cab.codigoInterno;
      vm.insumo.insumo_nombre = cab.nombre;
      vm.insumo.unidadMedidaSeleccionada = um;
      vm.insumo.unidadmedidainsumo_id = um.unidadmedidainsumo_id;
      vm.insumo.categoriaSeleccionada = cat;
      vm.insumo.categoriainsumo_id = cat.categoriainsumo_id;
      vm.insumo.insumo_porcentajeventa = cab.margenGanancia;
      vm.insumo.insumo_mermaporcentaje = cab.mermaCompra;
      vm.insumo.permiteConversion = cab.permiteConversion ? '1' : '0';

      if (cab.clasificacionAbc) {
        const mapa: Record<string, string> = { A: '1', B: '2', C: '3' };
        const letra = cab.clasificacionAbc.toUpperCase();
        vm.insumo.clasificacionabcSelected = { id: mapa[letra], value: 'Clasificacion ' + letra };
      }

      if (proveedorSeleccionado) vm.proveedorSeleccionado = proveedorSeleccionado;
      else vm.proveedorSeleccionado = null;

      vm.insumo.presentaciones = presentaciones;

      if (cab.permiteConversion && grupo.equivalencia) {
        const equm = (vm.listaUnidadesEquivalencia || vm.listaUnidadesMedida).find(
          (u: any) => u.unidadmedidainsumo_descripcion === grupo.equivalencia!.unidadMedida,
        );
        if (!equm) return { ok: false, error: 'UM de equivalencia no encontrada: ' + grupo.equivalencia!.unidadMedida };
        vm.insumo.insumoequivalencia = {
          insumoequivalencia_cantidad: grupo.equivalencia!.cantidad,
          unidadmedidainsumo_id: equm.unidadmedidainsumo_id,
        };
      } else {
        vm.insumo.insumoequivalencia = null;
      }

      try {
        vm.heredarImpuestoCompraSegunCategoriaSelecciona(cat.categoriainsumo_id);
      } catch {
        /* el $timeout interno puede fallar si el HOT aún no está listo; no es bloqueante */
      }

      if (cab.impuestos && cab.impuestos.length) {
        (vm.insumo.impuestosCompraList || []).forEach((imp: any) => {
          const marcado = cab.impuestos.indexOf(imp.impuestocompra_nombre) >= 0;
          imp.seleccionado = marcado ? '1' : '0';
          imp.impuestocompra_seleccionado = marcado;
        });
      }

      scope.$apply();
      vm.registrarInsumo();
      return { ok: true, presentaciones: presentaciones.length - 1 };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      };
    }
  }, insumo);

  if (!inyeccion.ok) {
    return {
      ok: false,
      idOperacion: insumo.idOperacion,
      tipo: 'insumo',
      error: inyeccion.error || 'Error al inyectar el insumo.',
    };
  }

  const respRegistrar = await registrar;
  const rRegistrar = await leerRespuesta(respRegistrar);
  const bodyRegistrar = rRegistrar.json;

  if (bodyRegistrar && Number(bodyRegistrar.tipo) === HTTP_SUCCESS) {
    const respAperturar = await aperturar;
    await leerJson(respAperturar);
    return {
      ok: true,
      idOperacion: insumo.idOperacion,
      tipo: 'insumo',
      detalle: 'Insumo ' + insumo.cabecera.nombre + ' registrado (id=' + bodyRegistrar.data + ').',
      idGenerado: Number(bodyRegistrar.data),
    };
  }

  return {
    ok: false,
    idOperacion: insumo.idOperacion,
    tipo: 'insumo',
    error: bodyRegistrar
      ? 'Backend: ' + JSON.stringify(bodyRegistrar.mensajes || bodyRegistrar)
      : detalleErrorEndpoint(rRegistrar, 'registrarInsumo'),
  };
}

export async function registrarCompra(page: Page, compra: CompraAgrupada): Promise<ResultadoOperacion> {
  await navegar(page, STATE_COMPRA_NUEVA);
  await esperarCompraLista(page);

  const agregar = esperarEndpoint(page, 'compra/agregarCompra', 300000).catch(() => null);

  const inyeccion = await page.evaluate(async (grupo: CompraAgrupada) => {
    try {
      const injector = angular.element(document.body).injector();
      const $rootScope = injector.get('$rootScope');
      const CommonCollection = injector.get('CommonCollection');
      const SecurityService = injector.get('SecurityService');
      const PARAM = injector.get('PARAM');
      const Insumo = injector.get('Insumo');

      function encontrarScope() {
        let found: any = null;
        (function walk(s: any): void {
          if (found) return;
          if (s.vm && typeof s.vm.procesarDatosCompra === 'function') {
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

      async function esperar(predicado: () => boolean, ms: number) {
        const inicio = Date.now();
        while (Date.now() - inicio < ms) {
          if (predicado()) return;
          await new Promise((res) => setTimeout(res, 100));
        }
        throw new Error('Timeout esperando que se carguen los datos del local.');
      }

      function resolverAlmacen(nombre: string) {
        const alm = vm.compra.almacenList.find(
          (a: any) => a.almacen_descripcion === nombre || String(a.almacen_id) === String(nombre),
        );
        if (!alm) throw new Error('Almacén no encontrado: ' + nombre);
        return { almacen_id: alm.almacen_id, almacen_descripcion: alm.almacen_descripcion };
      }

      async function resolverItem(d: any, almacen: any) {
        let src: any = null;
        if (d.itemCodigo) {
          const lista = await vm.busquedaParaComprasCodigo(d.itemCodigo);
          src = lista && lista.length ? lista[0] : null;
        }
        if (!src && d.itemNombre) {
          const lista = await vm.busquedaParaCompras(d.itemNombre);
          src = lista && lista.length ? lista[0] : null;
        }
        if (!src) {
          throw new Error(
            'Item no encontrado (código="' + d.itemCodigo + '", nombre="' + d.itemNombre + '").',
          );
        }

        const umObj = src.unidadmedidainsumo || null;
        const unidadmedidainsumo_id =
          (umObj && umObj.unidadmedidainsumo_id) || src.unidadmedidainsumo_id || null;
        const unidadmedidainsumo =
          (umObj && umObj.unidadmedidainsumo_descripcion) || src.unidadmedidainsumo_descripcion || '';

        let presentacion = null;
        if (src.presentacionList && src.presentacionList.length) {
          if (d.presentacion) {
            presentacion = src.presentacionList.find(
              (p: any) => p.presentacion_nombre === d.presentacion,
            );
          }
          if (!presentacion) {
            presentacion =
              src.presentacionList.find((p: any) => p.presentacion_id === src.item_presentacionid) ||
              src.presentacionList[0];
          }
        }

        // La búsqueda (parseBusquedaSensitiva) NO devuelve `presentacionList`;
        // entrega `item_presentacionid` / `item_presentacion` (presentación por
        // defecto). Sin esta resolución, `presentacioninsumo_id` queda NULL y el
        // backend no afecta stock ni expone item_id en obtenerCompra.
        if (!presentacion && src.item_presentacionid) {
          presentacion = {
            presentacion_id: src.item_presentacionid,
            presentacion_nombre: src.item_presentacion || '',
            presentacioninsumo_cantidad: 1,
          };
        }

        // Presentación concreta por nombre (ej. "Caja de 24"): la búsqueda solo
        // trae la de por defecto, así que se consulta la lista del insumo.
        if (d.presentacion && src.item_id) {
          try {
            const det = await Insumo.obtenerInsumoDetallado(src.item_id, 0, 0);
            const pres = (det && det.data && det.data.listaPresentaciones) || [];
            const encontrada = pres.find(
              (p: any) => (p.presentacioninsumo_nombre || p.presentacion_nombre) === d.presentacion,
            );
            if (encontrada) {
              presentacion = {
                presentacion_id: encontrada.presentacioninsumo_id,
                presentacion_nombre: encontrada.presentacioninsumo_nombre || d.presentacion,
                presentacioninsumo_cantidad: encontrada.presentacioninsumo_cantidad || 1,
              };
            }
          } catch {
            /* usa la presentación por defecto ya resuelta */
          }
        }

        return {
          item_id: src.item_id,
          item_tipo: src.item_tipo,
          item_subtipo: src.item_subtipo,
          item_codigo: src.item_codigo,
          item_descripcion: src.item_descripcion,
          item_cantidad: d.cantidad,
          item_precio: d.precio,
          item_descuento: d.descuento || 0,
          item_total: (d.precio || 0) * (d.cantidad || 1),
          item_afectoigv: d.afectoIgv,
          item_fecha: d.fechaCaducidad || '',
          item_numlote: d.numLote || '',
          item_descripcionlote: '',
          unidadmedidainsumo,
          unidadmedidainsumo_id,
          presentacion_id: presentacion ? presentacion.presentacion_id : null,
          presentacion_nombre: presentacion ? presentacion.presentacion_nombre : null,
          presentacioninsumo_cantidad: presentacion
            ? presentacion.presentacion_cantidad || presentacion.presentacioninsumo_cantidad || 1
            : null,
          almacen,
          impuestocompraproductogeneralinsumoList: src.impuestocompraproductogeneralinsumoList || null,
        };
      }

      const scope = encontrarScope();
      if (!scope) return { ok: false, error: 'No se encontró nuevaCompraCtrl (vm.procesarDatosCompra).' };
      const vm = scope.vm;
      const cab = grupo.cabecera;

      const respProveedor = await CommonCollection.obtenerProveedorPorBusqueda(cab.proveedor);
      if (respProveedor.tipo !== 1 || !respProveedor.data || !respProveedor.data.length) {
        return { ok: false, error: 'Proveedor no encontrado: ' + cab.proveedor };
      }
      const proveedorId = respProveedor.data[0].proveedor_id;
      vm.compra.proveedorSeleccionado = respProveedor.data[0];
      let localId: any = null;
      let monedaId: any = null;

      if (cab.local) {
        const respLocales = await CommonCollection.obtenerLocalesPermitidosParaUsuarioID(
          SecurityService.getUsuarioId(),
        );
        const locales = respLocales.data || [];
        const local = locales.find(
          (l: any) => (l.local_descripcion || l.local_nombre) === cab.local,
        );
        if (!local) return { ok: false, error: 'Local no encontrado: ' + cab.local };
        localId = local.local_id;
        vm.fnCambioLocal(local);
        await esperar(
          () =>
            vm.compra.monedaList &&
            vm.compra.monedaList.length > 0 &&
            vm.compra.almacenList &&
            vm.compra.almacenList.length > 0 &&
            vm.compra.impuestoList &&
            vm.compra.impuestoList.length > 0,
          20000,
        );
      }

      if (cab.moneda) {
        const moneda = vm.compra.monedaList.find(
          (m: any) =>
            (m.moneda_descripcion || m.moneda_nombre || m.moneda_simbolo) === cab.moneda,
        );
        if (!moneda) return { ok: false, error: 'Moneda no encontrada: ' + cab.moneda };
        monedaId = moneda.moneda_id;
        vm.compra.monedaSeleccionada = moneda;
        vm.compra.moneda_id = moneda.moneda_id;
        vm.compra.compra_tipocambio = moneda.moneda_tipocambio_compra;
      }

      const respComprobantes = await CommonCollection.obtenerComprobantesDeCompraPorEstado(
        PARAM.ESTADO.ACTIVO,
        PARAM.TODOS,
      );
      const comprobantes: any[] = respComprobantes.data || [];
      let comprobante = comprobantes.find(
        (c: any) => c.comprobantecompra_descripcion === cab.tipoComprobante,
      );
      if (!comprobante && cab.tipoComprobante === 'Sin comprobante') {
        comprobante = { comprobantecompra_id: -1, comprobantecompra_descripcion: 'Sin comprobante' };
      }
      if (!comprobante) {
        return { ok: false, error: 'Comprobante no encontrado: ' + cab.tipoComprobante };
      }
      vm.compra.comprobante = comprobante;
      vm.compra.compra_tipodoc = comprobante.comprobantecompra_descripcion;

      if (cab.almacen) {
        const alm = resolverAlmacen(cab.almacen);
        vm.compra.almacenSeleccionado = vm.compra.almacenList.find(
          (a: any) => a.almacen_id === alm.almacen_id,
        );
        vm.almacen_id = alm.almacen_id;
      } else if (vm.compra.almacenList && vm.compra.almacenList.length) {
        vm.compra.almacenSeleccionado = vm.compra.almacenList[0];
        vm.almacen_id = vm.compra.almacenList[0].almacen_id;
      }

      vm.compra.compra_seriedoc = cab.serie;
      vm.compra.compra_nrodoc = cab.numero;
      vm.compra.compra_id = null;
      vm.compra.detallecompra_id = null;
      vm.compra.fechaDeCompra = { date: moment(cab.fechaCompra || undefined), options: vm.optionsFecha };
      vm.compra.fechaDeTributacion = {
        date: moment(cab.fechaTributacion || cab.fechaCompra || undefined),
        options: vm.optionsFechaTributacion,
      };
      vm.compra.compra_observacionpago = cab.notas || '';
      vm.compra.losImpuestosEstanIncluidosEnElPrecio = cab.impuestosIncluidos ? '1' : '0';
      vm.compra.compra_descuento = cab.descuentoGlobal || 0;

      const almacenDefault = vm.compra.almacenSeleccionado || null;
      const filas: any[] = [];
      for (const d of grupo.detalle) {
        const almacenItem = d.almacen
          ? resolverAlmacen(d.almacen)
          : almacenDefault
            ? { almacen_id: almacenDefault.almacen_id, almacen_descripcion: almacenDefault.almacen_descripcion }
            : null;
        if (!almacenItem) throw new Error('No hay almacén disponible para el detalle.');
        filas.push(await resolverItem(d, almacenItem));
      }

      vm.compra.detallecompraList = filas;
      vm.removeItemList = [];

      const almacenId = vm.almacen_id;

      scope.$apply();

      await vm.procesarDatosCompra(true);

      if (!vm.compra.detallecompraListParaBackend || !vm.compra.detallecompraListParaBackend.length) {
        return { ok: false, error: 'No se generó detallecompraListParaBackend.' };
      }

      const compraNueva = angular.copy(vm.compra);
      compraNueva.compra_fecha = moment(cab.fechaCompra || undefined).format('YYYY-MM-DD HH:mm:ss');
      compraNueva.compra_fechatributacion = moment(cab.fechaTributacion || cab.fechaCompra || undefined).format('YYYY-MM-DD HH:mm:ss');
      compraNueva.proveedor_id = proveedorId;
      compraNueva.moneda_id = monedaId;
      compraNueva.local_id = localId;
      compraNueva.almacen_id = almacenId;
      compraNueva.compra_generoimpuestossobretotal = cab.impuestosIncluidos ? '0' : '1';
      compraNueva.listaImpuestosDeCompra = vm.compra.impuestoList;

      // Inyección de estado forzado (ver EstadoForzadoCompra en compras.ts).
      // Se aplica AL FINAL para que tenga precedencia sobre lo resuelto del
      // $scope (proveedor/moneda/local/almacén). Los nombres de campo quedan
      // pendientes de verificación visual contra la vista real; si el backend
      // rechaza un campo desconocido, renombrarlo o moverlo a `extra`.
      const extra = ((cab as any).extra || {}) as Record<string, unknown>;
      for (const k of Object.keys(extra)) {
        (compraNueva as any)[k] = extra[k];
      }

      const objEnvio = {
        compra: compraNueva,
        productos: vm.compra.detallecompraListParaBackend,
        movimientoEmulacionCompraList: vm.emulacionMovimiento ? vm.emulacionMovimiento.movimientos : undefined,
        avancecompra_id: vm.avancecompra_id,
      };

      vm.compra.agregar(objEnvio);
      return { ok: true, detalle: filas.length, total: vm.compra.compra_total };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      };
    }
  }, compra);

  if (!inyeccion.ok) {
    return {
      ok: false,
      idOperacion: compra.idOperacion,
      tipo: 'compra',
      error: inyeccion.error || 'Error al inyectar la compra.',
    };
  }

  const respAgregar = await agregar;
  const rAgregar = await leerRespuesta(respAgregar);
  const bodyAgregar = rAgregar.json;

  if (bodyAgregar && Number(bodyAgregar.tipo) === HTTP_SUCCESS) {
    return {
      ok: true,
      idOperacion: compra.idOperacion,
      tipo: 'compra',
      detalle: 'Compra ' + compra.cabecera.serie + '-' + compra.cabecera.numero + ' registrada.',
      idGenerado: Number(bodyAgregar.data),
    };
  }

  return {
    ok: false,
    idOperacion: compra.idOperacion,
    tipo: 'compra',
    error: bodyAgregar
      ? 'Backend: ' + JSON.stringify(bodyAgregar.mensajes || bodyAgregar)
      : detalleErrorEndpoint(rAgregar, 'agregarCompra'),
  };
}

export async function navegar(page: Page, estado: string, params?: Record<string, any>): Promise<void> {
  await page.evaluate((args) => {
    const injector = angular.element(document.body).injector();
    injector.get('$state').go(args.estado, args.params);
  }, { estado, params });
}

export async function esperarInsumoListo(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        let encontrado = false;
        (function walk(s: any): void {
          if (encontrado) return;
          if (
            s.vm &&
            typeof s.vm.registrarInsumo === 'function' &&
            s.vm.listaUnidadesMedida &&
            s.vm.listaUnidadesMedida.length > 0 &&
            s.vm.listaCategoriainsumo &&
            s.vm.listaCategoriainsumo.length > 0 &&
            s.vm.insumo &&
            Array.isArray(s.vm.insumo.almacenes) &&
            s.vm.insumo.almacenes.length > 0
          ) {
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
    { timeout: 60000 },
  );
}

export async function esperarCompraLista(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        let encontrado = false;
        (function walk(s: any): void {
          if (encontrado) return;
          if (
            s.vm &&
            typeof s.vm.procesarDatosCompra === 'function' &&
            s.vm.compra
          ) {
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
    { timeout: 60000 },
  );
}

export function esperarEndpoint(page: Page, urlPart: string, timeoutMs = 90000): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(urlPart),
    { timeout: timeoutMs },
  );
}

export async function leerJson(resp: Response | null): Promise<any> {
  if (!resp) return null;
  const r = await leerRespuesta(resp);
  return r.json;
}

export async function leerRespuesta(resp: Response | null): Promise<{ json: any; status: number; texto: string }> {
  if (!resp) return { json: null, status: 0, texto: '' };
  const status = resp.status();
  let texto = '';
  try {
    texto = await resp.text();
  } catch {
    texto = '';
  }
  let json: any = null;
  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
  }
  return { json, status, texto };
}

export function detalleErrorEndpoint(r: { json: any; status: number; texto: string }, nombre: string): string {
  if (r.status) {
    const limpio = r.texto.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return 'Endpoint ' + nombre + ' respondió HTTP ' + r.status + ': ' + limpio.slice(0, 2000);
  }
  return 'Sin respuesta del endpoint ' + nombre + ' (timeout).';
}

export interface ParamCrearInsumo {
  nombre: string;
  codigo?: string;
  unidadMedida?: string;
  categoria?: string;
  proveedor?: string;
  stockApertura: number;
  costoApertura: number;
  almacen?: string;
  mermaCompra?: number;
  equivalencia?: { cantidad: number; unidadMedida: string };
  margenGanancia?: number;
}

export async function crearInsumo(
  page: Page,
  p: ParamCrearInsumo,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  await cerrarModales(page);

  const codigo = p.codigo || 'E2E-' + Date.now();
  const um = p.unidadMedida || 'UNIDAD';
  const insumo: InsumoAgrupado = {
    idOperacion: 'E2E-' + p.nombre,
    cabecera: {
      codigo,
      codigoInterno: codigo,
      nombre: p.nombre,
      unidadMedida: um,
      categoria: p.categoria || 'Categoria uno',
      clasificacionAbc: 'A',
      proveedor: p.proveedor || 'GRUPO SEVEN SEAS SAC',
      margenGanancia: p.margenGanancia ?? 0,
      mermaCompra: p.mermaCompra ?? 0,
      permiteConversion: !!p.equivalencia,
      impuestos: [],
    },
    presentaciones: [
      {
        nombre: 'Base',
        cantidad: 1,
        unidadMedida: um,
        costo: p.costoApertura,
        precioMinimo: 0,
        precioMaximo: 0,
        unidadControl: true,
        seVende: false,
        precioVenta: 0,
        esEstandar: true,
        activa: true,
      },
    ],
    inventario: [
      {
        almacen: p.almacen || 'Almacen Principal',
        controlarStock: true,
        stockApertura: p.stockApertura,
        costoApertura: p.costoApertura,
        stockMinimo: 0,
        stockMaximo: 0,
      },
    ],
    equivalencia: p.equivalencia,
  };

  const r = await registrarInsumo(page, insumo);
  await cerrarModales(page);
  if (r.ok) return { ok: true, id: r.idGenerado };
  return { ok: false, error: r.error };
}

export async function cerrarModales(page: Page): Promise<void> {
  try {
    const confirm = await page.$('.swal2-confirm');
    if (confirm) await confirm.click();
  } catch {
    /* ignore */
  }
  try {
    const close = await page.$('.swal2-close');
    if (close) await close.click();
  } catch {
    /* ignore */
  }
  await page.waitForTimeout(300);
}

export async function consultarInsumo(page: Page, nombre: string): Promise<number | null> {
  const r = await buscarInsumo(page, nombre);
  return r ? r.id : null;
}

export async function agregarPresentacion(
  page: Page,
  nombre: string,
  presentacionNombre: string,
  cantidad: number,
  costo: number,
  unidadMedida = 'UNIDAD',
): Promise<{ ok: boolean; error?: string }> {
  const id = await consultarInsumo(page, nombre);
  if (!id) return { ok: false, error: 'Insumo no encontrado: ' + nombre };

  return page.evaluate(
    async (args) => {
      try {
        const injector = angular.element(document.body).injector();
        const Insumo = injector.get('Insumo');

        const umResp = await Insumo.obtenerUnidadmedidaList();
        const ums = (umResp && umResp.data) || [];
        const um = ums.find(
          (u: any) =>
            String(u.unidadmedidainsumo_descripcion || '').toUpperCase() ===
            String(args.unidadMedida).toUpperCase(),
        );
        if (!um) throw new Error('Unidad de medida no encontrada: ' + args.unidadMedida);

        const resp = await Insumo.registrarPresentacioninsumo({
          insumo_id: args.id,
          unidadmedidainsumo_id: um.unidadmedidainsumo_id,
          presentacioninsumo_nombre: args.presentacionNombre,
          presentacioninsumo_cantidad: args.cantidad,
          presentacioninsumo_precioaproximado: args.costo,
          presentacioninsumo_precioventa: 0,
          presentacioninsumo_preciomaximo: 0,
          presentacioninsumo_preciominimo: 0,
        });

        if (resp && Number(resp.tipo) === 1) return { ok: true };
        return {
          ok: false,
          error: resp && resp.mensajes ? resp.mensajes.join('; ') : 'Sin respuesta de registrarPresentacioninsumo.',
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    { id, presentacionNombre, cantidad, costo, unidadMedida },
  );
}
