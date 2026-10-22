# Mapeo de Entidades Maestras — Insumo / Porcionable / Consumible / Producto / Receta

> Fuente: backend `C:\xampp\htdocs\webapp` (`logistica/` + `api/`) y BD `logisticaaa` (MySQL localhost, `restaurant.sql`).
> Propósito: documentar el Modelo de Dominio antes de programar nuevos flujos del bot. Cada sección cita archivo:línea o tabla:columna verificados.

---

## Convención general (vale para las 5 entidades)

* Stack logístico propio: `logistica/rest/{dominio}/index.php` (Slim 3) → `{Entidad}LogisticaController` → `{Entidad}Logistica` (modelo) → `{Entidad}LogisticaDB` (SQL crudo). No usa `base/entitybase` del core (`docs/arquitectura/mapeo-estructural-logistica.md`).
* Contrato red: `BACKEND_LOGISTICA = '/restaurant/logistica/rest/'`, respuesta `{tipo, mensajes[], data}` con `tipo` string (`'1'` SUCCESS).
* Kardex = tablas `movimientoalmaceninsumo` / `movimientoalmacenconsumible` (espejo). Fórmula PPP única en `api/entity/MovimientoalmaceninsumoV2.php:859-938` (`_obtenerCostoPromedio`, ver §6).

---

## 1. Insumo (materia prima regular)

### Tabla + flags
* **Tabla:** `insumo` (`insumo_id` PK, `insumo_codigo`, `insumo_nombre`, `unidadmedidainsumo_id NOT NULL`, `categoriainsumo_id`, `categoriareceta_id`).
* **Es regular cuando:** `insumo_porcionable IS NULL/0 AND insumo_recetabase IS NULL/0 AND insumo_descartable=0 AND insumo_consumible=0 AND insumo_esactivo=0`. Taxonomía canónica en `api/entity/Insumo.php:38-44` (`getTipoInsumoCASE`) y filtros `api/entity/Insumo.php:2689-2708`, `api/entity/Categoriainsumo.php:52-64`, `api/entity/Compra.php:3564-3670` (subtipo 1 = regular).
* Columnas legacy en la misma tabla: `insumo_stockminimo varchar(45)`, `insumo_stockmaximo double`, `insumo_stockideal double`, `insumo_costopromedio double(18,2)` — **informativas, el Kardex vivo está en `almacenproductoinsumo` + movimientos**.

### Impacto en Kardex
* Va a **`movimientoalmaceninsumo`** vía `logistica/models/InsumoLogistica.php:6415-6440 registrarMovimientostock()` (rama no-consumible → `new MovimientoalmaceninsumoV2()->parser()->registrar()`).
* Entrada compra: `api/entity/DetallecompraLogistica.php:108-115` → `Insumo::incrementarStockPorCompra(ENTRADA_COMPRA, costoUnidadMedidaBase, cantidadBase)` → `api/entity/Insumo.php:1009-1063`. **Sí recalcula PPP.** Salidas (merma/movimiento/preparación) a costo 0 congelan PPP (`MovimientoalmaceninsumoV2.php:208-213`).
* Lectura autoritativa: `GET producto/insumo/obtenerStockYCosto/{id}` (`logistica/rest/producto/index.php`, `InsumoLogisticaController`) → campo `data[].costo` (PPP con impuestos).

### Restricciones de flujo
* **Comprar: SÍ.** Ruta `POST compra/agregarCompra` con validación `CompraLogistica.php:1911 validarObjetoDetalleCompra()`. Edición bloqueada si se reduce bajo lo consumido (`DetallecompraLogistica.php:249-315 validarReduccionLoteEdicionIa`, `336-394 tieneLoteConsumidoIa`).
* **Trasladar: SÍ** (`POST movimiento/agregar`, `agregarOrdenmovimiento`). Valida `MovimientoLogistica.php:1220-1396 validarMovimientoParaActualizar`, fecha `1542 validarFechaMovimiento`.
* **Mermar: SÍ** (`POST merma/agregarMerma`, `MermaLogistica.php:343-350`, `DetallemermaLogistica.php:148-153 DISMINUYE_STOCK`).
* **Producir: como ingrediente SÍ** (es descontado por `Preparacionreceta.php:440 disminuirStock(SALIDA_PREPARACION_RECETA_BASE)`); como cabecera NO (eso es Receta).

### Dependencias
* **UM obligatoria** (`unidadmedidainsumo_id` NOT NULL; catálogo `unidadmedidainsumo`, conversión `Unidadmedidainsumo::conversionUnidadMedida`, usada en `Insumo.php:1207-1214`).
* **Categoría insumo** (`categoriainsumo`) para alta; **presentación** (`presentacioninsumo`: `unidadmedida + cantidad + precioaprox + preciomin/max`) — la compra multiplica `cantidad × presentacion_cantidad` a UM base.
* **Control por almacén** (`almacenproductoinsumo`: `controlar, stockminimo/maximo decimal(12,4), costo/costopromedio`). Sin fila con `controlar=1` el ítem "no se controla" en ese almacén (literal blueprint-porcionar §3).

### Peculiaridad
* `insumo_derivadoinsumoid` + `insumo_esderivado` (self-ref) y valor `insumo_porcionable=3` = derivado-porcionable (`InsumoLogistica.php:1398-1400,1491-1493,5317,5753`). El bot debe nulificar la self-ref antes del wipe (`limpieza_bd.sql:126`).

---

## 2. Porcionable (`insumo_porcionable=1`)

### Tabla + flags
* **Tabla:** `insumo` misma fila + flag `insumo_porcionable=1` (rango verificado en `InsumoLogistica.php:3450-3453`, `GuiaremisionLogistica.php:2324,2581`). Prioridad taxonómica 3.ª en `Insumo.php:38-44` (tras derivado y receta, antes que descartable/consumible).
* Config extra: `presentacionresultantereceta` + `descartablepresentacionresultantereceta` (cortes resultantes) y `porcionable/registrarPorcionable` (`rest/producto/index.php:174-175`, `InsumoLogistica: registrarPorcionableLogistica`).

### Impacto en Kardex (matemática propia, `docs/arquitectura/blueprint-porcionar-insumos.md §4`)
* Origen y destinos viven en **`movimientoalmaceninsumo`** (no hay espejo). Asiento triple en `api/entity/Preparacionreceta.php:523-791`: `disminuirStockPorcionable() → obtenerCostoPorUnidadProducida() → obtenerCostoFactor() → loop incrementarStockPorCompra(ENTRADA_PORCIONAMIENTO)`.
* `costoFactor = PPP_origen × cantidad_restar / resultado` (`:871-892`, ejemplo literal `1k+0.5k=(2k*8)=16`). **Todos los destinos reciben el mismo costo unitario**; `valorizado = cantidad_destino × costoFactor` (`:648-660`). El PPP de cada destino luego promedia normal (`Insumo.php:1212-1216`).
* Merma **no encarece**: `resultado = APreparar − merma` (`PreparacionrecetaLogisticaController:973-986`), fila `merma` + `detallemerma` + `SALIDA_MERMA_PORCIONAMIENTO` (motivo 15). Motivos `api/definitions.php:171,192-193`: `ENTRADA_PORCIONAMIENTO=13, SALIDA_PORCIONAMIENTO=16, SALIDA_MERMA_PORCIONAMIENTO=15`.

### Restricciones de flujo
* **Comprar: SÍ** (como insumo normal; el flag no bloquea compra).
* **Trasladar/mermar: SÍ** igual que insumo.
* **Porcionar: SÍ** (`POST porcionamientoreceta/agregarPorcionamientoRecetaPorLote`, validación `Preparacionreceta.php:150-234`: almacén obligatorio, cantidades > 0; frontend exige cuadre exacto salvo UM UNIDAD). **Producir como receta: NO** (no es `recetabase`).

### Dependencias
* Origen debe existir con `porcionable=1` **y** `presentacionesResultantes[]` configuradas; cada destino necesita control en el almacén (`validarAlmacenPorcionable:1852`, `validar:1690-1712`).
* Misma UM-compatibilidad que recetas (`"El insumo resultante X tiene UM incompatible con Y"`).

### Peculiaridad
* El check `guardarFaltanteMerma` (`porcionarReceta.html:56-57`, sin `ng-change`) decide entre hard-stop de cuadre exacto vs. generar merma. El bot debe modelar ambos casos (A OFF / B ON).

---

## 3. Consumible (`insumo_consumible=1`)

### Tabla + flags
* **Tabla:** `insumo` con `insumo_consumible=1` (default 0). Detector `logistica/models/InsumoLogistica.php:6405-6412 esConsumible()` (`insumo_consumible==SI`); lecturas `api/entity/Insumo.php:339,3194`.
* En BD muestra: 1 de 6 filas QA con `consumible=1` (`GROUP BY porcionable,consumible,recetabase`).

### Impacto en Kardex — TABLA ESPEJO
* **Nunca** toca `movimientoalmaceninsumo`. Router `InsumoLogistica.php:6415-6477` → `new MovimientoalmacenconsumibleV2()->parser()->registrar()` (constantes `TIPO_PRODUCTO=1, TIPO_INSUMO=0` invertidas, `:25-27`). Ramas espejo en `Insumo.php:241-247,339-348,376-382`, `DetallecompraLogistica.php:263-297,349-372`, `DetallemovimientoLogistica.php:291-349,523-534`, `DetallemermaLogistica.php:437-473`, `CuadremanualLogistica.php:290-302,1099-1102`, `Utility::existeMovimientosPosteriores` conmuta por subtipo (`Utility.php:8086`).
* Esquema espejo idéntico (mismas columnas `cantidad, costooperacion, costopromedioactual, costosinimpuesto, saldoactual, tipo, fueeliminado...`). **Misma fórmula PPP** en `MovimientoalmacenconsumibleV2.php:36-68,537-614` + `V2FIFO.php:36-68`.
* Consecuencia bot: `obtenerStockYCosto` **no sirve**; oráculo `leerStockConsumible()` calcula `stock = Σentradas − Σsalidas vivas`, `costo = costopromedioactual de última ENTRADA viva` (`src/e2e/oracle.ts:257-292`).

### Restricciones de flujo
* **Comprar: SÍ** (entra por Compras igual; `Compra.php:3564-3670` subtipo 3).
* **Trasladar: SÍ** (doble vía en espejo).
* **Mermar/salida operativa: SÍ** — es su vía típica de consumo (`Almacenes/Salida`, no Producción).
* **Producir/porcionar: NO** como cabecera; como ingrediente solo si la receta lo admite (generalmente no: impacta gasto, no Food Cost teórico).

### Dependencias
* Idénticas a insumo (UM, categoriainsumo, presentacioninsumo, control por almacén). Alta por vista separada `logistica.insumos.consumible.nuevo` (`insumo_consumible='1'`).

### Peculiaridad
* Es la **única diferencia estructural** del Kardex (las demás son flags lógicos). Todo spec nuevo que toque consumibles debe bifurcar lectura/escritura desde el día 1.

---

## 4. Producto (reventa o final)

### Tabla + flags
* **Tabla:** `producto` (`producto_id` PK, `producto_codigo, producto_nombre, producto_stockminimo decimal(12,2), producto_stockmaximo double, producto_costo decimal(14,4), producto_costopromedio double, producto_esingrediente, producto_llevaingredientes, producto_controlstock char(1) def '1', producto_restriccionporstock char(1), producto_escompra varchar(45)`) + `productogeneral` (`productogeneral_tranformado` distingue fabricado vs. reventa).
* Flag maestro: **`producto_controlstock`** — filtros `Producto.php:1602,1633,2543,2550`, `Productogeneral.php:933,975`, `Detalleventa.php:1877`.

### Impacto en Kardex
* Si `producto_controlstock != 'SI'` → **early return, no toca Kardex** (`api/entity/Producto.php:2752-2766 incrementarStockPorCompra`). Si controla → `movimientoalmaceninsumo` (columna `producto_id`, `parser(producto_id,NULL,...)` `:2762`), misma PPP.
* Presentación propia: `presentacioncompraproducto` (`cantidad, precioaprox, preciomin/max`); compra recalcula `cantidad × cantidad_presentación`, `costo / cantidad` (`DetallecompraLogistica.php:526-539,136-144,277-285`).

### Restricciones de flujo
* **Comprar: SÍ solo reventa** (bebida embotellada); fabricación interna **NO entra por compra** (entra por `Produccion/Salida de Producción`).
* **Trasladar/mermar: SÍ** (si controla stock; si no, `MovimientoLogistica.php:1375-1396` desactiva validación de stock).
* **Producir: como resultado SÍ** (alta por producción), como ingrediente depende de `producto_esingrediente`.
* **Vender: SÍ** — y aquí sí hay bloqueo duro inexistente en compras: `producto_restriccionporstock + CONFIGURACION_NO_PERMITIR_VENTAS_SIN_STOCK` exige `stock>=cantidad` (`Producto.php:2903,2938`).

### Dependencias
* UM, categorías de producto, `presentacioncompraproducto`, `almacenproductoinsumo` (fila con `producto_id`, mismas columnas min/max/costo). Control de stock por almacén (`almacen.controlstock`).

### Peculiaridad
* Es la única entidad cuyo Kardex se puede **desactivar por flag** sin cambiar de tabla. El bot debe leer `producto_controlstock` antes de esperar movimiento (si es `!=SI`, esperar stock es timeout garantizado).

---

## 5. Receta (fórmula)

### Tabla + flags
* **Cabecera:** fila `insumo` con `insumo_recetabase=1` (+ `insumo_descargoreceta`: `0` = producible, `1` = descarga directa en venta — `Insumo.php:423,679,931`; `insumo_esderivado=1` + `recetabase=1` = derivada, `Insumo.php:38-44`).
* **Detalle:** `receta` (`receta_id PK, insumo_id [cabecera], receta_productoid, receta_insumoid [ingrediente], receta_cantidad double(18,3), unidadmedidainsumo_id NOT NULL, receta_tipo int, receta_genera, receta_generaunidadmedidainsumoid, receta_porcentajemerma def 0, receta_porcentajeholgura, receta_version`). En BD QA solo `receta_tipo=1`.
* Resultado: `presentacionresultantereceta` + `detalleresultantepreparacionreceta`; ejecución: `preparacionreceta/detallepreparacionreceta/lotepreparacionreceta`.

### Impacto en Kardex (doble vía con herencia de valor)
* `Preparacionreceta.php:440` descuenta ingredientes (`SALIDA_PREPARACION_RECETA_BASE`) y `:471` da de alta el cocinado (`ENTRADA_PREPARACION_RECETA_BASE`) valorizado a **suma de ingredientes + lote** (manual-maestro §3.2). Misma regla PPP hacia adelante; salidas a costo 0.
* Trazabilidad en `detallepreparacionreceta_valorizacion`; anular revierte las patas (`MovimientoalmaceninsumoController:3839-3851`).

### Restricciones de flujo
* **Comprar/trasladar/mermar la cabecera: NO** (no es stockeable directo; se produce).
* **Producir: SÍ** (`POST preparacionreceta/agregarPreparacionRecetaPorLote`, validación `PreparacionrecetaLogistica.php:1304,1818`; OPs `OrdenproduccionLogistica.php:552`, controller `:155,205,247`). Regla MRP: solo OP APROBADA se prepara (`freno de seguridad` = `estado==4`).

### Dependencias
* **Exige `categoriareceta_id`** (NO `categoriainsumo_id`; `InsumoLogisticaValidator.php:910-916`, resuelta por `obtenerCategoriarecetaList()`).
* Ingredientes `receta_insumoid + cantidad + UM`; payload sin `insumo_tienereemplazables/reemplazables` (columna inexistente en `logisticaaa.insumo` → 500 si se envía, `InsumoEntity.php:1189`).
* Recetas QA 1:1 en UNIDAD para que la matriz aplique directa.

### Peculiaridad
* Receta convive en `insumo` (cabecera) + `receta` (líneas). Borrar solo una deja huérfanos: la limpieza debe cubrir `receta, presentacionresultantereceta, preparacionreceta, detallepreparacionreceta, detalleresultantepreparacionreceta`.

---

## 6. Matemática común: PPP, varianza, min/max (cómo lo trata el sistema)

### 6.1 PPP (única fórmula, dos tablas)
`MovimientoalmaceninsumoV2.php:859-938` (espejo consumible idéntico):
```php
$valor = ((stockAnt * PPPant) + (costoOp * cantOp)) / (stockAnt + cantOp)  // :906-907
```
Bordes `:866-913`: `stock<0→0`, `ultimo_costo<0→stock=0`, `costo_op<0→usa último`, `denominador 0→costo_op`. Paralelo sin impuestos `:920-930`. **Solo ENTRADAS promedian**; salidas fijan `costooperacion=saldo=costopromedio=0` (`:208-213`); cuadre-sobrante fija `costopromedioactual=costooperacion` (revaloriza, no promedia, `:229-250`). Preview `Insumo.php:1212-1215` con `round(...,8)`. Oráculo tolerancia `0.02`, redondeo 3 decimales.

### 6.2 Varianza en compras (informativa, no bloquea)
Persistencia `CompraLogistica.php:2250-2257` (+ recálculo `2397-2457` con descuento/flete/percepción/ICBPer):
```
detallecompra_costo = precio con impuestos
detallecompra_costosinimpuestos = costoSinImpuestos (vía Impuestos::costoSinImpuestos; IGV leído de tabla igv fiscalizado=1)
detallecompra_importe = costo × cantidad
```
Columnas `detallecompra(costo decimal(15,5), costosinimpuestos decimal(18,6), cantidad decimal(12,4), importe decimal(15,5), descuento, afectoimpuestos, cantidadaceptada, precioanterior, numlote)`.
Variación solo reporte: `DetallecompraLogistica.php:1428-1446 obtenerVariacionPorcentualCostoActual = (actual-anterior)/actual*100` (bordes 0/-100), exhibida `CompraLogistica.php:2822,3234 item_variacion`, `ReporteVariacionPrecioCompras.php:115`, `EmuladorguiaLogistica.php:147-182`. **Grep `tolerancia` sin hits en flujo compra: ninguna varianza bloquea el guardado.** IGV `CalculoLogistica.php:128-149` (10 %/18 %): con-IGV `sinImp = unit/(1+%IGV)`, sin-IGV `sinImp = unit`.

### 6.3 Stock mínimo/máximo (alerta, nunca bloqueo de compra/traslado)
* Operativos: `almacenproductoinsumo_stockminimo/maximo decimal(12,4)` por almacén. Escritura REST `rest/producto/index.php:60-65` (`...PorEdicionRapida[V2]`, `...PorEdicionStockMinMax`, `...PorReplicaStockMinMax`, `...actualizarStockMinMaxPorAnalisis`), parse `InsumoLogistica.php:6479-6552`.
* Legacy: `insumo_stockminimo varchar(45)/stockmaximo double`, `producto_stockminimo decimal(12,2)/stockmaximo double`.
* Consumo: solo reportes/alertas — `ReporteStock.php:1220-1613-2504` (`if stockminimo>0 && stock<minimo → flag`), `Almacenproductoinsumo.php:599-605` (consumo = días×promedio + adicional %), `RequerimientomovimientoLogisticaController:1723-1724` (suma `stockMinimoTotal`), `Arqueo:207-214,449-456` compara. **Ningún validator de compra/movimiento/merma los consulta.**

### 6.4 Costo/Precio mínimo/máximo (referencial UI, no Kardex)
* **No son costos Kardex.** Viven en `presentacioninsumo_preciominimo/maximo decimal(14,2)` (+ `precioaproximado, precioventa`) y `presentacioncompraproducto_preciominimo/maximo decimal(10,2)`. Kardex usa `costooperacion/costopromedioactual(+sinimpuesto)` y `almacenproductoinsumo_costo/costopromedio`.
* Sin validador que bloquee Kardex por min/max (grep solo CRUD de presentaciones). Sirven a compra como precio pactado de referencia y a UI de ventas.

---

## 7. Implicaciones para el bot (qué hacer con esto)

1. **Bifurcar oráculo desde el flag:** `consumible=1 → espejo` (SQL), `producto_controlstock!=SI → no esperar Kardex`, resto → `obtenerStockYCosto[].costo`. Leer flags por SQL antes de cada caso (`resolverIdsSQL` ya trae `insumoId`; extender a `consumible/porcionable/recetabase/controlstock`).
2. **Limpieza incompleta hoy:** `limpieza_bd.sql` no borra `merma` (cabecera), `movimientoalmacenconsumible`, `receta` (solo borra `detalle*` + `preparacionreceta`), ni cabeceras `ordencompra/requerimiento*/solicitudmovimiento`. Agregar antes de nuevos flujos (orden hijos→padres + `FK_CHECKS=0/1`).
3. **Payloads:** receta exige `categoriareceta_id` y prohíbe `reemplazables`; OP prohíbe `detalleordenproduccion_estado` (500 `HY093`); OC exige wrapper `{ordencompra, productos}`.
4. **Casos nuevos sugeridos:** producto sin controlstock (esperar sin movimiento), receta base vs. descargoreceta, porcionable `=3` (derivado), varianza de precio (solo asertar `item_variacion`, nunca bloqueo), stock bajo mínimo (asertar flag de reporte, nunca bloqueo).
