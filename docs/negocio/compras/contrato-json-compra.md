# Contrato JSON de Compra — campo por campo verificable

> Cubre `agregar/actualizarCompra` (request) y `obtenerCompra` (response). Cada campo: fórmula o tabla + assert del bot. Base: `CompraLogistica.php:431-491,844-906,2177-2276`, `Controller:29-209`, `nuevacompra.controller.js:1929-1994`.

## 1. Request `{compra, productos[], cuotas[]?}`

| Campo | Origen / regla | Assert |
|---|---|---|
| `tipodoc/seriedoc/nrodoc` | tipodoc de comprobante; serie/nro únicos por proveedor (`existeCompra`, `Validator:685-696`); bot sufija `Date.now()`; serie/nro vacíos→`"-"` si "Sin comprobante" (`:2475-2482`) | duplicado → `"...ya fueron registradas..."`; pre-check `validarCompraPor...` |
| `proveedor_id` | `proveedorSeleccionado` (requerido, `:250`); serie/nro se validan por proveedor | `"Proveedor es requerido"` |
| `compra_fecha / fechatributacion` | `YYYY-MM-DD HH:mm:ss` (tributación sync inicial, `:597-599`); vacía→now (`:243-245`) | `"La fecha de la compra no es valida."` |
| `moneda_id/tipocambio` | `moneda_tipocambio_compra`; `tipocambio` propaga a detalle (`:868`) | `"...moneda válida..."` |
| `local_id/almacen_id` | local actual default; almacén debe pertenecer al local (`:378-392`) | literal almacén |
| `generoimpuestossobretotal` | `"0"` si precio incluye impuesto (`:1935-1939`) → decide base (bruto `/(1+p)` vs neto `×p`) | — (ver matriz) |
| `esalcredito + cuotas[]` | `SI` exige ≥1 cuota (`:557-567`); `cuota{totalcuota,interes,capital=cuota−interés,diapago,amortizado=0}`, máx 10, `Σcapital==debe` | `"...no cuenta con cuotas..."`, `"...cronograma no coincide..."` |
| `saliodecaja + montoefectivo/montotarjeta/montocheque` | `SI` exige caja + apertura + saldo (`:626-663`); mixto = varios >0 (hasta 3 egresos) | 3 literales caja |
| `percepcion/retencion/flete/icbper` | percepción suma, retención resta pagable, flete prorratea a costo (`:698-717`), ICBPer suma sin línea | — (ver matriz) |
| `ordencompraList/guiaList` | canjes (vínculos + `docvinculado`) | estados resultantes |
| `productos[]` | `cantidad>0`, `costo` numérico, `almacen_id`, UM compatible, `afectoimpuestos` bool→SI/NO (`:900-904`), `ordencompra_id:"-1"` | los 5 literales de lista |

## 2. Response `obtenerCompra` (asserts de lectura)

`{compra{subtotal,igv,total,descuento,flete,icbper,percepcion,retencion,creditopagado,deuda,docvinculado,porcimpfiscalizado,version}, productos[{item_precio/cantidad/descuento,afectoigv,porcImpuestos,almacen,presentacionList,item_precio_original,item_variacion}], impuestoList, listaCuotas{totalCapital/Credito/Amortizado/Interes}, ordencompraList/guiaList, notacreditocompraList+totalNC+devuelta, retencioncompraList}` (`Controller:656-814`, `CompraLogistica:2942-3327`; `paraEdicion=1` pone `precio=sinImp` si precio-neto, `:3200-3203`).

## 3. Fórmulas de cierre (asserts nuevos `assertTotalesCompra`)

`importe=costo×cant−desc` · `sin=bruto/(1+p)` o neto · `sub=Σsin×cant` · `igv=Σsin×p×cant` · `total=sub+igv+flete+icbper+percepción` · `debe=round(total−pago−retención)` · `cuota=round(deuda/n)`, `interésCuota=round(interés/n)`, `capital=cuota−interés` · exonerado: `igv=0`, `sub=total−cargos`.
