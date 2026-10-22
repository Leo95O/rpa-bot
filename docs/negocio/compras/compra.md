# Compra — Mapeo Integral (factura, Kardex definitivo, deuda)

> Entidad: `compra` + `detallecompra` (+ `comprasporpagar`, `notacreditocompra`). Idea humana: la compra es el **documento maestro** — factura/boleta que recalcula el costo promedio definitivo, deduce impuestos y genera la deuda (contado/caja o crédito en cuotas). Evidencia: `C:\xampp\htdocs\webapp\logistica` (`rest/compra`, `CompraLogisticaController`, `CompraLogistica`, `DetallecompraLogistica`) + `logisticaview/.../compra/nuevacompra`.

## 1. Formas de nacer

### 1.1 Manual
`POST /agregarCompra` (`rest/compra/index.php:21` → `Controller:29-67 registrar`). Payload `{compra:{...}, productos:[...], cuotas:[...]}` (`CompraLogistica.php:431-491 procesarObjetoCompra`): `compra_tipodoc/seriedoc/nrodoc` (bot: `numero-Date.now()` por `existeCompra`), `proveedor_id`, `compra_fecha` **vs** `compra_fechatributacion` (dualidad: operativa vs fiscal), `moneda_id/tipocambio`, `local_id/almacen_id`, `impuestos incluidos SI/NO` (`generoimpuestossobretotal`), `compra_ordencompraList[]` / `compra_guiaList[]` (canjes), `cuotas[]`, `avancecompra_id`, `movimientoEmulacionCompraList`. Frontend `nuevacompra.controller.js:1929-1994` (`fnGuardarCompra`): fechas `YYYY-MM-DD HH:mm:ss` (tributación sync con compra al inicio), percepciones, cuotas `DD-MM-YYYY→YYYY-MM-DD`, impuestos de compra.

### 1.2 Desde OC / Guía
`compra_ordencompraList[]` → `actualizarOrdenesCompras()` (`:1246`: `compra_id + PROCESADA`, parcial→`ENPROCESO`, repara `precio!=costo×cantidad`); `compra_guiaList[]` → `actualizarGuiasEnCompra()` (`:1059-1075`: `guia.compra_id + porcompra=SI`, re-alinea `detalleguia_costo/valorsin/importe` y re-entra stock `incrementarStockGuia(true)`). Preview con `obtenerOrdenesCompraAImportar` / `obtenerGuiasDeCompraAImportar` (prorrateo + descuento de canjeado, ver `orden-compra-importar.md`).

## 2. Inicialización y registro (`CompraLogistica.php:230-692`)

`inicializar()`: `estado=ACTIVO, fecha=now, usuario, pendienteprocesarstock=SI, local, esalcredito=NO default, tipo=NORMAL/SERVICIO, IGV fiscalizado`. `registrar()`: posible `alteraStock=NO` (config entradas/salida o `conguia==SI` — si viene de guía, el físico ya entró), tipocambio, comprobante interno, `docvinculado=|guias|+|ordenes|`, `insert()`, `detalleCompraParser()` (inyecta tipocambio/comprobante/serie/fecha/local/usuario + último precio + afecto SI/NO, `:844-906`), `calcularImpuestosDeLosDetallesDeUnaCompra()`, `registrarDetallecompra()`, vínculos guías/OCs, `generarCuotasCredito()` si crédito, `generarEgresoCaja()` si contado-caja, `aumentarStockPorCompraPendiente()`.

## 3. Validaciones (literales)

`CompraLogisticaValidator.php`: duplicado (`existeCompra` tipodoc+serie+nro+proveedor+activo): `"La serie y número del documento de este proveedor ya fueron registradas con anterioridad."` (+ pre-chequeo `"El documento X S-N ya ha sido registrado con codigo y fecha: ..."`, `"Proveedor es requerido"`); serie/número requeridos (`"La serie y número de la compra es requerida..."`, interno `"-"`); lista vacía/eliminada/cantidad-costo/almacén/UM (mismos 5 literales que guía); fecha (`"La fecha de la compra no es valida."` — exige `YYYY-MM-DD HH:mm:ss`); almacén del local (`"El almacen seleccionado con ID: X, para las compras debe pertenecer al local actual."`); moneda (`"La compra debe tener una moneda válida..."`); crédito sin cuotas (`"La compra al credito no cuenta con cuotas de pago"`); caja (saldo insuficiente, no aperturada, sin caja); pagos (`"El monto pagado es insuficiente..."`, `"Los montos de pago... no coinciden..."`).

## 4. Matemática (corazón del bot)

1. **ENTRADA_COMPRA** (`DetallecompraLogistica.php:77-176`): `importe=cant×costo`; costo unitario `(costo×cant−desc)/cant [+fleteUnitario]` con `fleteTotal=totalItem/totalDetalle×flete` (`CompraLogistica.php:698-717`); `costoTC=unit×tipocambio`, `sinImpTC=sinImp×tipocambio` (`:416-449`); conversión a UM base + merma auto (`PresentacioninsumoLogistica.php:112-164`); `incrementarStockPorCompra(ENTRADA_COMPRA, costoBase, cantBase, ...)` → PPP estándar; config Kardex `{idmotivo=compra_id, referencia="COMPRA, doc serie-num", fechaparakardex=compra_fecha}`.
2. **Desgravación definitiva** (`:2177-2276`, `CalculoLogistica.php:6-164`): por línea `costosin=costoSinImpuestos; costo=precioConImpuestos; precio=costo; importe=costo×cant` (`:2254-2257`). No-dinámico afecto: `sin=costoUnit/(1+%IGV fiscalizado)`, `imp=sin×%×cant`; inafecto: `sin=unit, imp=0`; flag `calcularAPartirDelTotal` (precio sin impuestos) invierte la base. Totales V3 (`:2039-2084`): `subtotal=Σsub, igv=Σimp, total=Σtot`.
3. **Crédito/caja**: `generarCuotasCredito()` (`:1421-1446`: `comprasporpagar(compra_id)` por cuota + `proveedor.limitecredito−=total`); contado-caja `generarEgresoCaja()` (`:1452`: efectivo/tarjeta/cheque→egreso); front valida `pagado+debe+retención==total` con interés por cuota (`valorCuota=round(deuda/n)`, máx 10, fechas proveedor o +meses).

## 5. Replicación bot (matriz mínima)

C-0 contado manual afecto (PPP+desgravación+importe, `assertDetalleCompraSinImpuestos`) · C-exonerada (sin==costo) · C-desde-OC (último precio, vínculo PROCESADA) · C-desde-guía (`conguia==SI`, `alteraStock=NO`, re-alineación) · C-crédito N cuotas (CxP + límite proveedor) · C-caja (egreso) · Negativas: duplicado, sin proveedor, lista vacía, fecha mala, almacén ajeno, crédito sin cuotas, caja sin saldo. Oráculo tras cada alta: `obtenerStockYCosto[].costo` + auditoría detalle.
