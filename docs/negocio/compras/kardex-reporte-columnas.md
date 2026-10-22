# Reporte Kardex por Movimiento — 14 columnas (pre vs post, inamovible)

> Fuente: `GET /obtenerKardexPorProducto[/Post]` + `kardexGeneralPaginado` (`rest/movimiento:71,75,81` → `MovimientoLogisticaController:1592,1837,2551` → `MovimientoalmaceninsumoV2:1558 parserSecuenciaEntradasSalidasPorFechas`; descargables `informekardex*.php`; precio-anterior en `ReporteCompras:413-571`, `ReportMovimientoalmaceninsumoDataSource:233,650`). `kardexGeneralPaginado` es consolidado por ítem (no por movimiento). El bot analiza **pre (foto anterior) vs post (foto nueva) por cada compra** y valida la matemática fila a fila.

## Columna → fórmula (SQL/código)

| # | Columna | Fórmula | Entrada | Salida |
|---|---|---|---|---|
| 1 | Cantidad | `cantidad` (`:1684,1688`) | `entrada=cant, salida=0` | `salida=cant, entrada=0` |
| 2 | Presentación | etiqueta (`presentacioninsumo_nombre`, `:267-316`) | igual | igual |
| 3 | Costo S/ (sin IGV) | `costosinimpuesto` (`:1789,1801-1802`) | propio (o última entrada si flag) | hereda promedio |
| 4 | Impuestos S/ | `costooperacion − costosinimpuesto` (`:2688-2691,3113-3116`) | impuesto del documento | 0 diferencial |
| 5 | Precio S/ (con IGV) | `costooperacion` (`:1784-1785`) | costo compra (`:1765-1766`) | `=promedio previo` (FIFO=lote) |
| 6 | Precio anterior S/ | `costosanterior` (`:2691,2783,2820`) / `detallecompra_precioanterior` (`ReporteCompras:503`) | foto previa | foto previa |
| 7 | Precio de ingreso S/ | `costoEntradaPorcionamiento` (`:1870-1896`) | propio `costooperacion` | solo porcionamiento |
| 8 | Variación % | `(ingreso−anterior)/anterior×100` (`:1906-1907`; compras `ReporteCompras:539-571` con signo) | calcula | 0 (salvo porcionamiento) |
| 9 | Precio actualizado S/ | `costopromedioactual` (`:1786,1795`) | **recalcula** `(ant×PPP+cant×op)/(ant+cant)` (`:3304-3307`) | hereda |
| 10 | Stock anterior | `stockanterior` (`:2692,2784,2897,3289`) | antes de sumar | antes de restar |
| 11 | Cantidad ingreso | `entrada` (`:1688`; porcionar `:1867-1876`) | >0 | 0 |
| 12 | Nuevo stock | `saldoactual` (`:1701,1713-1752,1793`) | `ant+entrada` | `ant−salida` |
| 13 | Stock valorizado S/ | `costopromedioactual × saldoactual` (`:1795`; sin-imp `:1801`) | prom-nuevo×saldo-nuevo | prom×saldo-nuevo |
| 14 | Stock actual | `stockFinal` cabecera (`:1869-1896`, `informekardex:92`) | foto a `fecha_fin` (igual toda fila) | igual |

## Entrada con merma automática (compra/guía de insumo con % merma)

Condición doble: `tieneMermaAutomatica()` = `mermaporcentaje>0` **y** `mermaautomaticaalcomprar==SI` (`InsumoLogistica.php:697-700`; solo `ENTRADA_COMPRA/GUIA`, `PresentacioninsumoLogistica.php:119-137`). Mecánica (`:212-225`, `:227-243`, `InsumoLogistica.php:799-833`):
* `merma = cantidad × %/100` (en unidades de presentación).
* Costo **encarecido**: `costoUnit = (cantidad×costo)/(cantidad−merma)` (100 %→0) — el valor total se conserva y se reparte entre las unidades netas.
* Se genera fila `merma/detallemerma` + movimiento `SALIDA_MERMA_AUTOMATICA_COMPRA` (o `_GUIA`) enlazado al detalle (`detallecompra_mermaid`), y la ENTRADA usa cantidad neta para el PPP (`MovimientoalmaceninsumoV2.php:2963-2966`: `cantidadParaCalculo = cantidad − merma`).

Efecto en las 5 columnas (ejemplo Pollo QA: stock S, compra 100kg @10, merma 5 % → merma 5kg, costo encarecido 10.526):
* Fila ENTRADA: Stock anterior=S; Cantidad=100 (bruta pactada); Nuevo stock=S+100; Precio=10.526; PPP=(S×PPP+95×10.526)/(S+95)=(S×PPP+1000)/(S+95); Valorizado=PPP×(S+100).
* Fila SALIDA merma: Cantidad=5 @costo 0 (no toca PPP); Nuevo stock=S+95; Valorizado=PPP×(S+95).
* Stock actual (cabecera) = S+95 neto.
El bot verifica: 2 filas (ENTRADA + SALIDA_MERMA_AUTOMATICA_*), `detallecompra_mermaid` seteado, PPP con denominador neto, y neto final. Anular la compra anula también la merma (`DetallecompraLogistica.php:725-727`).

## Protocolo bot (pre vs post por compra)

1. Pre: leer fila anterior (`saldoactual, costopromedioactual, costopromediosinimpuesto`) + cabecera `stockFinal`. 2. Registrar compra. 3. Post: última fila del Kardex del ítem/almacén y asserts: `stockAnterior==pre.saldo`, `cantidad==cantBase UM`, `precio==costoOp`, `precioActual==PPP(pre,cant)`, `nuevoStock==ant+cant`, `valorizado==PPP×nuevo`, `sinImp` en paralelo, `variación` vs anterior; `stockActual` cabecera == último `saldoactual`. Anulados (`fueeliminado=SI`) no mueven stock: se saltan en la secuencia.
