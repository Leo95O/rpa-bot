# Guía de Compra — Mapeo Integral (recepción física + Kardex)

> Entidad: `guia` + `detalleguia`. Idea humana: la guía es el **documento de recepción física** — separa lo físico de lo contable. Al registrarse **sí suma stock** (`ENTRADA_GUIA`) para que la cocina opere sin esperar la factura; la Compra después asienta deuda e impuestos. Evidencia: `C:\xampp\htdocs\webapp\logistica` (`rest/guiacompra`, `GuiaLogisticaController`, `GuiaLogistica`, `DetalleguiaLogistica`) + `logisticaview/.../guiacompra/nuevaguia`.

## 1. Las dos formas de nacer

### 1.1 Desde cero (manual)
`POST /guardarGuia` (`rest/guiacompra/index.php:20` → `GuiaLogisticaController.php:43-77 guardarGuia`). Payload `{guia:{...}, productos:[...]}` (`nuevaguia.controller.js:655-686`, detalle `guia.js:353-438`):
* Cabecera: `guia_documento='Guia de compra'`, `guia_serie + guia_numeroguia` (bot: sufijo `Date.now()` por `existeGuia`), `proveedor_id`, `local_id/almacen_id`, `moneda_id + guia_tipocambio`, `guia_fechaemision (YYYY-MM-DD HH:mm:ss)`, totales (`guia_total/subtotal/igv/descuento` desde `calcularTotalesPorDetalle`, `guia.js:235-298`), `guia_porcimpfiscalizado` (10/18), `ordencompraList=[]`, `tipoDespacho`, `movimientoEmulacionGuiaList` (emulador, no persiste).
* Detalle por línea: `detalleguia_descripcion/cantidad/costo/descuento/importe(=cant×costo−desc)/afectoigv`, `producto_id` o `insumo_id+presentacioninsumo_id(+presentacioncompraproducto_id)`, `almacen_id`, `fechacaducidad`, `numlote`.
* Backend `procesarObjetoGuia` (`GuiaLogistica.php:235-295`): clona, normaliza moneda/versión; `detalleGuiaParser` (`:381-420`) inyecta `serienumero, usuario, guia_id, fechas, local, alteraStock, tipocambio`, normaliza afecto `SI/NO`.

### 1.2 Desde OC (canje)
Preview `POST obtenerOrdenesCompraAImportar([ids], local_id)` (o `...ByDistribucion/{local_id}`, `:32-33` → `Controller:568-642` → `OrdencompraLogistica.php:623-692`): solo OCs `ACEPTADA/PROCESADA_DISTRIBUCION/ENPROCESO`; con distribución filtra por local y **reprorratea** `precio=round(orig/cant×cantLocal)`, `cantidad=cantLocal` (`:683-691`); descuenta lo ya canjeado en guías/compras (`:927-970`); unitarios `item_precio=precio/cantidad` (`:729-733`).
Al guardar con `ordencompraList=[ids]`, `registrar()` (`GuiaLogistica.php:302-334`) escribe vínculos (`actualizarOrdenesCompras`, `:462-602`): con distribución marca `distribucion.guia_id + estado TOTAL(1)/PARCIAL(2)`, OC→`PROCESADA(2)` o `PROCESADA_DISTRIBUCION(6)`; sin distribución OC→`PROCESADA` o `ENPROCESO(7)` si parcial; con 1 OC compara cantidades para decidir completo (`:544-585`).

## 2. Validaciones (literales)

Backend `GuiaLogisticaValidator.php`: lista vacía (`"La lista de productos y/o insumos está vacía."`, `:202`), eliminar todo (`"Estas tratando de eliminar..."`, `:198`), cantidad/costo (`"Existe un problema con la cantidad o costo del item: X"`, `:182-184`), sin almacén (`"El item: X no cuenta con un almacen seleccionado."`, `:189`), UM incompatible (`:178`), almacén de otro local (`:139-155`), duplicado serie+número+proveedor (`"La serie y número del documento de este proveedor ya fueron registradas con anterioridad."`, `:214` + `Controller:120,392`), >90 días (`DIAS_MAXIMO_ANULACION=90`, `:10`), Kardex posterior solo productos (`"El producto de la posición N, ya ha sido usado para otra operacación..."`, `:301`), cuadre posterior (`:554`), merma vinculada (`Controller:750`: `"...anule la salida de stock cod: ..."`).
Frontend `guia.js:441-461`: `"No se han encontrado detalles de guía."`, `"Selecione una fecha valida..."`, `"No ha seleccionado un proveedor."`, `"...costo 0."`; duplicado verificado antes de guardar (`nuevaguia.controller.js:498-510`: `'Los datos de esta guía ya han sido registrados'`).

## 3. Matemática (corazón del bot)

1. **ENTRADA_GUIA sí mueve stock y PPP** (`DetalleguiaLogistica.php:65-78,604-708`): por línea `importe=cant×costo−desc` (`:56-63`); costo con TC/descuento (`:730-746`); conversión a UM base (`PresentacioninsumoLogistica.php:140-164`); `incrementarStockPorCompra(ENTRADA_GUIA, costoUMBase, cantBase, ...)` → PPP `((stock×PPP)+(cant×costoOp))/(stock+cant)` (`MovimientoalmaceninsumoV2.php:791-795`), paralelo sin-impuestos (`:2475-2480`).
2. **Desgrava al guardar** (`GuiaLogistica.php:1300-1352`, `calcularAPartirDelTotal=false` siempre): `CalculoLogistica.php:6-164` — afecto: `sinImp=unit/(1+%IGV fiscalizado)`; inafecto: `sinImp=unit, imp=0`. Frontend no calcula IGV (`guia.js:241`, totales solo informativos).
3. **Merma automática** solo si `insumo.tieneMermaAutomatica()` (`PresentacioninsumoLogistica.php:121-132`): `merma=cant×%`, `costoUnit=(cant×costo)/(cant−merma)`; registra `SALIDA_MERMA_AUTOMATICA_GUIA` (`InsumoLogistica.php:820-833`, `detalleguia_mermaid`).
4. Consumibles van al espejo igual que en compra (misma bifurcación `esConsumible`).

## 4. Relación guía→compra (y viceversa)

* Compra vincula guías al registrar (`CompraLogistica.php:638,1059-1075 actualizarGuiasEnCompra`: `guia.compra_id + guia_porcompra=SI`); lectura `GET obtenerGuiasVinculadas/{compra_id}` (`:92`); pendientes `compra_id is null and estado!=INACTIVO` (`GuiaLogisticaDB.php:314`).
* Anular compra con guías vinculadas **no** descuenta su propio stock (`:2589-2599`, `_descontarStockAGuiasVinculadas` comentado) y libera guías (`compra_id=null, porcompra=0`, quedan ACTIVAS, `:2604,1393-1400`).
* **Anular guía NO toca la compra**: deja `compra_id` huérfano apuntando a guía INACTIVO (sin validación que lo impida). Asimetría documentada: compra→guía libera; guía→compra no avisa.

## 5. Replicación bot (matriz mínima)

G-0 manual (sin OC, sufijo `Date.now()`, afecto 18 %: `costo=bruto`, `valorsinimp=bruto/1.18`, `importe`, stock+PPP) · G-distribuida desde OC (cantidades por local + prorrateo) · G-parcial (OC→ENPROCESO, saldo re-importable) · G-exonerada (sin==costo) · G-consumible (espejo) · Negativas: lista vacía, costo 0, sin almacén, duplicado serie/número, UM incompatible. Oráculo: `obtenerStockYCosto[].costo` tras guía (el Kardex ya se movió) + auditoría `detalleguia_costo/valorsinimpuestos/cantidad/importe`.
