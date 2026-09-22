# Documento de Mapeo Estructural — Módulo Logística

> Análisis arquitectónico del módulo `logistica/` del backend webapp.
> Generado a partir del árbol de directorios y de los archivos de rutas (`rest/*/index.php`).
> Se excluye `V2reports/` y su contenido.

## Convención de capas (reglas arquitectónicas del módulo)

Logística **NO** usa `base/entitybase/entity` (a diferencia del núcleo `api/`). Sigue su propio stack:

| Capa | Ubicación | Convención de nombre | Responsabilidad |
|------|-----------|----------------------|-----------------|
| Rutas | `logistica/rest/{dominio}/index.php` | 1 archivo `index.php` por dominio (Slim 3) | Definir endpoints y handlers `($request, $response, $args)` |
| Controlador | `logistica/controllers/` | `{Entidad}LogisticaController` (monolítico) | Lógica de negocio; un controlador por entidad |
| Modelo | `logistica/models/` | `{Entidad}Logistica` (sufijo `Logistica`) | Entidad / DTO de datos |
| SQL Manager | `logistica/sqlmanager/` | `{Entidad}LogisticaDB` | Consultas crudas (SQL manual, sentencias preparadas) |
| Historial | `logistica/historial/` | `Historial{Operacion}` | Registro de histórico de operaciones |
| Reportes | `logistica/reportdata/`, `logistica/reportslogistica/` | `Reporte*`, `Report*DataSource` | Motor de reportes/exportables |
| Utils | `logistica/utils/` | `Tool*`, `Format*`, `DocumentoCompraIa` | Helpers transversales |
| Público | `logistica/public/{vista}/index.php` | — | Endpoints públicos (login/form) |

> **Nota:** algunos endpoints invocan controladores del núcleo `api/` (p. ej. `LocalController`,
> `InsumoController`, `VcsController`, `VentaController`). Se indican explícitamente como "core".

---

## Índice de dominios

| Dominio | Carpeta(s) de rutas |
|---------|---------------------|
| [1. Compras](#1-compras) | `rest/compra`, `rest/guiacompra`, `rest/ordencompra`, `rest/ordenservicio`, `rest/recepcioncompra`, `rest/recepcioncompracron` |
| [2. Stock / Inventario](#2-stock--inventario) | `rest/arqueoinventario`, `rest/cuadremanual`, `rest/procesostock`, `rest/loteconfiguracion` |
| [3. Movimientos / Kardex](#3-movimientos--kardex) | `rest/movimiento`, `rest/emulador` |
| [4. Requerimientos / Abastecimiento](#4-requerimientos--abastecimiento) | `rest/requerimientomovimiento` |
| [5. Guía de remisión](#5-guía-de-remisión) | `rest/guiaremision` |
| [6. Mermas](#6-mermas) | `rest/merma` |
| [7. Producción / Recetas](#7-producción--recetas) | `rest/produccion`, `rest/tiempopreparacionreceta` |
| [8. Maestros: Producto / Insumo / Receta](#8-maestros-producto--insumo--receta) | `rest/producto` |
| [9. Food Cost](#9-food-cost) | endpoints en `rest/producto`, `rest/common`, `rest/reporteria` |
| [10. Homologación](#10-homologación) | `rest/homologacion` |
| [11. Plan de mensajería](#11-plan-de-mensajería) | `rest/planmensajeria`, `public/planmensajeria` |
| [12. Reportes](#12-reportes) | `rest/reporteria` |
| [13. Común / Transversal](#13-común--transversal) | `rest/common`, `rest/migracion`, `rest/eventologistica` |
| [14. VCS / LogisticaVCS](#14-vcs--logisticavcs) | `rest/vcs`, `rest/logisticavcs`, `public/logisticavcs` |
| [15. Ventas (sync)](#15-ventas-sync) | `rest/venta` |

---

## 1. Compras

### Endpoints principales

**`rest/compra/index.php`** (controlador `CompraLogisticaController`)
- `POST /agregarCompra`, `POST /actualizarCompra`, `POST /guardarAvanceCompra`
- `POST /agregarCompraServicio`, `POST /actualizarCompraServicio`
- `POST /agregarCompraRapida`, `POST /actualizarCompraRapida`
- `GET /obtenerCompra/{compra_id}`, `GET /obtenerCompra/{compra_id}/{paraEdicion}`
- `GET /obtenerListaDeCompras/{parametros}`, `GET /obtenerCabeceraListaDeCompras/{parametros}`
- `GET /obtenerDataListCompraByTipo/{tipoGrafico}/{parametros}`
- `GET /validarCompraPorProveedorComprobanteSerieNumero/{proveedor_id}/{comprobante}/{serie}/{numero}/{compra_id}`
- `GET /obtenerUltimaCompraPorProveedor/{proveedor_id}`
- `GET /anularCompra/{compra_id}/{devolverStock}`, `GET /anularCompraServicio/{compra_id}/{devolverStock}`
- `GET /obtenerHistoricoById/{compra_id}/{idHistorico}`
- `GET /obtenerUltimoPrecioCompraPorInsumoProducto/{tipoBusqueda}/{presentacioncomprainsumoproducto_id}/{local_id}/{moneda_id}`
- `POST /obtenerUltimoPrecioCompraPorInsumoProductoByItemList/{local_id}/{moneda_id}`
- `GET /obtenerListaPlantillasDeCompra/{...}`, `GET /obtenerListaPlantillasDeCompraByOrdenCompra/{...}`, `GET /obtenerListaPlantillasDeOrdenServicio/{...}`
- `GET /obtenerPlantillaDeCompra/{plantilla_id}`, `GET /anularPlantillaAvanceCompra/{plantilla_id}`
- `POST /subirImagenCompra`, `POST /obtenerOrdenesCompraAImportar`, `POST /obtenerGuiasDeCompraAImportar`
- `GET /estadoBusquedaDteSimplefactura/{local_id}`, `POST /obtenerCompraDesdeDteSimplefactura`
- `GET /obtenerResumenCompraByLocal/{local_id}`, `POST /obtenerResumenDeComprasByLocalFecha`
- `GET /obtenerGuiasVinculadas/{compra_id}`, `GET /obtenerComparativo/{compra_id}`
- `GET /descartarRecomendacionDasboardCompras/{tipoRecomendacion}`, `GET /descartarTodasLasRecomendacionesDasboardCompras`
- `POST /obtenerCompraAImportarOCR`, `POST /procesarXMLByImportacionCompra`

**Requerimiento de compra** (`RequerimientocompraLogisticaController`)
- `POST /requerimientocompra/registrar`, `POST /requerimientocompra/actualizar`
- `GET /requerimientocompra/obtenerLista/{parametros}`, `GET /requerimientocompra/obtener/{id}`
- `GET /requerimientocompra/anular/{id}`, `GET /requerimientocompra/aprobar/{id}`, `POST /requerimientocompra/rechazar/{id}`
- `GET /requerimientocompra/obtenerConsolidadoParaImportar/{idList}`, `GET /requerimientocompra/agrupar/{idList}`
- `POST /requerimientocompra/canjearRequerimientoPorOrdencompra`, `POST /requerimientocompra/generarOrdenCompraByRequerimiento`
- `POST /requerimientocompra/generarSolicitudStockPorInsumosFaltantes`, `GET /requerimientocompra/generarSolicitudCompraPorRequerimiento/{id}`

**Nota de crédito** (`CompraLogisticaController`)
- `POST /notacreditocompra/registrar`, `POST /notacreditocompra/editarSerieCorrelativo`
- `GET /notacreditocompra/obtener/{id}`, `GET /notacreditocompra/anular/{id}`, `GET /notacreditocompra/obtenerLista/{params}`

**Compras por pagar** (`CompraLogisticaController`)
- `POST /comprasporpagar/agregarAmortizacion`, `GET /comprasporpagar/obtener/{id}`, `GET /comprasporpagar/obtenerLista/{params}`, `GET /comprasporpagar/obtenerCabecera/{params}`
- `GET /avancecompra/obtenerLista/{params}`

**Liquidación de compras** (`CompraLogisticaController`)
- `POST /liquidacioncompra/preProcesadoLiquidacionCompra`, `POST /liquidacioncompra/registrar`
- `GET /liquidacioncompra/obtener/{id}`, `GET /liquidacioncompra/anular/{id}`, `GET /liquidacioncompra/obtenerLista/{params}`

**`rest/ordencompra/index.php`** (`OrdencompraLogisticaController`)
- `POST /registrarOrdencompra`, `POST /actualizarOrdencompra`
- `GET /obtenerOrdencompraLista/{parametros}`, `GET /obtenerCabeceraListaDeOrdenes/{parametros}`
- `GET /obtenerOrdencompra/{ordencompra_id}`, `GET /obtenerOrdencompra/{ordencompra_id}/{calcularImpuestos}`
- `GET /anularOrdencompra/{id}`, `GET /aprobarOrdencompra/{id}`, `GET /rechazarOrdencompra/{id}`, `POST /rechazarOrdencompra/{id}`
- `POST /enviarOrdencompraPorEmail`, `POST /evaluarOrdenescompra`, `POST /obtenerDataConsolidado`, `POST /subirImagenOrdenCompra`
- `GET /obtenerHistoricoById/{id}/{idHistorico}`, `GET /obtenerDataPlantillaOrdencompra/{avancecompra_id}`, `GET /obtenerComparativo/{id}`

**`rest/ordenservicio/index.php`** (`OrdenservicioLogisticaController`)
- `POST /registrarOrdenservicio`, `POST /actualizarOrdenservicio`
- `GET /obtenerOrdenservicioLista/{parametros}`, `GET /obtenerCabeceraListaDeOrdenes/{parametros}`
- `GET /obtenerCategoriaServicioCompra`, `GET /obtenerOrdenservicio/{id}`
- `GET /aprobarOrdenservicio/{id}`, `GET /anularOrdenservicio/{id}`, `GET/POST /rechazarOrdenservicio/{id}`
- `GET /generarRequerimientocompraPorCosumiblesFaltantes/{id}`, `POST /enviarOrdenservicioPorEmail`
- `POST /registrarCategoriaserviciocompra`, `POST /actualizarCategoriaserviciocompra`

**`rest/guiacompra/index.php`** (`GuiaLogisticaController`)
- `POST /guardarGuia`, `POST /actualizarGuia`
- `GET /anularGuia/{guia_id}/{devolverStock}`, `GET /obtenerGuia/{guia_id}`
- `GET /obtenerListaGuia/{parametros}`, `GET /obtenerListaDeGuias/{parametros}`, `GET /obtenerCabeceraListaDeGuias/{parametros}`
- `GET /validarGuiaPorProveedorComprobanteSerieNumero/{...}`, `GET /obtenerUltimaGuiaPorProveedor/{proveedor_id}`
- `POST /obtenerOrdenesCompraAImportar`, `POST /obtenerOrdenesCompraAImportarByDistribucion/{local_id}`, `POST /obtenerGuiaRemisionAImportar`
- `GET /obtenerHistoricoById/{guia_id}/{idHistorico}`, `GET /obtenerComparativo/{guia_id}`

**`rest/recepcioncompra/index.php`** (`RecepcioncompraLogisticaController`)
- `POST /sincronizar`, `GET /sincronizacion/estado`, `POST /listar`
- `GET /detalle/{recepcioncompra_id}`
- `PUT /detalle/{detallerecepcioncompra_id}/homologacion`, `PUT /detalle/{detallerecepcioncompra_id}/no-aplica`, `DELETE /detalle/{detallerecepcioncompra_id}/no-aplica`
- `PUT /{recepcioncompra_id}/descartar`, `PUT /{recepcioncompra_id}/restaurar`, `GET /{recepcioncompra_id}/canje`

**`rest/recepcioncompracron/index.php`** (`RecepcioncompraLogisticaController`)
- `POST /sincronizar`

### Controladores responsables
- `CompraLogisticaController` (compra, nota crédito, compras por pagar, liquidación)
- `GuiaLogisticaController` (guía de compra)
- `OrdencompraLogisticaController`
- `OrdenservicioLogisticaController`
- `ConsumibleordenservicioLogisticaController`, `DetalleordenservicioLogisticaController`
- `RequerimientocompraLogisticaController`
- `RecepcioncompraLogisticaController`
- `ImpuestocompraLogisticaController`

### Modelos y SQL Managers

**Modelos** (`models/`): `CompraLogistica`, `DetallecompraLogistica`, `DetallecompraservicioLogistica`,
`DetalleconsumiblecompraLogistica`, `AvancecompraLogistica`, `DetalleavancecompraLogistica`,
`ComprobantecompraLogistica`, `CompraimpuestocompraLogistica`, `ImpuestocompraLogistica`,
`ImpuestodetallecompraLogistica`, `ImpuestocompraproductogeneralinsumoLogistica`,
`NotacreditocompraLogistica`, `LiquidacioncompraLogistica`, `GuiaLogistica`, `DetalleguiaLogistica`,
`OrdencompraLogistica`, `DetalleordencompraLogistica`, `OrdenservicioLogistica`, `DetalleordenservicioLogistica`,
`PlantillaordenservicioLogistica`, `DetalleplantillaordenservicioLogistica`, `PlantillaconsumibleordenservicioLogistica`,
`ConsumibleordenservicioLogistica`, `RequerimientocompraLogistica`, `OrdenrequerimientocompraLogistica`,
`RecepcioncompraLogistica`, `DetallerecepcioncompraLogistica`, `SincronizacionrecepcioncompraLogistica`,
`ProveedorLogistica`, `ClienteLogistica`, `MonedaLogistica`, `PresentacioncompraproductoLogistica`,
`ResolucionDocumentoCompraIa`

**SQL Managers** (`sqlmanager/`): `CompraLogisticaDB`, `DetallecompraLogisticaDB`, `DetallecompraservicioLogisticaDB`,
`DetalleconsumiblecompraLogisticaDB`, `AvancecompraLogisticaDB`, `DetalleavancecompraLogisticaDB`,
`ComprobantecompraLogisticaDB`, `CompraimpuestocompraLogisticaDB`, `ImpuestodetallecompraLogisticaDB`,
`ImpuestocompraproductogeneralinsumoLogisticaDB`, `NotacreditocompraLogisticaDB`, `LiquidacioncompraLogisticaDB`,
`ComprasporpagarLogisticaDB`, `DetallecomprasporpagarLogisticaDB`, `GuiaLogisticaDB`, `DetalleguiaLogisticaDB`,
`OrdencompraLogisticaDB`, `DetalleordencompraLogisticaDB`, `OrdenservicioLogisticaDB`, `DetalleordenservicioLogisticaDB`,
`PlantillaordenservicioLogisticaDB`, `DetalleplantillaordenservicioLogisticaDB`, `PlantillaconsumibleordenservicioLogisticaDB`,
`ConsumibleordenservicioLogisticaDB`, `RequerimientocompraLogisticaDB`, `OrdenrequerimientocompraLogisticaDB`,
`RecepcioncompraLogisticaDB`, `DetallerecepcioncompraLogisticaDB`, `SincronizacionrecepcioncompraLogisticaDB`,
`ProveedorLogisticaDB`, `MonedaLogisticaDB`

---

## 2. Stock / Inventario

### Endpoints principales

**`rest/arqueoinventario/index.php`** (`ArqueoinventarioLogisticaController`)
- `GET /obtenerListaDeArqueosDeInventarioPorUrlEncodeada/{parametros}`
- `GET /obtenerCabeceraDeArqueoDeInventarioPorUrlEncodeada/{parametros}`
- `POST /obtenerStockParaArqueoInventario`, `GET /obtenerArqueoinventario/{arqueoinventario_id}`
- `POST /guardarArqueoInventario`, `GET /confirmarArqueoInventario/{id}`
- `GET/POST /observarArqueoInventario/{id}`, `GET /generarNotificacionArqueoInventario/{id}`
- `GET /obtenerListaPlantilla/{parametros}`, `POST /guardarPlantilla`, `GET /obtenerPlantilla/{id}`, `GET /anularPlantilla/{id}`

**`rest/cuadremanual/index.php`** (`CuadremanualLogisticaController`)
- `GET /obtenerListaDeCuadresmanualesPorUrlEncodeada/{parametros}`
- `GET /obtenerListaPlantillacuadre/{parametros}`, `GET /anularPlantillacuadre/{id}`, `GET /obtenerPlantillacuadre/{id}`
- `GET /obtenerCabeceraDeCuadresmanualesPorUrlEncodeada/{parametros}`
- `POST /procesarStockDesdeExcel`, `POST /guardarCuadreManualStock`
- `GET /asignarControlATodosLosInsumosProductos/{almacen_id}`, `POST /getStockParaCuadreV2`
- `GET /anularCuadremanual/{cuadremanual_id}`, `GET /obtenerCuadremanual/{cuadremanual_id}`
- `POST /crearPlantillaDesdeCuadremanual`
- `GET /procesarCuadresPendientes`, `GET /procesarCuadrePendiente/{cuadremanual_id}`

**`rest/procesostock/index.php`** (`ProcesostockLogisticaController`)
- `GET /previsualizarProcesoStock/{parametros}`, `GET /guardarProcesoStock/{parametros}`, `GET /obtenerInformeProcesoStock/{parametros}`

**`rest/loteconfiguracion/index.php`** (`LoteconfiguracionController` — core)
- `GET /criticidad`, `GET /criticidad/{local_id}`, `POST /criticidad`, `POST /criticidad/restaurar`, `POST /criticidad/restaurar/{local_id}`

### Controladores responsables
- `ArqueoinventarioLogisticaController`
- `CuadremanualLogisticaController`
- `ProcesostockLogisticaController`
- `AlmacenLogisticaController` (control de stock / almacenes)
- `LoteconfiguracionController` (core)

### Modelos y SQL Managers

**Modelos**: `ArqueoinventarioLogistica`, `CuadremanualLogistica`, `DetallecuadremanualLogistica`,
`AlmacenLogistica`, `AlmacenproductoinsumoLogistica`, `PrevisualizacionLogistica`

**SQL Managers**: `ArqueoinventarioLogisticaDB`, `CuadremanualLogisticaDB`, `DetallecuadremanualLogisticaDB`,
`AlmacenLogisticaDB`, `AlmacenproductoinsumoLogisticaDB`, `PrevisualizacionLogisticaDB`,
`CierrecajaLogisticaDB`, `EgresoLogisticaDB`

---

## 3. Movimientos / Kardex

### Endpoints principales

**`rest/movimiento/index.php`** (`MovimientoLogisticaController` / `SolicitudmovimientoLogisticaController`)
- `POST /guardarMovimiento`, `POST /actualizarMovimiento`
- `GET /anularMovimiento/{movimiento_id}/{devolverStock}`
- `GET /obtenerMovimiento/{id}`, `GET /obtenerMovimientoConStock/{id}`, `GET /obtenerMovimientoDetallado/{id}`
- `GET /regularizarMovimientosPorKardex/{f1}/{f2}/{local_id}/{movimiento_id}/{actualizar}/{ignorardetalles}`
- `GET /obtenerListaMovimiento/{parametros}`, `GET /obtenerListaDeMovimientos/{parametros}`
- `GET /actualizarValorizadoDeMovimientos/{parametros}`, `GET /obtenerCabeceraListaDeMovimientos/{parametros}`
- `GET /validarMovimientoPorProveedorComprobanteSerieNumero/{...}`, `GET /obtenerUltimaMovimientoPorProveedor/{proveedor_id}`
- `POST /validarItemConControlDeStockEnAlmacenes`, `POST /agregarOrdenmovimiento`, `POST /actualizarOrdenmovimiento`
- `GET /obtenerListaDeOrdenDeMovimientos/{parametros}`, `GET /obtenerDetalleOrdenPorID/{id}`, `GET /obtenerCabeceraListaDeOrdenDeMovimientos/{parametros}`
- `GET /obtenerOrdenMovimiento/{ordenmovimiento_id}`, `GET /anularOrdenMovimiento/{id}`, `GET /aprobarOrdenMovimiento/{id}`, `GET/POST /rechazarOrdenMovimiento/{id}`
- `POST /obtenerGuiaRemisionAImportar`, `POST /obtenerRequerimientoStockAImportar`, `POST /obtenerOrdenMovimientoAImportar`, `POST /obtenerOrdenProduccionAImportar`
- `GET /obtenerKardexPorProducto/{parametros}`, `POST /obtenerKardexPorProductoPost`, `GET /obtenerCabeceraKardexPorProducto/{parametros}`, `POST /kardexGeneralPaginado`
- `GET /obtenerDataListMovimientoByTipoGrafico/{tipoGrafico}/{parametros}`
- `GET /obtenerComparativoVsGuiaremision/{movimiento_id}`, `GET /ordenmovimiento/obtenerComparativo/{solitudmovimiento_id}`
- `POST /generarMovimientosPorProduccion`, `GET /obtenerMovimientosPorProduccion/{ordenproduccion_id}/{detalleordenproduccion_id}`, `POST /anularTodosLosMovimientosPorOrdenProduccion`, `POST /generarOrdenesMovimientosPorProduccion`
- Trazabilidad de lotes (IA): `POST /obtenerLotesPorVencerIa`, `POST /obtenerResumenLotesIa`, `POST /obtenerSucursalesLotesIa`, `GET /buscarTrazabilidadLotesIa/{q}`, `GET /obtenerTrazabilidadLoteIa/{movimientoId}`, `GET /obtenerArbolLoteIa/{loteId}`, `POST /obtenerOperacionesLotesIa/{origen}/{pagina}/{registros}`, `POST /obtenerReporteTrazabilidadIa/{codigo}`, `GET /obtenerLotesDisponibles_ia/{producto_id}/{insumo_id}/{almacen_id}`

**`rest/emulador/index.php`** (`EmuladorLogisticaController`)
- `POST /emularCambioStockEnCompras/{proceso}/{historicoCantidadCompras}`
- `POST /emularCambioStockEnGuia/{proceso}/{historicoCantidadGuias}`
- `POST /emularCambioStockEnMermas/{proceso}/{historicoCantidadMermas}`
- `POST /emularCambioStockEnMovimientos/{proceso}/{historicoCantidadMovimientos}`
- `POST /emularCambioStockEnGuiaremision/{proceso}/{historicoCantidadGuias}`
- `POST /emularCambioStockEnPreparacionRecetas/{proceso}/{historicoCantidadPreparacionRecetas}`
- `POST /emularCambioStockEnPorcionamientoRecetas/{proceso}/{historicoCantidadPreparacionRecetas}`
- `POST /emularCambioStockEnCompraServicios/{proceso}/{historicoCantidadCompraServicios}`
- `GET /testRoundFormat/{valor}`

### Controladores responsables
- `MovimientoLogisticaController`
- `SolicitudmovimientoLogisticaController`
- `EmuladorLogisticaController`

### Modelos y SQL Managers

**Modelos**: `MovimientoLogistica`, `DetallemovimientoLogistica`, `SolitudmovimientoLogistica`,
`DetallesolitudmovimientoLogistica`, `EmuladorlotepreparacionrecetaLogistica`

**SQL Managers**: `MovimientoLogisticaDB`, `DetallemovimientoLogisticaDB`, `SolicitudmovimientoLogisticaDB`,
`DetallesolicitudmovimientoLogisticaDB`

---

## 4. Requerimientos / Abastecimiento

### Endpoints principales

**`rest/requerimientomovimiento/index.php`** (`RequerimientomovimientoLogisticaController` / `PlantillarequerimientoLogisticaController`)
- `POST /agregarSolicitudAbastecimiento`, `POST /agregarSoloComoPlantilla`, `POST /agregarPlantillaSolicitudAbastecimiento`
- `GET /obtenerPlantillaRequerimientoPorLocal/{local_id}`, `POST /obtenerPlantillarequerimientoParaImportar`, `POST /obtenerPlantillarequerimientoParaImportar/{omitirCantidadCero}`
- `GET /obtenerListaDeRequerimientosPorUrlEncodeada/{parametros}`
- `GET /anularRequerimientoMovimiento/{id}`, `GET /obtenerRequerimientoMovimientoParaEdicion/{id}`, `POST /editarRequerimientomovimiento`
- `GET /obtenerDetalleRequerimientoPorRequerimientoId/{id}`, `GET /obtenerHistoricoById/{id}/{idHistorico}`
- `GET /obtenerRequerimientomovimientoParaResumen/{id}`, `GET /obtenerComparativoDespachoVsRequerimientoId/{id}`
- `GET /requerimientomovimiento/aprobar/{id}`, `GET/POST /requerimientomovimiento/rechazar/{id}`
- `POST /consolidarRequerimientos`, `POST /actualizarCabeceraPlantilla`
- `GET /obtenerEstadoConfiguracionAlmacenesPorLocal/{local_id}`
- `GET /obtenerRequerimientoStockParaAbastecimientoPorLocal/{local_id}/{tipo_periodo}/{fecha_inicio_solicitud}/{numero_dias}`
- `GET /obtenerRequerimientoStockPorDelivery/{local_id}/{f1}/{f2}/{tipo}`
- `POST /guardarRequerimientosStockEnBaseNuevoProcesoProduccion`
- `GET /obtenerRequerimientoStocksGuardadosDeUnProcesoProduccion/{loterequerimiento_id}`
- `GET /obtenerOrdenesProduccionAPartirDeLoteRequerimientos/{loterequerimiento_id}`, `POST /guardarOrdenesProduccionAPartirRequerimientos/{loterequerimiento_id}`
- `GET /obtenerSolicitudesCompraAPartirDeLoteRequerimientos/{loterequerimiento_id}`, `POST /guardarSolicitudesCompraAPartirRequerimientos/{loterequerimiento_id}`
- `GET /obtenerOrdenesCompraAPartirDeLoteRequerimientos/{loterequerimiento_id}`, `POST /guardarOrdenesCompraAPartirRequerimientos/{loterequerimiento_id}`
- `POST /canjearPorProcesoProduccion`
- `GET /obtenerSolicitudesDeMovimientoAPartirDeLoteRequerimiento/{loterequerimiento_id}/{faseDelProceso}`
- `GET /anularPlantillarequerimiento/{plantillarequerimiento_id}`, `GET /obtenerRequerimientoByLoterequerimiento/{loterequerimiento_id}`
- `GET /loterequerimiento/obtenerCabeceraListaDeLotesrequerimiento/{parametros}`, `GET /loterequerimiento/obtenerListaDeLotesrequerimiento/{parametros}`
- `GET /obtenerItemParaRequerimientoPorStockMaximo/{almacen_id}`, `POST /obtenerItemParaRequerimientoPorStockMaximoPorLocales`

### Controladores responsables
- `RequerimientomovimientoLogisticaController`
- `PlantillarequerimientoLogisticaController`
- `DetallerequerimientoLogisticaController`

### Modelos y SQL Managers

**Modelos**: `RequerimientomovimientoLogistica`, `DetallerequerimientoLogistica`, `PlantillarequerimientoLogistica`,
`DetalleplantillarequerimientoLogistica`, `LoterequerimientoLogistica`

**SQL Managers**: `RequerimientomovimientoLogisticaDB`, `DetallerequerimientomovimientoLogisticaDB`,
`PlantillarequerimientoLogisticaDB`, `DetalleplantillarequerimientoLogisticaDB`

---

## 5. Guía de remisión

### Endpoints principales

**`rest/guiaremision/index.php`** (`GuiaremisionLogisticaController`)
- `POST /addGuiaremision`, `POST /updateGuiaremision`
- `GET /obtenerGuiaremisionLista/{parametros}`, `GET /obtenerCabeceraListaDeGuiasremision/{parametros}`
- `GET /anulaGuiaremision/{guiaremision_id}/{devolverStock}`
- `GET /obtenerDatosRecurrentesByLocal/{local_id}`
- `GET /obtenerDestinatarioPorLocalDestinoIa/{localdestino_id}/{localorigen_id}`, `POST /crearDestinatarioDesdeLocalIa/{localdestino_id}/{localorigen_id}`
- `GET /obtenerSiguienteCorrelativoPorSerie/{serie}`
- `POST /obtenerRequerimientoStockAImportar`, `POST /obtenerGuiaremisionParaImportarAVenta`, `POST /obtenerDetalleByProcesadoExcel`
- `GET /desvincularVenta/{venta_id}`, `POST /consolidarGuiaremsionList`
- Órdenes de guía de remisión: `POST /orden/registrar`, `POST /orden/editar`, `GET /orden/obtenerLista/{parametros}`, `GET /orden/obtenerConsolidado/{idList}/{devolverTextoCategoria}`, `GET /orden/obtener/{ordenguiaremision_id}`, `GET /orden/anular/{idList}`, `GET /orden/activar/{idList}`
- Comparativos: `GET /obtenerComparativoVsMovimiento/{guiaremision_id}`, `GET /obtenerComparativoVsGuia/{guiaremision_id}`, `GET /obtenerComparativoVsVenta/{guiaremision_id}`
- `GET /regularizarMovimientosPorKardex/{f1}/{f2}/{actualizar}/{local_id}/{guiaremision_id}`
- `POST /obtenerPesosSegunUltimaGuia`, `GET /verificarCambioEnCantidadesEnGuiaParaMariaAlemanara/{guiaremision_id}`

### Controladores responsables
- `GuiaremisionLogisticaController`

### Modelos y SQL Managers

**Modelos**: `GuiaremisionLogistica`, `DetalleguiaremisionLogistica`, `OrdenguiaremisionLogistica`

**SQL Managers**: `GuiaremisionLogisticaDB`, `DetalleguiaremisionLogisticaDB`, `OrdenguiaremisionLogisticaDB`

---

## 6. Mermas

### Endpoints principales

**`rest/merma/index.php`** (`MermaLogisticaController`)
- `POST /agregarMerma`, `POST /agregarMermaByModal`, `POST /actualizarMerma`, `POST /actualizarRazonMerma`
- `GET /obtenerMerma/{merma_id}`
- Importación: `GET /obtenerParaSalidaDesdeImportacion/{importacion_id}/{almacen_id}`, `GET /procesarImportacion/{importacion_id}`, `GET /procesarKardexImportacion/{importacion_id}`, `GET /anularImportacion/{importacion_id}`
- `GET /obtenerListaDeMermas/{parametros}`, `GET /obtenerListaDeMermasWorkplace/{parametros}`, `GET /obtenerItemsParaSalidaRapidaIa/{parametros}`
- `GET /anularMerma/{merma_id}`, `GET /aprobarMerma/{merma_id}`
- `GET /obtenerCostoInsumoProducto/{id}/{tipo}/{almacen_id}/{unidadmedidainsumo}`
- `POST /agregarCategoriaMerma`, `POST /actualizarCategoriaMerma`
- `GET /obtenerDataListMermaByTipoGrafico/{tipoGrafico}/{parametros}`
- `GET /obtenerCabeceraListaDeMermas/{parametros}`, `GET /obtenerCabeceraListaDeMermasPorLimpieza/{parametros}`
- `GET /obtenerDetalleParaMermaByModulo/{modulo_id}/{registro_id}`

### Controladores responsables
- `MermaLogisticaController`

### Modelos y SQL Managers

**Modelos**: `MermaLogistica`, `DetallemermaLogistica`, `CategoriasalidaLogistica`

**SQL Managers**: `MermaLogisticaDB`, `DetallemermaLogisticaDB`

---

## 7. Producción / Recetas

### Endpoints principales

**`rest/produccion/index.php`** (`OrdenproduccionLogisticaController` / `PreparacionrecetaLogisticaController` / `LotepreparacionrecetaLogisticaController`)

Órdenes de producción:
- `POST /ordenproduccion/agregar`, `POST /ordenproduccion/actualizar`
- `GET /ordenproduccion/obtener/{ordenproduccion_id}`, `GET /ordenproduccion/obtener/{ordenproduccion_id}/{almacen_id}`
- `GET /ordenproduccion/obtenerPlantillaordenproduccionList/{params}`, `GET /ordenproduccion/obtenerPlantillaordenproduccionParaImportar/{id}`
- `GET /ordenproduccion/obtenerParaImportar/{ordenproduccion_id}`, `GET /ordenproduccion/obtenerPlantillaParaImportar/{idList}`
- `GET /ordenproduccion/obtenerParaAbastecer/{ordenproduccion_id}/{almacen_id}` y variantes (`/validarStock`, `SinAnalisis`)
- `GET /ordenproduccion/generarOrdenMovimiento/{ordenproduccion_id}`
- `GET /ordenproduccion/obtenerLista/{parametros}`, `GET /ordenproduccion/anular/{id}`, `GET /ordenproduccion/anularPlantillaordenproduccion/{id}`
- `GET /ordenproduccion/aprobar/{id}`, `GET/POST /ordenproduccion/rechazar/{id}`
- `POST /ordenproduccion/generarPorRecetasFaltantesCalculoPlatos`
- `GET /ordenproduccion/obtenerInsumoRecetaFaltanteParaProducir/{id}` y variantes
- `GET /ordenproduccion/obtenerComparativo/{id}`
- `GET /ordenproduccion/finalizar/detalle/{detalleordenproduccion_id}`, `GET /ordenproduccion/finalizar/{ordenproduccion_id}/{almacen_id}`
- `GET /ordenproduccion/obtenerAlmacenDosificacionList/{insumo_id}/{ordenproduccion_id}/{detalleordenproduccion_id}`
- `GET /ordenproduccion/iniciarOrdenProduccionWokrplace/{ordenproduccion_id}/{almacen_id}`
- `GET /ordenproduccion/obtenerTiempoPreparacionByDetalleOrdenProduccionId/{detalleordenproduccion_id}`
- `GET /ordenproduccion/obtenerOrdenproduccionParaAbastecerPorInsumoId/{ordenproduccion_id}/{insumo_id}/{almacen_id}`
- `POST /ordenproduccion/obtenerOrdenproduccionParaAbastecerPorRecetas/{ordenproduccion_id}/{almacen_id}`

Preparación de recetas:
- `POST /preparacionreceta/agregarPreparacionRecetaPorLote`, `POST /preparacionreceta/agregarPreparacionRecetaManualPorLote`
- `POST /porcionamientoreceta/agregarPorcionamientoRecetaPorLote`
- `GET /preparacionreceta/obtenerCabeceraListaDePreparaciones/{parametros}`, `GET /preparacionreceta/obtenerListaDePreparaciones/{parametros}`
- `GET /preparacionreceta/obtenerDetallePreparacionReceta/{preparacionreceta_id}`
- `GET /preparacionreceta/obtenerByLote/{lotepreparacionreceta_id}`
- `GET /preparacionreceta/obtenerCabeceraDeListaDeLotesDePreparacionDeRecetas/{parametros}`, `GET /preparacionreceta/obtenerListaDeLotesDePreparacionDeRecetas/{parametros}`
- `GET /preparacionreceta/obtenerDetalleLotePreparacionReceta/{lotepreparacionreceta_id}`, `GET /preparacionreceta/anularLotePreparacion/{lotepreparacionreceta_id}`
- `GET /preparacionreceta/obtenerReportePreparacionReceta/{parametros}`

**`rest/tiempopreparacionreceta/index.php`** (`TiempopreparacionrecetaController` — core)
- `POST /tiempopreparacionreceta`, `PUT /tiempopreparacionreceta`, `GET /tiempopreparacionreceta/{id}`, `DELETE /tiempopreparacionreceta/{id}`
- `GET /listarPorPaginacion/{pagina}/{registros}`, `GET /getAllActivos`

### Controladores responsables
- `OrdenproduccionLogisticaController`
- `PreparacionrecetaLogisticaController`
- `LotepreparacionrecetaLogisticaController`
- `TiempopreparacionrecetaController` (core)

### Modelos y SQL Managers

**Modelos**: `OrdenproduccionLogistica`, `DetalleordenproduccionLogistica`, `PreparacionrecetaLogistica`,
`DetallepreparacionrecetaLogistica`, `DetalleresultantepreparacionrecetaLogistica`, `LotepreparacionrecetaLogistica`,
`EmuladorlotepreparacionrecetaLogistica`, `PresentacionresultanterecetaLogistica`,
`DescartablepresentacionresultanterecetaLogistica`

**SQL Managers**: `OrdenproduccionLogisticaDB`, `PreparacionrecetaLogisticaDB`, `DetallepreparacionrecetaLogisticaDB`,
`DetalleresultantepreparacionrecetaLogisticaDB`, `PresentacionresultanterecetaLogisticaDB`,
`DescartablepresentacionresultanterecetaLogisticaDB`

---

## 8. Maestros: Producto / Insumo / Receta

### Endpoints principales

**`rest/producto/index.php`** — agrupa producto, insumo, receta, porcionable, categorías y modificadores.

Producto (`ProductoLogisticaController`):
- `GET /producto/obtener/{producto_id}`, `GET /producto/obtenerBusquedaProductoByCategoria/{descripcion}/{categoria_id}`
- `GET /producto/obtenerArbolCategoriasPorLocal/{local_id}`, `GET /producto/obtenerListaCategoriasPorLocal/{local_id}`
- `GET /producto/obtenerProductosPorCategoria/{local_id}/{categoria_id}/{descripcion}/{pagina}/{registros}`
- `GET /producto/obtenerPresentacionesPorProductoGeneral/{productogeneral_id}/{mostrarDatosExtra}`
- `POST /producto/registrarActualizarRecetaProductoLogistica`, `POST /producto/actualizarControlStockProducto`, `POST /producto/actualizarPresentacionCompraProducto`
- `GET /producto/obtenerListaDeProductosGeneralesConFiltros/{parametros}`
- `GET /producto/obtenerListaDeIngredientesPorPresentacion/{producto_id}/{almacen_id}`, `GET /producto/obtenerDescartablePresentacionProducto/{producto_id}/{almacen_id}`
- `GET /producto/obtenerCostoRecetaProductoTransformado/{producto_id}/{local_id}/{almacen_id}/{fecha}/{mostrarValorSinImpuestos}`
- `GET /producto/obtenerCostoYPrecioProducto/{producto_id}/{local_id}/{almacen_id}`, `GET /producto/obtenerPresentacionCompraProducto/{producto_id}`
- `GET /producto/obtenerProductoParaEdicionRestriccionByStock/{params}`, `POST /producto/actualizarAjustesAvanzados`
- `POST /producto/actualizarFoodCostCategoriaProducto`, `POST /producto/actualizarFoodCostProducto`
- `POST /producto/obtenerRecetasInsumosNecesariosParaPrepararPlatos`, `POST /producto/obtenerDetallePresentacion`

Permisos de local (`LocalController` — core): `GET /local/obtenerLocalesPermitidosParaUsuarioID/{usuario_id}`, `GET /local/obtenerLocalesPermitidosByProduccion`

Insumo (`InsumoLogisticaController`):
- `POST /insumo/registrarInsumo`, `POST /insumo/actualizarInsumoPorEdicionNormal`, `POST /insumo/actualizarInsumoPorEdicionRapida`
- `POST /insumo/actualizarPresentacioninsumoPorEdicionRapida`, `POST /insumo/actualizarAlmacenproductoinsumoPorEdicionRapida`, `POST /insumo/actualizarAlmacenproductoinsumoPorEdicionRapidaV2`
- `POST /insumo/actualizarAlmacenproductoinsumoPorEdicionStockMinMax`, `POST /insumo/actualizarAlmacenproductoinsumoPorReplicaStockMinMax`, `POST /insumo/actualizarInsumoProductoGestionProveedor`
- `POST /insumo/registrarPresentacioninsumo`, `POST /insumo/aperturarStock`, `POST /insumo/actualizacionInsumoPorLote`
- `GET /insumo/aperturarInsumosNoAperturadosPorTipo/{tipo}/{almacen}/{fecha}`, `GET /insumo/actualizarProveedor/{item_tipo}/{item_id}/{proveedor_id}`
- `GET /insumo/obtener/{insumo_id}`, `GET /insumo/obtenerStockYCosto/{insumo_id}`, `GET /insumo/obtenerInsumoDetallado/{insumo_id}/{tipoInsumo}/{mostrarCostoSinImpuestos}`
- `GET /insumo/obtenerDatosGeneralesByInsumoID/{insumo_id}/{tipoInsumo}`, `GET /insumo/insumoListPaginado/{pagina}/{registros}`
- `GET /insumo/obtenerCategoriaInsumoList`, `GET /insumo/obtenerNivelubicacioninsumoList`, `GET /insumo/obtenerUnidadmedidaList`
- `GET /insumo/obtenerAlmacenesParaControlDeStockApertura`, `GET /insumo/obtenerListaImpuestocompraPorLocal/{local_id}`
- `GET /insumo/obtenerInsumoParaEdicion/{insumo_id}`, `GET /insumo/obtenerInsumosParaEdicionStockMinimoMaximo/{params}`
- `GET /insumo/obtenerInsumosParaGestionProveedor/{params}`, `GET /insumo/actualizarInsumoProductoGestionProveedorPorLote/{params}`, `GET /insumo/obtenerInsumosParaEdicionFavoritos/{params}`
- `POST /insumo/testCambioUm`, `POST /insumo/actualizarFechaAperturaInsumo`, `POST /insumo/actualizarInsumoProductoFavoritos`, `POST /insumo/actualizarInsumoProductoDestacadosporalmacen`
- Migración: `POST /insumo/crearInsumosPorMigracionDesdeBaseDatosCentralMovil1`, `POST /insumo/crearInsumoPorMigracionInstanciaMaestra`
- `GET /insumo/marcarAlmacenproductoinsumoControlStock/{params}`, `GET /insumo/marcarAlmacenproductoinsumoDestacados/{params}`
- `GET /insumo/obtenerReporteInsumosAnuladosUsadosEnReceta/{params}`
- `GET /insumo/generarPresentacionBaseAInsumos/{idInicio}/{idFin}`, `POST /insumo/actualizarNombrePresentacionesGeneradas`
- `GET /insumo/anular/{insumo_id}`, `GET /insumo/obtenerVinculosAnulacion/{insumo_id}`, `POST /insumo/sustituirEnUsosEInactivar`, `GET /insumo/activar/{insumo_id}`
- `GET /insumo/obtenerInsumoLista/{params}`, `GET /insumo/obtenerCategoriaInsumoArbolList` y variantes (`_lite`, `_lite_p`)
- `POST /insumo/actualizarCategoriainsumoGestionCategoria`, `POST /insumo/actualizarStockMinMaxPorAnalisis`

Receta / porcionable (`InsumoLogisticaController`):
- `POST /receta/registrarReceta`, `POST /receta/actualizarReceta`, `POST /receta/registrarPresentacionReceta`, `POST /receta/actualizarPresentacionReceta`, `POST /receta/eliminarPresentacionReceta`
- `GET /receta/obtenerCategoriarecetaList`, `GET /receta/obtenerListaRecetas/{...}`, `GET /receta/obtenerListaRecetasV2/{parametros}`, `POST /receta/obtenerListaRecetasPaginado`
- `GET /receta/obtenerDatosReceta/{insumo_id}`, `GET /receta/obtenerDatosRecetaParaProduccion/{...}`, `GET /receta/obtenerDatosRecetaParaPorcionarRecetas/{...}`, `GET /receta/obtenerDatosPorcionableParaProduccion/{...}`
- `GET /receta/obtenerListaPresentacionesPorReceta/{insumo_id}`, `GET /receta/obtenerListaInsumosPorReceta/{insumo_id}` (+ `/{almacen_id}`, `/{obtenerGrafico}`)
- `GET /receta/anular/{insumo_id}`, `GET /receta/anularVarias/{idList}`, `GET /receta/activar/{insumo_id}`, `GET /receta/generarScriptRecetas`
- `GET /insumo/obtenerGraficoStockProductoInsumo/{item_id}/{item_tipo}/{almacen_id}`, `GET /insumo/obtenerPreciosPorPresentacion/{presentacioninsumo_id}`, `POST /insumo/actualizarPreciosPorPresentacion/{presentacioninsumo_id}`, `GET /insumo/obtenerPresentacionresultanterecetaPorDerivado/{insumo_id}`
- `POST /porcionable/registrarPorcionable`, `POST /porcionable/actualizarPorcionable`

Categorías / niveles (`InsumoLogisticaController`):
- `POST /categoriareceta/registrarCategoriareceta`, `POST /categoria/registrarCategoria`, `POST /categoriainsumo/registrarCategoriainsumo`
- `GET /categoriainsumo/contarItemsCascadaIa/{categoriainsumo_id}/{estadoNuevo}`, `POST /nivelubicacioninsumo/registrarNivelubicacioninsumo`

Modificadores (`ProductoLogisticaController`):
- `POST /modificador/registrarActualizarModificadoresProductoGeneralLogistica`, `POST /modificador/registrarActualizarListaInsumosDeTablaSeleccion`
- `GET /modificador/obtenerListaModificadoresSeleccionConFiltros/{parametros}`, `GET /modificador/obtenerListaInsumosDeTablaSeleccion/{seleccion_id}/{pagina}/{registros}`, `GET /modificador/obtenerModificadoresCategoriaPorProductogeneralId/{productogeneral_id}`

### Controladores responsables
- `ProductoLogisticaController`
- `InsumoLogisticaController`
- `AlmacenLogisticaController`
- `ImpuestocompraLogisticaController`
- Core: `LocalController`, `InsumoController`, `CategoriainsumoController`, `NivelubicacioninsumoController`, `UnidadmedidainsumoController`

### Modelos y SQL Managers

**Modelos**: `ProductoLogistica`, `InsumoLogistica`, `InsumoproductoLogistica`, `InsumoequivalenciaLogistica`,
`PresentacioninsumoLogistica`, `PresentacioncompraproductoLogistica`, `CategoriaLogistica`, `CategoriainsumoLogistica`,
`CategoriarecetaLogistica`, `NivelubicacioninsumoLogistica`, `UnidadmedidainsumoLogistica`, `RecetaLogistica`,
`VentainsumolocalLogistica`

**SQL Managers**: `ProductoLogisticaDB`, `InsumoLogisticaDB`, `InsumoequivalenciaLogisticaDB`, `PresentacioninsumoLogisticaDB`,
`CategoriaLogisticaDB`, `CategoriainsumoLogisticaDB`, `CategoriarecetaLogisticaDB`, `NivelubicacioninsumoLogisticaDB`,
`UnidadmedidainsumoLogisticaDB`, `VentainsumolocalLogisticaDB`, `ImpuestocompraproductogeneralinsumoLogisticaDB`

---

## 9. Food Cost

### Endpoints principales

Endpoints distribuidos en varios archivos de rutas:
- `rest/producto`: `POST /producto/actualizarFoodCostCategoriaProducto`, `POST /producto/actualizarFoodCostProducto`
- `rest/common`: `GET /foodcost/obtenerDataFoodCost/{parametros}`, `GET /foodcost/obtenerDataFoodCostCalculosVenta/{parametros}`, `GET /foodcost/obtenerDataFoodCostCalculosCompra/{parametros}`, `POST /foodcost/obtenerDataFoodCostSegregado`, `POST /foodcost/obtenerDataFoodCostSegregadoV2`, `POST /foodcost/guardarDataFoodCost`, `POST /foodcost/guardarProyeccionFoodCost`, `GET /foodcost/obtenerListaFoodCost/{parametros}`, `GET /foodcost/obtenerDataGraficoProyeccionFoodCost/{local_id}/{anio}/{mes}/{tipoProyeccion}`
- `rest/reporteria`: `GET /foodcost/obtenerFoodCostPorCategoria/{parametros}`, `GET /foodcost/obtenerListaReporteFoodCost/{parametros}`, `POST /foodcost/comparativoFoodCostOptimo`

### Controladores responsables
- `FoodcostLogisticaController`

### Modelos y SQL Managers

**Modelos**: `FoodcostLogistica`, `ProyeccionfoodcostLogistica`, `CalculoLogistica`

**SQL Managers**: `FoodcostLogisticaDB`, `ProyeccionfoodcostLogisticaDB`

---

## 10. Homologación

### Endpoints principales

**`rest/homologacion/index.php`** (`HomologacionLogisticaController`)
- `GET /getByItem/{item_tipo}/{item_id}`, `GET /getByItem/{item_tipo}/{item_id}/{presentacion_id}`
- `POST /obtenerCatalogoItems`, `GET /obtener/{homologacion_id}`
- `POST /agregar`, `PUT /editar`, `DELETE /eliminar/{homologacion_id}`

### Controladores responsables
- `HomologacionLogisticaController`

### Modelos y SQL Managers

**Modelos**: `HomologacionLogistica`

**SQL Managers**: `HomologacionLogisticaDB`

---

## 11. Plan de mensajería

### Endpoints principales

**`rest/planmensajeria/index.php`** (`PlanmensajeriaLogisticaController`)
- `POST /agregar`, `GET /obtener/{planmensajeria_id}`
- `GET /iniciarCampaniaEmail/{planmensajeria_id}`, `GET /continuarCampaniaEmail/{planmensajeria_id}`
- `GET /iniciarCampaniaSMS/{planmensajeria_id}`, `GET /continuarCampaniaSMS/{planmensajeria_id}`
- `GET /obtenerDatosGeneralesByPlanId/{planmensajeria_id}`, `GET /obtenerDatosGraficoByPlanId/{planmensajeria_id}`
- `GET /enviarMensajesPaginado/{planmensajeria_id}/{pagina}/{registros}`
- `POST /agregarListadifusion`, `GET /obtenerLista/{parametros}`, `GET /obtenerListadifusion`, `GET /obtenerClientesByListadifusion/{idList}`

**`public/planmensajeria/index.php`** (`PlanmensajeriaLogisticaController`)
- `GET /getLogo/{planmensajeria_id}/{planmensajeriacliente_id}`, `GET /getLogov2/{...}`, `GET /getUrl/{planmensajeria_id}/{planmensajeriacliente_id}/{identificador}`

### Controladores responsables
- `PlanmensajeriaLogisticaController`
- `ClientemkLogisticaController`

### Modelos y SQL Managers

**Modelos**: `PlanmensajeriaLogistica`, `ListadifusionLogistica`, `ListadifusionclienteLogistica`, `ClientemkLogistica`

**SQL Managers**: (sin clases `*LogisticaDB` específicas para este dominio)

---

## 12. Reportes

### Endpoints principales

**`rest/reporteria/index.php`** — orquesta los reportes/exportables; reutiliza controladores de otros dominios.

- Ventas: `GET /venta/obtenerReporte/{parametros}`, `GET /venta/obtenerReporteMargenGanancia/{parametros}`, `GET /venta/obtenerReporteRentabilidadPlato/{parametros}`
- Movimientos: `GET /movimiento/obtenerReporte/{parametros}`, `GET /movimiento/obtenerReporteSumatoria/{parametros}`, `GET /movimiento/obtenerReporteSalidasStock/{parametros}`
- Mermas: `GET /merma/obtenerReporte/{parametros}`
- Inventario: `GET /inventario/obtenerReporteGananciaPorPlato/{parametros}`, `GET /inventario/obtenerInformePorcentajeConsumo/{parametros}`, `GET /inventario/obtenerInformeValorizacionInventario/{parametros}`
- Compras: `GET /compra/obtenerReporte/{parametros}`, `GET /compra/comprasQueHanVariadoEnSusPrecios/{parametros}`, `GET /compra/comprasAgrupadasPorCategoria/{parametros}`, `GET /compra/comprasPorPeriodo/{parametros}`, `GET /compra/comprasAlCredito/{parametros}`, `GET /compra/obtenerInformeRotacionInventarioPorCompras/{parametros}`, `GET /compra/obtenerCostoPromedioPorProveedor/{parametros}`
- Producción: `POST /produccion/produccionEnElTiempo`, `POST /produccion/produccionFueraDeHolgura`, `POST /produccion/mermaEnProduccionGeneral`, `POST /produccion/mermaPorInsumosEnProduccion`, `POST /produccion/mermaHolguraPorProduccionReceta`, `POST /produccion/produccionPorInsumo`, `GET /produccion/obtenerReporteProduccion/{parametros}`, `GET /produccion/obtenerInformeProduccionVsMovimientoWorkplace/{parametros}`
- Food cost: `GET /foodcost/obtenerFoodCostPorCategoria/{parametros}`, `GET /foodcost/obtenerListaReporteFoodCost/{parametros}`, `POST /foodcost/comparativoFoodCostOptimo`
- Movimiento entre almacenes: `GET /movimientoentrealmacenes/obtenerReporte/{parametros}`
- Utilería: `POST /obtenerFiltrosEncodeadosBase64`, `POST /inventario/test`, `POST /batchReportStockCosto`

### Controladores responsables (reutilizados)
- `CompraLogisticaController`, `MovimientoLogisticaController`, `MermaLogisticaController`, `AlmacenLogisticaController`, `PreparacionrecetaLogisticaController`, `LotepreparacionrecetaLogisticaController`
- Core: `MovimientoalmaceninsumoController`, `VentaV2Controller`

### Modelos y SQL Managers

No hay modelos dedicados; el motor de reportes vive en:
- `reportdata/ReportCommon/` (base: `ReportDataSource`, `ReportFilters`, `ReportHeader`, `ParamReport`, `MateriaPrimaBase`, `ReportBlank`)
- `reportdata/ReportDataSourceModule/` (`ReportCompraDataSource`, `ReportMovimientoalmaceninsumoDataSource`, `ReportProduccionDataSource`, `ReportVentaDataSource`)
- `reportdata/Reports/` (`ReporteCompras`, `ReporteStock`, `ReporteProduccion`, `ReporteVentasDeRentabilidadPorPlato`, `ReporteComparativoFoodCostProductos`, etc.)
- `reportslogistica/` (`reportlogistica.php`, `generico/reportegenerico.php`, `generico/reportecsvpedidos.php`)

---

## 13. Común / Transversal

### Endpoints principales

**`rest/common/index.php`** (`CommonLogisticaController` + varios controladores core) — búsquedas, catálogos, configuraciones, gastos, escritorio, reservas de stock, etc. Secciones principales:

- Búsqueda: `POST /busqueda/busquedaSensitivaSegunTipos`, `POST /busqueda/buscarSegunTipoArray`, `GET /busqueda/buscarSegunTipo/{tipo}/{id}`, `GET /busqueda/buscarIngredienteInsumoProducto/{busqueda}`, `GET /busqueda/busquedaUsuario/{busqueda}`, `GET /busqueda/busquedaUsuarioById/{usuario_id}`
- Catálogos: `GET /obtenerCategoriasList`, `GET /obtenerPrevisualizacion/{operacion}/{idOperacion}`, `GET /areaproduccion/getAll/{...}`, `GET /almacen/getAll/{...}`, `GET /banco/obtenerListaBancos`, `GET /caja/*`, `GET /categoriaingreso/lista/{...}`, `GET /categoriaegreso/lista/{...}`, `GET /local/getAll/{...}`, `GET /local/getLocalesPermitidos`
- Proveedores / monedas / impuestos / transportistas: `GET /proveedor/*`, `POST /proveedor/agregarProveedor`, `GET /moneda/*`, `GET /monedafacturacion/*`, `GET /percepcion/*`, `GET /comprobantecompra/*`, `GET /impuesto/*`, `GET /impuestocompra/getAllByLocalId/{...}`, `POST /transportista/*`, `GET /transportista/*`
- Clientes: `GET /cliente/obtenerClienteBusquedaPaginado/{...}`, `GET /cliente/obtener/{cliente_id}`, `GET /cliente/obtenerClienteListByConsumo/{tipoBusqueda}`, `POST /cliente/obtenerClienteListByCRM`
- Configuración: `GET /configuracion/obtenerTodasLasConfiguracionesPorLocalLogeado/{local_id}`, `POST /configuracion/guardarConfiguracion`, `POST /configuracion/actualizarAlmacenDespachoAbastecimiento`, `POST /configuracion/actualizarLocalesProduccion`
- Roles y permisos: `POST /rollogistica/*`, `GET /modulologistica/obtenerModulosPrincipales/{...}`, `POST /rolpermisologistica/*`
- Escritorio / dashboard: `GET /escritorio/obtenerCabeceraGraficosEscritorio/{parametros}`, `GET /escritorio/obtenerCabeceraGraficosAlmacen/{parametros}`, `GET /escritorio/obtenerCabeceraGraficosProduccion/{parametros}`, `GET /escritorio/obtenerResumenProcesosLogisitica/{local_id}/{f1}/{f2}`, `POST /escritorio/obtenerConsumoInsumosProductos`, `POST /calculoproduccion/calcularItemsNecesarioParaPreparacionDePlatos`
- Gastos / ingresos / centros de costo: `GET/POST/DELETE /gasto/*`, `GET/POST /gasto/centrocosto/*`, `GET /gastoseingresos/*`, `GET /periodo/listarPeriodos`
- Reserva de stock: `GET /reservastock/liberarReservaPorOperacionYTipoOperacion/{...}`, `GET /reservastock/liberarStockReservado/{reservastock_id}`, `GET /reservastock/obtener/{reservastock_id}`, `GET /reservastock/obtenerReservastockLista/{parametros}`, `GET /reservastock/obtenerCabeceraListaReservastock/{parametros}`
- Ventas / guía de remisión (consulta): `GET /venta/obtener/{venta_id}`, `GET /venta/recalcularTotalDetalleventa/{venta_id}`, `POST /guiaremision/verificar`, `GET /guiaremision/obtenerGuiaremisionFull/{guiaremision_id}`
- Noticias / usuarios: `POST /noticia/*`, `GET /noticia/*`, `POST /usuario/cambiarLocal`

**`rest/migracion/index.php`** (`CommonLogisticaController`)
- `POST /importarPorCategorias`

**`rest/eventologistica/index.php`** (`EventologisticaController` — core)
- `GET /getAllByBusqueda/{valor_busqueda}/{accion}/{pagina}/{registros}`
- `GET /obtenerListaEventosEntreFechasPorLocales/{fecha_inicio}/{fecha_fin}/{locales}/{tipoevento}/{pagina}/{registros}/{filtroPorModulo}`

### Controladores responsables
- `CommonLogisticaController`
- `ReservastockLogisticaController`
- Core: `ClienteController`, `CompraController`, `ComprobanteController`, `GastoController`, `NoticiaController`, `PeriodoController`, `TarjetaController`, `TransportistaController`, `UsuarioController`, `GuiaremisionLogisticaController`, etc.

### Modelos y SQL Managers

**Modelos**: `EventoLogistica`, `HistoricocambioLogistica`, `LogtablaLogistica`, `DiagramaRelaciones`,
`ReservastockLogistica`, `DetallereservastockLogistica`, `CategoriasalidaLogistica`

**SQL Managers**: `EventoLogisticaDB`, `HistoricocambioLogisticaDB`, `ReservastockLogisticaDB`, `DetallereservastockLogisticaDB`

---

## 14. VCS / LogisticaVCS

### Endpoints principales

**`rest/vcs/index.php`** (`VcsController` — core)
- `POST /sync`

**`rest/logisticavcs/index.php`** (`VcsController` — core)
- `POST /logisticavcs/obtenerDataInicial`, `POST /logisticavcs/obtenerTotalRowTablas`, `POST /logisticavcs/obtenerDataVcs`, `POST /logisticavcs/obtenerUltimosVcs`

**`public/logisticavcs/index.php`** (`VcsController` — core)
- `POST /logisticavcs/obtenerUltimosVcs` (público, con login por formulario)

### Controladores responsables
- `VcsController` (core)

### Modelos y SQL Managers
- Sin modelos ni SQL managers propios de logística.

---

## 15. Ventas (sync)

### Endpoints principales

**`rest/venta/index.php`** (`VentaController` — core)
- `POST /editarSync/{venta_id}`, `POST /editarSyncLote/{venta_id}`, `GET /editarSyncLote/{venta_id}`

### Controladores responsables
- `VentaController` (core), `VentaV2Controller` (core)

### Modelos y SQL Managers
- `VentainsumolocalLogistica` / `VentainsumolocalLogisticaDB` (consumo de insumos por venta)

---

## Anexo: otras carpetas del módulo

| Carpeta | Contenido | Notas |
|---------|-----------|-------|
| `historial/` | `HistorialCompra`, `HistorialGuia`, `HistorialOrdencompra`, `HistorialRequerimientomovimiento` | Registro de histórico por operación |
| `utils/` | `DocumentoCompraIa`, `FormatEntity`, `ToolInsumos`, `UtilityEscribirArchivo` | Helpers / utilidades transversales |
| `reportdata/` | `ReportCommon/`, `ReportDataSourceModule/`, `Reports/` | Motor de reportes (ver §12) |
| `reportslogistica/` | `reportlogistica.php`, `generico/*` | Reportes genéricos / exportables |
| `DefinitionsErrors.php` | Constantes de errores | — |
| `V2reports/` | — | **Excluido del análisis** |

---

## Anexo: discrepancia de nombres (modelo ↔ SQL manager)

Detalles de mapeo no 1:1 que conviene tener presentes:

- `DetallerequerimientoLogistica` (modelo) ↔ `DetallerequerimientomovimientoLogisticaDB` (SQL manager).
- `SolitudmovimientoLogistica` (modelo) ↔ `SolicitudmovimientoLogisticaDB` (SQL manager); el controlador es `SolicitudmovimientoLogisticaController`.
- Modelos sin SQL manager: `CalculoLogistica`, `ClienteLogistica`, `ClientemkLogistica`, `CategoriasalidaLogistica`, `DiagramaRelaciones`, `EmuladorlotepreparacionrecetaLogistica`, `InsumoproductoLogistica`, `ListadifusionLogistica`, `ListadifusionclienteLogistica`, `LogtablaLogistica`, `LotepreparacionrecetaLogistica`, `LoterequerimientoLogistica`, `PlanmensajeriaLogistica`, `RecetaLogistica`, `ResolucionDocumentoCompraIa`.
- SQL managers sin modelo: `CierrecajaLogisticaDB`, `ComprasporpagarLogisticaDB`, `DetallecomprasporpagarLogisticaDB`, `EgresoLogisticaDB`.
