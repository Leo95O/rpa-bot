# Compra de Servicio — Mapeo (intangible, sin Kardex de entrada)

> Tipos `definitions.php:2440-2442`: `NORMAL=1, SERVICIO=2, RAPIDA=3`. Rutas `agregar/actualizar/anularCompraServicio` (`rest/compra/index.php:28-29,40` → `Controller:2216-2378,1052-1114`).

## 1. Payload y doble detalle

Mismo parser `{compra, productos, detalles, cuotas}` (`CompraLogistica.php:431-492`); `compra_tipo=SERVICIO` si hay `ordenservicio_id` (`:306-311,413-418`). Propios: `categoriaserviciocompra_id`, `ordenservicio_id` (canje→`ORDENSERVICIO_CANJEADO=4`, `:3648-3653,3773-3778`).
Doble detalle (vs normal con solo `detallecompra`): `listDetalles→detallecompraservicio` (solo `descripcion/precio/estado/compra_id`, sin cantidad/almacén/afecto) + `listProductos→detalleconsumiblecompra` (consumibles del servicio, con cantidad/costo/almacén/presentación). Impuestos propios (`:3855-3884`): precio tratado con-impuesto-incluido, `igv=Σ(precio/(1+p)×p)`, `subtotal=total−igv` (sin prorrateo afecto/inafecto).

## 2. Kardex: solo salidas de consumibles, nunca entradas

`registrarServicio()` (`:3594-3672`) jamás llama `incrementarStockCompra`/`ENTRADA_COMPRA`; cierra con `disminuirStockProCompraPendiente()` (`:3801-3826` → `SALIDA_COMPRA_SERVICIO=39` por consumible, `DetalleconsumiblecompraLogistica.php:88-123`). Edición sin stock salvo consumibles (`:984-1001`); `detallecompraservicio` puro CRUD (`:944-982`). Anular (`:2611-2628`): `INACTIVO` + desvincula orden-servicio + anula movimientos `SALIDA_COMPRA_SERVICIO` solo si `devolverstock==SI`; no toca egresos/NC/guías (el normal sí). Excluida de NC (`NotacreditocompraLogistica:196-198`) y mostrada en negativo en previsualizar (`CommonLogisticaController:1166-1173`).

## 3. Validaciones, CxP, plantillas

Mismo juego que normal **menos** moneda, `formatearDetalleCompra`, notificación electrónica y cuadre; modificación sin tope de días (códigos `REGISTRAR/MODIFICAR_COMPRA_SERVICIO=4/5`, literales idénticos de serie, lista, crédito-sin-cuotas, caja, fecha). CxP/cuotas/egresos idénticos (incluido bloqueo por cuotas pagadas). Anular exige `ANULAR_COMPRA_SERVICIO_LOGISTICA` (`'4'`, `definitions:2830`). Plantillas de orden-servicio: `GET obtenerListaPlantillasDeOrdenServicio/...` (filtros fecha/proveedor/local + `numeroItems`, `PlantillaordenservicioLogistica:11-45`).

## 4. Bot

Casos: servicio con consumibles (verificar `SALIDA_COMPRA_SERVICIO` en espejo/principal, sin `ENTRADA_*`), servicio puro (cero movimientos), crédito+cuotas, anular con/sin devolver. Negativas: serie duplicada, crédito sin cuotas, caja. Asertar que **ninguna** deja `ENTRADA_COMPRA`.
