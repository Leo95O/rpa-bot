# Reporte Técnico — Reglas de Kardex para la Matriz E2E Masiva (Insumos / Consumibles / Productos)

> Fuente: PHP en `C:\xampp\htdocs\webapp` (`logistica/` + `api/`). Solo reglas, fórmulas y literales. Sin casos de prueba.

---

## 1. Aprovisionamiento Solicitud → OC → Compra

### 1.1 Entrada al Kardex por tipo de ítem

**Regla: el Kardex distingue por `presentacioninsumo_id / producto_id / presentacioncompraproducto_id`, no por `item_tipo`.** El mapeo es (`api/definitions.php:964-974`, `OrdencompraLogisticaController.php:1510-1514`):

- `item_tipo=1` = Insumo **y** Consumible/Activo/Descartable (subtipos 5/6 por `TIPOINSUMO_CONSUMIBLE/ACTIVO`); `item_tipo=2` = Producto de reventa.
- Ramas de entrada en compra (`api/entity/Detallecompra.php:129-169`, `DetallecompraLogistica.php:77-186`):
  - `_esUnaPresentacionInsumo()` → `Insumo::incrementarStockPorCompra(ENTRADA_COMPRA…)` (`:469-470`).
  - `_esUnProducto()` → `Producto::incrementarStockPorCompra(ENTRADA_COMPRA…)` (`:514-515`), con `producto_controlstock != SI ⇒ return` sin tocar Kardex (`Producto.php:2752-2766`).
  - `_esPresentacionCompraProducto()` → cantidad `× presentacioncompraproducto_cantidad`, costo `/ cantidad` (`:526-539`).

**Diferencia Consumible (la única estructural): tabla espejo.** Si `insumo.insumo_consumible='1'` (`InsumoLogistica.php:6202-6210 `esConsumible()`), el movimiento va a **`movimientoalmacenconsumible`** (`MovimientoalmacenconsumibleV2`, constantes invertidas `TIPO_PRODUCTO=1, TIPO_INSUMO=0` en `:25-27`) en vez de `movimientoalmaceninsumo` (`InsumoLogistica.php:6212-6237 registrarMovimientostock()`, `:6239-6274 actualizarMovimientostock()`; anulación `DetallecompraLogistica.php:735-754`). Consecuencia para el oráculo: el stock/costo de un consumible **no se lee** en `obtenerStockYCosto` ni en `movimientoalmaceninsumo`; hay que consultar la tabla espejo (y `Utility::existeMovimientosPosteriores` conmuta tabla por `item_subtipo==TIPOINSUMO_CONSUMIBLE`, `Utility.php:8086`).

### 1.2 Vínculos del canje

`requerimientocompra.ordencompra_id` + estado `REQUERIMIENTOCOMPRA_CANJEADO` + pivote `ordenrequerimientocompra`; `ordencompra.compra_id / guia_id` + estados `PENDIENTE/PROCESADA/ENPROCESO/ANULADA`; `compra.ordencompra_id` (FK) y `guia.ordencompra_id`. Al canjear: `$ordencompra->setCompra_id(…); setOrdencompra_estado(ORDENCOMPRA_PROCESADA)` (`CompraLogistica.php:1256-1260`; espejo en `GuiaLogistica.php:498-511`).

### 1.3 Literales de bloqueo (JSON `mensajes[]`)

Anular OC ya canjeada (`smart/validators/OrdencompraLogisticaValidator.php:93-127`):
- `:119` `"No se puede anular una orden canjeada por una compra."` (tiene `compra_id`)
- `:126` `"No se puede anular una orden canjeada por una guia."` (tiene `guia_id`)
- `:100` `"No se puede anular la orde de compra por que ya ha sido procesada."` (sic)
- `:96` `"No se puede anular la orde de compra por que ya fue anualada."` (sic)
- `:88` `"No se puede anular una orden por que la solicitud de compra #X esta asociada a mas ordenes de compra."`

Registrar OC desde solicitud (`:140-154`): `"El requerimiento con codigo $id ya tiene una orden de compra con codigo … vinculado."`, `"… ha sido anulado."`, `"… aun no ha sido aprobado."`, `"… ya ha sido canjeado."`, `"… ha sido agrupado."`, `"… no es valido."` Anular solicitud convertida: **sin bloqueo** (`RequerimientocompraLogisticaValidator.php:75-79` retorna vacío; el freno está del lado OC).

Anular compra (`CompraValidator.php:68-111` / `CompraLogisticaValidator.php:86-99`): `"La compra tiene más de X días registrada."`, `"La compra tiene productos o insumos que ya han sido procesados."`, `"La compra es al crédito y tiene cuotas pagadas"`, `"La compra … se realizo con dinero de caja, es necesario tener una caja abierta…"`, `"La compra ya fue anulada."`, `"No se puede anular: el lote de esta compra ya tiene salidas registradas (stock consumido). Reviértalas antes de anular."`, `"El item de la posicion N tiene su lote ya consumido o movido a otro almacen. Anula primero esas salidas/movimientos…"`.

---

## 2. Anulaciones cruzadas y stock negativo

### Regla: el backend **ejecuta y permite el negativo (-5)**. No hay validador de saldo en la ruta de anulación.

Evidencia encadenada para el escenario 40 FL→SUC + merma 5 + anular traslado:

1. **Endpoint real**: `POST /anularMovimmiento` (doble `m`, `rest/movimiento/index.php:34,229-234`). El `GET /anularMovimiento/{id}/{devolverStock}` (`:22,152-156`) apunta a un método inexistente en el controlador (roto; no usar).
2. **Única guarda**: `mermaList = obtenerMermaVinculado()` = mermas con `merma.movimiento_id = movimiento_id` **y** `merma_estado=ACTIVO` (`MovimientoLogistica.php:136-142`). Una merma posterior independiente en Sucursal no vincula → no bloquea. Si vinculara: `"El movimiento esta vinculado a una salida de stock, para poder anular el movimiento primero anule la salida de stock cod: …"` (`MovimientoLogisticaController.php:1011-1083`, espejo en `:712`).
3. **Sin check de stock**: `MovimientoValidator::_validateAnular` tiene el chequeo de movimientos posteriores **desactivado con `false &&`** (`api/validators/MovimientoValidator.php:49-70`; el mensaje `"El movimiento tiene productos o insumos que ya han sido procesados."` es inalcanzable; en `_validateModificar:84` sí está activo). `movimientoTieneErrores()` (`MovimientoLogistica.php:1260-1286`) solo mira guías/requerimientos/cuadre/fecha, nunca saldo.
4. **Reversión lógica, no contra-movimiento**: `MovimientoLogistica::anular()` (`:360-383`) marca `movimiento_estado=INACTIVO` + `anularMovimientosPorMotivoYMotivoID(SALIDA/ENTRADA_MOVIMIENTO, id)` (ambas tablas, insumo y consumible) → cada kardex se marca `fueeliminado=SI` y se recalcula hacia adelante (`MovimientoalmaceninsumoV2.php:359-399,502-505,2182-2191`). Resultado del escenario: Sucursal `0 − 5 = -5` en `saldoactual`. (El motor viejo sí insertaba `SALIDA_ANULAR_MOVIMIENTO` — `api/entity/Movimiento.php:344-352` — pero V2 ya no.)
5. **El flag de negativo es opt-in y no aplica a anulaciones**: `operacionRestringidaPorStockNegativo=true` solo si `CONFIGURACION_RESTRINGIR_SALIDAS_SI_NO_HAY_STOCK` está activa por local (`MovimientoalmaceninsumoV2.php:3322-3341`; descripción en `ConfiguracionController.php:2324`), y `anular()` jamás lo consulta. Éxito: `"Se anulo con exito el movimiento."`; ya anulado: `"El movimiento esta anulado."`; inexistente: `"Error, no fue posible encontrar el movimiento que desea anular."`.

Mismo patrón al anular merma/salida (`MermaLogistica.php:130-155`, validator `:49-60`): solo antigüedad (`"La merma tiene más de X días registrada."`); el check de stock (`"La merma tiene productos o insumos sin stock."`, `:65-115`) está comentado y era solo de registro. Éxito: `"Merma Anulado con exito"` (sic, `:252`).

---

## 3. Matemática de ajustes: el costo se congela en salidas

### Regla: **ninguna SALIDA recalcula el PPP; solo debita cantidad con costo 0.** Solo las ENTRADAS (y el cuadre tipo `TIPO_CUADRE` con cantidad > 0) promedian.

- `Insumo::disminuirStock` (`api/entity/Insumo.php:424-425`) y `Producto` (`:2005-2006`) llaman `parser(…, cantidad, 0, motivo, …, DISMINUYE_STOCK)`; `Detallemerma` fija `detallemerma_costo = 0` (`:175,300`).
- `_registrarPonderado` rama `TIPO_SALIDA` (`MovimientoalmaceninsumoV2.php:208-213`, espejo `:329-334`, consumibles `:178-183`): `costooperacion=0, saldoactual=0, costopromedioactual=0`. Stock = `Σentradas − Σsalidas` (`:1143`).
- Fórmula PPP, **solo rama ENTRADA** (`:789,899-901`; preview `Insumo.php:1212-1215` con `round(…,8)`):
  `nuevoPPP = ((stockAnt × PPPant) + (costoOp × cantOp)) / (stockAnt + cantOp)`.

### Cuadre de stock (`CuadremanualLogistica.php`)

- **Sobrante** (aumento): entra a `costoNuevo` digitado, o `costo` de grilla, o PPP vigente (`obtenerCostoOperacion:532-556`) vía `ENTRADA_REGULAR_STOCK_MANUAL` + `TIPO_CUADRE` (`:594-602,964,1057-1058`); el motor fija `costopromedioactual = costooperacion` (`MovimientoalmaceninsumoV2.php:229-250`). Un sobrante **sí mueve el PPP** (entra como compra al costo declarado).
- **Faltante** (disminución, `:1384,1488-1628`): doble movimiento — (1) `SALIDA_MERMA_CUADRE_STOCK` por la diferencia (costo a 0, no toca PPP) + (2) `SALIDA_REGULAR_STOCK_MANUAL` de **cantidad 0** con `TIPO_CUADRE` que solo fija/revaloriza costo si `costo != costoNuevo` (si son iguales, no altera nada, `:702-704`). El costo queda en `detallecuadremanual_costopromedio` (`:1626`).
- Arqueo (`ArqueoinventarioLogistica.php:669,698,1079,1118`) solo lee y notifica; el ajuste real lo emite Cuadre. Sincronización DIAN/POS (`SincronizacionrecepcioncompraLogistica.php`) no toca stock/costo.
