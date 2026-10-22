# Nota de Crédito de Compra + Cuentas por Pagar

> Rutas `rest/compra/index.php:124-133` (`notacreditocompra/*`, `comprasporpagar/*`) → `CompraLogisticaController:2513-2712,2814-3660`. Modelo `NotacreditocompraLogistica.php`.

## 1. NC: dos ramas mutuamente excluyentes (`definitions.php:201,2444-2452`)

| | `DESCUENTO_CANTIDAD(1)` (devolución) | `DESCUENTO_PRECIO(2)` (rebaja) |
|---|---|---|
| Cuándo | `esPorDescuentoEnItems!=SI`, `retornostock==SI` (default) | `esPorDescuentoEnItems==SI` |
| Detalle | `tipo=1, precio=costo original` | `tipo=2, precio=montodescuento, cantidad=cant.original` |
| Kardex | **SALIDA** `SALIDA_NOTA_CREDITO_COMPRA(32)` por `cant_present×cant_nota` (6 decimales), costo 0 → **baja stock, congela PPP** (`:406-533`) | **Sin salida**; clona la `ENTRADA_COMPRA` origen (`fueliminado=SI`), inserta clon `+1s` con `nuevoCosto=(importeOrig−desc×cant)/cantIngreso`, `sinImp=null`, y `regularizarEntradasDesdeID()` (`:224-404`) → **re-baja el costo sin tocar stock** |
| Servicios (`compra_tipo==2`) | sin Kardex en ambas (`:196-198`) | igual |
| Anular NC | revierte salida (`fueliminado=SI` + regulariza → sube stock, `:572-575`) | restaura clonando con costo original + elimina intermedio (`:612-661`) |
| Anular NC y CxP | reconstituye cuotas (`valorCuota=total/n`, rellena pendientes, `:2596+`) | igual |

Validaciones (`NotacreditocompraValidator:41-252`): ya anulada, tipo inválido, sin detalles, compra inválida, cantidad 0 / ajuste 0 / sin modificados, ítem ajeno (`"...no pertenece a la compra."`), devolución > comprada (`"...excede la cantidad comprada (Y)."`), acumulado > original, **fecha NC < compra o > hoy** (`:189`). Éxito `"Se registro correctamente"`; anular `"Se anulo correctamente"`.

## 2. CxP (`comprasporpagar`)

Compra `esalcredito==SI` → `generarCuotasCredito()` (`CompraLogistica.php:1421-1446`): una fila por cuota (`totalcuota, diapago, interes, amortizacion=0, estado=pendiente`) + `proveedor.limitecredito−=total` (estados `1 pend/0 pagada/2 amortizada/3 anulada`, `definitions:3632-3650`). Modificar compra **borra y re-genera** cuotas. Front: `debe=total−pagado−retención` (cero si abono excede + warn), `interés=debe×%/100`, `cuota=round(deuda/n)` (máx 10), fechas proveedor o +meses.
Amortizar (`POST agregarAmortizacion`, `:3406+`): reparte `pagocon` por cuotas (`min(saldo, resto)`), inserta `detallecomprasporpagar` (forma de pago 1-5, caja si aplica + egreso), cierra cuota si `amortizacion>=totalcuota`, restaura `limitecredito+=pagocon`. NC con crédito amortiza pendientes (`deuda=totalcuota−amortizacion`, `desc=min(cuota, deuda)`; si salda, `INACTIVO`). Deuda `=totalcuota−amortizacion`. Literales: `"Deuda no encontrada"`, `"Seleccione una caja valida."`, caja no aperturada/sin saldo, `"Guardado"`, `"Cuota Cod. X: ..."`.

## 3. Relación con compra/guía/OC

* NC cuelga de **compra** (`compra_id`); anular compra anula sus NCs. NC-cantidad baja el stock que subió la `ENTRADA_COMPRA` (o la guía si hubo); NC-precio re-escribe el costo que la compra promedió (el PPP se recalcula hacia adelante vía `regularizarEntradasDesdeID`).
* NC con crédito reduce deuda (amortización inversa); anular NC la reconstituye.
* El listado de compras salta líneas `DESCUENTO_PRECIO` (`Controller:784`) al resumir — el bot no debe sumarlas como ítems.

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| NC1 | `registrar` cantidad (devolver N<u) | `SALIDA_NOTA_CREDITO_COMPRA` por N, stock −N, PPP congelado |
| NC2 | `registrar` precio (rebaja D c/u) | clon +1s con `nuevoCosto`, origen `fueeliminado`, stock igual |
| NC3 | Devolver > comprado / acumulado > original / fecha NC < compra o > hoy / ítem ajeno | literales respectivos |
| NC4 | `anular` NC cantidad/precio | stock restaurado / costo original restaurado; cuotas reconstituidas |
| CX1 | Compra crédito N cuotas → amortizar parcial/total | `amortizacion`, cierre de cuota, `limitecredito` sube, egreso si caja |
