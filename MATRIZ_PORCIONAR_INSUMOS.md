# Matriz E2E — Producción / Porcionar Insumos (Desposte)

> Formato espejo de la matriz de Compras. Historia secuencial con arrastre de saldo.
> Setup: **Pollo Entero TEST** (origen porcionable, 100 kg @ S/10.00), **Pechuga TEST** (10 kg @ S/12.00),
> **Alitas TEST** (0 kg). Tolerancia: stock exacto, costo ±0.02.
> Fórmulas (PHP): `costoFactor = costo_origen × resultado / resultado` (idéntico por destino);
> PPP destino `((costo×stock)+(cant×costoF))/(stock+cant)`; merma aparte a costo de origen.

| N° | Módulo | Caso | Descripción | Datos relevantes | Resultado esperado |
|---|---|---|---|---|---|
| 1 | 1. Porcionar insumos | Análisis de estado actual | Obtiene el listado general de stock antes de iniciar las pruebas de porcionado | Todos los almacenes y categorías, fecha de corte 2090-01-01 | No aplica, solo compara valores, no valida |
| 2 | 1. Porcionar insumos | Creación del insumo origen | Registra el pollo entero a granel, porcionable, con stock y costo de apertura | Nombre: "Pollo Entero TEST". Almacén principal: 100 kilos, costo 10.00, `porcionable=1` | Insumo creado correctamente |
| 3 | 1. Porcionar insumos | Consulta del detalle del origen | Recupera la ficha completa del insumo origen. Incluye sus presentaciones resultantes | Identificador del origen | Ficha completa devuelta, con presentaciones resultantes configuradas |
| 4 | 1. Porcionar insumos | Verificación de stock y costo del origen | Comprueba que el origen quedó registrado con el stock y costo de apertura | Insumo origen, almacén principal | Stock: 100.00. Costo: 10.00 |
| 5 | 1. Porcionar insumos | Creación del destino Pechuga | Registra el primer insumo destino, con stock y costo distintos para ejercitar el PPP | Nombre: "Pechuga TEST". Almacén principal: 10 kilos, costo 12.00 | Insumo creado correctamente |
| 6 | 1. Porcionar insumos | Consulta del detalle de Pechuga | Recupera la ficha del destino. Aporta los datos de control en almacén | Identificador de Pechuga | Ficha completa devuelta |
| 7 | 1. Porcionar insumos | Verificación de stock y costo de Pechuga | Comprueba el estado inicial del destino tras su creación | Insumo Pechuga, almacén principal | Stock: 10.00. Costo: 12.00 |
| 8 | 1. Porcionar insumos | Creación del destino Alitas | Registra el segundo destino con stock cero (Kardex en cero) | Nombre: "Alitas TEST". Almacén principal: 0 kilos | Insumo creado correctamente |
| 9 | 1. Porcionar insumos | Verificación de stock y costo de Alitas | Comprueba el destino en cero antes del primer porcionado | Insumo Alitas, almacén principal | Stock: 0.00. Costo: 0.00 |
| 10 | 2. Hard-stops | Descuadre sin merma | Intenta porcionar 10 kg → 6 + 3 con `guardarFaltanteMerma='0'` (10 ≠ 9) | Origen 10 kg; Pechuga 6; Alitas 3; flag OFF | Hard-stop: "El total de cantidades a porcionar no coincide con las cantidades resultantes en Pollo Entero TEST". Sin POST. Stocks intactos |
| 11 | 2. Hard-stops | Cantidad a porcionar cero | Intenta porcionar con cantidad origen igual a cero | Origen 0 kg | "La cantidad a porcionar debe ser mayor a 0". Sin movimientos |
| 12 | 2. Hard-stops | Stock insuficiente | Intenta porcionar 200 kg con stock 85 (Kardex negativo) | Origen 200 kg, stock real 85 | Botón Guardar deshabilitado (`operacionRestringidaPorStockNegativo`), sin POST. Stocks intactos |
| 13 | 3. Porcionado 1 (con merma) | Análisis de estado actual | Obtiene el listado general de stock antes del primer porcionado | Todos los almacenes y categorías, fecha de corte 2090-01-01 | No aplica, solo compara valores |
| 14 | 3. Porcionado 1 (con merma) | Registro del primer porcionado | Porciona 10 kg → Pechuga 6 + Alitas 3 + merma 1, flag `'1'`. `resultado=9`, `costoFactor=10×9/9=10` | Origen 10 kg; Pechuga 6; Alitas 3; merma 1 | Porcionamiento registrado correctamente. Lote creado |
| 15 | 3. Porcionado 1 (con merma) | Consulta del lote | Recupera los datos del lote, necesarios para poder anularlo después | Identificador del lote 1 | Datos completos del lote y sus 3 patas (salida, entradas, merma) |
| 16 | 3. Porcionado 1 (con merma) | Verificación de stock y costo del origen | Valida que el origen se descargó por el total (resultado + merma) sin cambiar su costo | Origen, almacén principal | Stock: 90.00. Costo: 10.00 |
| 17 | 3. Porcionado 1 (con merma) | Verificación de stock y costo de Pechuga | Valida el PPP tras la primera entrada: `(10×12 + 6×10)/16` | Pechuga, almacén principal | Stock: 16.00. Costo: 11.25 |
| 18 | 3. Porcionado 1 (con merma) | Verificación de stock y costo de Alitas | Valida la entrada sobre Kardex en cero: `(0 + 3×10)/3` | Alitas, almacén principal | Stock: 3.00. Costo: 10.00 |
| 19 | 3. Porcionado 1 (con merma) | Verificación de la merma | Confirma que el faltante se absorbió como merma operativa valorizada | Merma 1 kg a costo origen 10.00 | Fila en `merma` + `detallemerma`: cantidad 1.00, importe 10.00, motivo SALIDA_MERMA(15). Conservación: 60+30+10=100 |
| 20 | 4. Porcionado 2 (cuadre exacto) | Registro del segundo porcionado | Porciona 5 kg → Pechuga 3 + Alitas 2 (5=5), flag `'0'`. `costoFactor=10` | Origen 5 kg; Pechuga 3; Alitas 2; cuadre exacto | Porcionamiento registrado correctamente |
| 21 | 4. Porcionado 2 (cuadre exacto) | Consulta del lote | Recupera los datos del segundo lote para su anulación LIFO | Identificador del lote 2 | Datos completos del lote |
| 22 | 4. Porcionado 2 (cuadre exacto) | Verificación de stock y costo del origen | Valida la descarga acumulada tras dos porcionados (90−5) | Origen, almacén principal | Stock: 85.00. Costo: 10.00 |
| 23 | 4. Porcionado 2 (cuadre exacto) | Verificación de stock y costo de Pechuga | Valida el PPP acumulado: `(16×11.25 + 3×10)/19` | Pechuga, almacén principal | Stock: 19.00. Costo: 11.05 |
| 24 | 4. Porcionado 2 (cuadre exacto) | Verificación de stock y costo de Alitas | Valida el PPP acumulado: `(3×10 + 2×10)/5` | Alitas, almacén principal | Stock: 5.00. Costo: 10.00 |
| 25 | 5. Anulaciones | Anulación del segundo lote (LIFO) | Anula el último lote para probar la logística inversa parcial | Identificador del lote 2 | Lote anulado correctamente |
| 26 | 5. Anulaciones | Verificación de stock tras anular el lote 2 | Confirma la reversión exclusiva del segundo asiento | Origen, Pechuga y Alitas | Stock origen: 90.00. Pechuga: 16.00. Alitas: 3.00 |
| 27 | 5. Anulaciones | Anulación del primer lote (con merma) | Anula el lote con merma; debe revertir salida, entradas y merma | Identificador del lote 1 | Lote anulado; merma anulada (`fueeliminado`) |
| 28 | 5. Anulaciones | Verificación final de stock y costo del origen | Confirma que el origen volvió a su apertura | Origen, almacén principal | Stock: 100.00. Costo: 10.00 |
| 29 | 5. Anulaciones | Verificación final de stock y costo de Pechuga | Confirma que el destino volvió a su apertura al retirar todas las entradas | Pechuga, almacén principal | Stock: 10.00. Costo: 12.00 |
| 30 | 5. Anulaciones | Verificación final de Alitas y cierre | Confirma el destino en cero y el cierre contable del flujo | Alitas; `merma`; `movimientoalmaceninsumo` | Stock Alitas: 0.00. Sin mermas vivas. Movimientos del flujo todos anulados |

**Notas de viabilidad:**
1. Sin caso de edición: el backend no expone update (solo registrar/anular); la historia usa anulaciones LIFO (N°25→27).
2. Merma (N°19) sin endpoint de lectura: oráculo por SQL directo a `merma`/`detallemerma`.
3. N°12 por fijar en primera corrida: el flag `operacionRestringidaPorStockNegativo` existe, pero el literal backend ante negativo se confirma del primer run.
4. Costos post-anulación (N°26): stocks deterministas; si `regularizarEntradasDesdeID` altera el costo, se fija el valor real del primer run.
5. Oráculo vía `Insumo.obtenerStockYCosto[].costo`, nunca `#hot-kardexList`.
