# Blueprint Técnico de Automatización E2E — Porcionar Insumos (Desposte)

> Flujo: 1 insumo origen a granel → N insumos destino, en un solo asiento doble vía.
> Frontend: `logisticaview/app/scripts/logistica/produccion/porcionarreceta/porcionar/` (mismo template+ctrl que Porcionar Recetas, bifurca por `$state`).
> Backend: `Preparacionreceta` tipo `PORCIONAMIENTO` + `MovimientoalmaceninsumoController::guardarPorcionamientoInsumo`.

---

## 0. Recetas Playwright transversales (aplican a todos los flujos futuros)

### 0.1 Ciclo `$digest` — estrategia estable tras mutar `$scope` vía `page.evaluate`

Hallazgo: el módulo **no usa `$scope.$apply()` en ningún punto**; todo corre dentro de `$timeout` (digest seguro) o callbacks de HandsOnTable. Los recálculos están enganchados así:

- `$scope.$watch("vm.porcionamientoDeRecetas.insumos", …, true)` y `…presentaciones` (`porcionarReceta.controller.js:2048-2049`), más `_calcularCostoTotalDeLaPreparacion` con debounce `$timeout 100ms` (`:2023`).
- Edición de grilla vía `Handsontable.afterChange` (wrapper `HandsontableService.addEventAfterChange`, ignora `source==="setEmpty"`).

Estrategia recomendada (en este orden, de menos a más frágil):

1. **Preferir `$timeout` sobre `$apply`**: envolver la mutación en `injector.get('$timeout')(fn)` o simplemente mutar y esperar 300ms. `$apply` dentro de un digest en curso lanza `"$digest already in progress"`; `$timeout` lo encola de forma segura.
2. **Disparar el `afterChange` real en vez de mutar el array a pelo**: usar `hot.setDataAtCell(fila, col, valor)` sobre la instancia (`vm.onLoadHotRecetas(instance)` / `vm.onLoadHotPresentaciones(instance)` guardan la instancia). Esto ejecuta la cadena de recálculo (`hotRecetasCantidadAPrepararAfterChange:881`, `hotPresentacionesCantidadResultanteAfterChange:2876`) exactamente como un usuario.
3. Si se muta el array directamente (más rápido para N filas): llamar después al recalculador explícito que corresponda (`vm.recalcularTotalesPorcionable()`, `recalcularValorizadoResultantesPorCantidades(receta)`) dentro de `$timeout`, y luego `hot.render()`.
4. Barrera de espera: `page.waitForFunction` sobre el **pie calculado** (ej. `vm.porcionamientoDeRecetas.recetaSeleccionada.item_cantidadResultante === X`), no `waitForTimeout` fijo.

```ts
// Patrón digest-seguro
await page.evaluate(() => {
  const inj = angular.element(document.body).injector();
  const $timeout = inj.get('$timeout');
  // ... localizar scope/vm ...
  $timeout(() => { vm.recalcularTotalesPorcionable(); });
});
await page.waitForFunction((esp) => {
  // walk hasta vm.porcionamientoDeRecetas.recetaSeleccionada y comparar resultante
}, esperado, { timeout: 15000 });
```

### 0.2 `ui-select` (theme bootstrap) — receta determinista

Los `ui-select` de esta app **no son `<select>`**: son `div.ui-select-match` + `input.ui-select-search` + lista virtual con `refresh` remoto. `page.fill` directo no dispara nada. Dos enfoques, del más al menos frágil:

**A. Inyección al `ng-model` + `ng-change` manual (recomendado para catálogos grandes/almacén):**
```ts
await page.evaluate((id) => {
  // walk hasta el vm, setear vm.porcionamientoDeRecetas.almacenPorcionamientoSeleccionado = {almacen_id: id, ...}
  // y luego invocar vm.fnCambioAlmacen() (el ng-change) dentro de $timeout
});
```
Ventaja: cero dependencia de animaciones/filtros; ejecuta exactamente el handler (`fnCambioAlmacen:1832-1850`).

**B. Clics físicos (cuando se quiere ejercitar la UI real):**
```
1. click en `#almacen_preparacion .ui-select-match` (abre dropdown)
2. fill en `input.ui-select-search` (dispara refresh con delay 0 — escribir letra por letra si hay debounce)
3. waitForSelector('.ui-select-choices-row') → click en la fila (por texto exacto)
4. waitForFunction(vm.campoSeleccionado?.id === esperado)
```
Regla: usar **A** para setup (local, almacén, moneda) y **B** solo cuando el caso de prueba sea la búsqueda en sí (ej. el buscador de ítems con `refresh='vm.searchItem($select.search)'`, que a su vez llama `busquedaSensitivaSegunTipos` con `buscarPorcionable='1'`).

---

## 1. Mapa de Selectores y `$scope`

Estados (`produccion/produccion.route.js:630-678`): `logistica.produccion.porcionarinsumo` (`/porcionar-insumos`, `porcionarReceta.html` + `porcionarRecetaCtrl as vm`), `.lista`, `.ver/:idLotepreparacionreceta`. Marca modo: `vm.esPorcionamientoInsumo=true` solo si `$state.is("logistica.produccion.porcionarinsumo")` (`porcionarReceta.controller.js:80-84`).

| Elemento | Selector primario |
|---|---|
| Buscador origen (ui-select) | `ui-select[ng-model="vm.selectedItem"]` (`porcionarReceta.html:107-113`), placeholder "Busca un item para agregar a porcionamiento…" |
| Grilla origen | `div[rp-hot]#hot-recetas[ng-model="vm.porcionamientoDeRecetas.recetasAPreparar"]` (`:116`); col editable `item_cantidadAPreparar` (`getColumnsReceta:978-1046`) |
| Grilla destinos | `div[rp-hot]#hot-recetas-presentaciones[ng-model="vm.porcionamientoDeRecetas.presentaciones"]` (`:123`, visible si `recetaSeleccionada != null` `:119`); col editable `presentacionresultantereceta_cantidadResultante` (`getColumnsPresentaciones:1437-1540`); descartables `#hot-recetas-presentaciones-descartables` (`:128`) |
| ☑️ Guardar faltante como merma | `input#guardarFaltanteMerma[ng-model="vm.porcionamientoDeRecetas.guardarFaltanteMerma"][ng-true-value="'1'"][ng-false-value="'0'"]` (`:56-57`), **sin `ng-change`**, visible solo `ng-if="vm.esPorcionamientoInsumo"` (`:53`) |
| Checks afines | `input#asignarPorcentaje` (`:66-67`, `ng-change="vm.fnAsignarPorcentajeChange()"`), `input#recalcularAutomaticamnte` (`:76-77`) |
| Local / almacén / fecha | `rp-select-locales[ng-model="vm.porcionamientoDeRecetas.localSeleccionado"]` (`:28`), `ui-select#almacen_preparacion[ng-model="…almacenPorcionamientoSeleccionado"][ng-change="vm.fnCambioAlmacen()"]` (`:45-46`), `input[date-range-picker][ng-model="…fechaDePorcionamiento.date"]` (`:39`) |
| Guardar (×3, no hay Continuar: `ng-if="false"` `:15`) | `button.btn-primary[ng-click="vm.fnPorcionarRecetasSeleccionadas()"][ladda="vm.btnGuardandoPorcionamiento"]` (`:17-21`, `:200-204`, `:216-220`) |

Rutas `$scope` (`porcionarReceta.controller.js`):
- Origen: `vm.porcionamientoDeRecetas.recetasAPreparar[]` (filas enriquecidas en `addItemInsumo:648-757`: `item_insumoid`, `item_cantidadAPreparar`, `presentacionesResultantes[]`, `stockCosto{stock,costo}`, `almacenes[]`); filas vacías (`!item_id`) se filtran en `_obtenerElementosValidos:1815-1827`.
- Selección: `vm.porcionamientoDeRecetas.recetaSeleccionada` (set en `hotRecetasAfterSelectionEnd:1117-1226`); derivados `…presentaciones` (`:1210`), `…presentacionSeleccionada/descartables` (`:319-330`).
- Totales/pie: `recalcularTotalesPorcionable:2480-2511` → `item_cantidadAPreparar / item_cantidadResultante / item_costoAPreparar / item_totalAPreparar / item_costoResultante / item_totalResultante`; `%merma = (APreparar−Resultante)/APreparar×100` (`obtenerPorcentajeMerma:2344-2366`).
- Payload (`fnPorcionarRecetasSeleccionadas:1757-1813`): `_objEnvio{almacen_id, local_id, fechaDePorcionamiento 'YYYY-MM-DD HH:mm:ss', recetasAPreparar[], lotepreparacionreceta_tipo, [generarMerma='1', merma], [movimientoEmulacionPreparacionRecetaList]}` → `Preparacionreceta.agregarPorcionamientoRecetaPorLote(_objEnvio)` (`:1796`).

---

## 2. Sincronización y Endpoints

- Flags: `vm.loadding` (`rp-loader[rp-show]` `:3`), `vm.btnGuardandoPorcionamiento` (`ladda`, `=true` en `:1790` → `=false` en `:1797`).
- Confirm: `rpAlert.fire('¿Seguro que desea guardar este porcionamiento de insumos/recetas?')` (`:1761-1765`) → `.swal2-confirm`; éxito `UtilityService.mostrarNotificacion` (`:1792-1807`), cierre de tab hacia `porcionarinsumo.lista`.
- **Endpoint de guardado**: `POST {BACKEND_LOGISTICA}…/porcionamientoreceta/agregarPorcionamientoRecetaPorLote` (`logistica/rest/produccion/index.php:200-205` → `PreparacionrecetaLogisticaController:912` → `MovimientoalmaceninsumoController::guardarPorcionamientoInsumo` por cada receta `:1018`). Barrera: `waitForResponse(POST + 'porcionamientoreceta/agregarPorcionamientoRecetaPorLote')`.
- Sin update: solo registrar/anular (`GET …/preparacionreceta/anularLotePreparacion/{id}` `:41`; clásica `POST /guardarPorcionamientoInsumo`, `POST /anularPorcionamiento/:id`).
- Respuesta `{tipo, mensajes[], data}`; éxito `"Porcionamiento registrado exitosamente"` (data=`preparacionreceta_id`) / lote `"Se realizo el porcionamiento con exito."` (`MovimientoalmaceninsumoController:4011-4060`, `PreparacionrecetaLogisticaController:1035-1044`).

---

## 3. Validaciones (hard-stops literales)

Frontend (`validar:1690-1712`, `validarCantidadesResultantesEnPorcionamiento:1885-1928` — núcleo del desposte):
- `"La lista de recetas a porcionar se encuentra vacia."` (`:1780`)
- Sin merma (cuadre exacto, salvo UM `UNIDAD` `:1910-1912`): `"El total de cantidades a porcionar no coincide con las cantidades resultantes en X"` (`:1916`)
- Con merma: `"La cantidad a porcionar no puede ser menor a la cantidad resultante en X"` (`:1904`)
- `"El insumo resultante X tiene una unidad medida incompatible con Y"` (`:1894`), `"El item "X" no se controla en "Y""` (`:1862`), `"Debes asignar una cantidad a porcionar mayor a cero para la receta X."` (`:2068`)

Backend (`api/entity/Preparacionreceta.php:150-234`): `"No se ha seleccionado un almacen para la preparación."`, `"La cantidad a porcionar debe ser mayor a 0"`, `"El resultado debe ser mayor a 0."`, `" El insumo: X no es valido, intentelo nuevamente"`. Anular: `"Porcionamiento anulado"` / `"…ya fue anulada"` (`MovimientoalmaceninsumoController:3855-3863`).

Aserción negativa: `Number(json.tipo)!==1` + literal en `mensajes[]` + `.swal2-popup` visible.

---

## 4. Fórmulas del Oráculo (lo más importante)

Fuente: `api/entity/Preparacionreceta.php:523-776, 862-926`. Orden: `disminuirStockPorcionable()` → `obtenerCostoPorUnidadProducida()` → `obtenerCostoFactor()` → loop `incrementarStockPorCompra(ENTRADA_PORCIONAMIENTO, …)`.

### 4.1 Prorrateo — TODOS los destinos reciben el MISMO costo unitario

```php
$costoUnidadBasePorcionable = Insumo::getById(origen)->getCosto($almacen_id); // PPP vigente del origen
$cantidad_restar_stock = conversionUM(origen_UMmin, $resultado, destino_UM);
$costoFactor = $costoUnidadBasePorcionable * $cantidad_restar_stock / $resultado;
```

Comentario literal del autor (`:871-892`): `1k+0.5k=(2k*8)=16; 1.5K=16; 1k=10.66` → `DP1(1k)=10.66, DP2(0.5k)=5.33`. Cada destino: `valorizado = cantidad_destino × costoFactor` (`:648-660`). **No es ponderado por peso, ni partes iguales, ni % manual** — el % solo aplica si está activa `CONFIGURACION_ALTERAR_COSTO_VALIDAR_CANTIDAD_PORCIONAR_INSUMO_LOGISTICA` y viene `presentacionresultantereceta_valorizado` (`:638-640`).

Ejemplo oráculo (Pollo 10kg @ S/8/kg = S/80 → Pechuga 6kg + Alitas 3kg, merma 1kg ON): `resultado=9`, `costoFactor = 8×9/9 = 8` → Pechuga `6×8=48`, Alitas `3×8=24`, merma `1×8=8` aparte. Suma `48+24+8=80` ✓.

### 4.2 Merma — NO encarece las piezas (al contrario de la intuición)

`PreparacionrecetaLogisticaController:973-986`: si `generarMerma=='1'` **y** `merma>0` → `resultado = APreparar − merma`. Registro (`:523-536, 778-856`): fila `merma` (`razon="Merma por porcionamiento de insumo: X"`, `importe = costoAprox_origen × merma`) + `detallemerma(costo, cantidad, importe)` + Kardex `SALIDA_MERMA_PORCIONAMIENTO` (motivo 15) con `merma_id` como `idmotivo`.

Consecuencia para el oráculo: como `costoFactor` divide entre el `resultado` **neto**, cada kilo útil conserva el costo unitario del origen — la merma se valoriza por separado y sale por su propio movimiento. `cantidadDescargarStockInsumoPorcionado = resultado + merma` se calcula pero **no entra al divisor**.

### 4.3 Asiento doble vía + PPP hacia adelante

Motivos (`api/definitions.php:171,192-193`): `ENTRADA_PORCIONAMIENTO=13`, `SALIDA_PORCIONAMIENTO=16`, `SALIDA_MERMA_PORCIONAMIENTO=15`. Origen: `disminuirStock(…, SALIDA_PORCIONAMIENTO, preparacionreceta_id)` [+ `SALIDA_MERMA` si aplica]; cada destino: `incrementarStockPorCompra(ENTRADA_PORCIONAMIENTO, costoFactor, cantidad, …)` → `MovimientoalmaceninsumoV2::parser+registrar`, y el PPP del destino se recalcula (`Insumo.php:1212-1216`):

```php
$nuevoCosto = ((ultimoCosto × stockActual) + (cantidad_ingreso × costoUnidadControl)) / (stockActual + cantidad_ingreso)
```

Trazabilidad en `detallepreparacionreceta` (+`detallepreparacionreceta_valorizacion`); anular revierte las 3 patas (`:3839-3851`).

---

## 5. Mocks y Limpieza

- **Sin llamadas externas** (sin SUNAT/firma/XML): nada que mockear.
- Limpieza: no hay seeder; el teardown es `data/limpieza_bd.sql` + anular lote (`GET …/anularLotePreparacion/{id}`). Tablas que toca el flujo y ya están cubiertas: `preparacionreceta`, `detallepreparacionreceta`, `detalleresultantepreparacionreceta`, `presentacionresultantereceta`, `movimientoalmaceninsumo`, `detallemerma`(+`merma`), `insumoequivalencia`. ⚠️ `merma` cabecera y `preparacionreceta` cabecera **no están** en el script actual — agregar `DELETE FROM merma WHERE merma_id > 0` (tras `detallemerma`) y `DELETE FROM preparacionreceta WHERE preparacionreceta_id > 0` antes de estabilizar el bot de porcionado.
- Setup de maestros: el origen debe existir con `insumo_porcionable=1` y `presentacionesResultantes[]` configuradas (`registrarPorcionableLogistica`: `rest/producto/index.php:174-175`); cada destino necesita control en el almacén (`validarAlmacenPorcionable:1852`).

## Apéndice — esqueleto del caso E2E

```
1. Setup: crear/insumo origen porcionable (10kg @ 8) + 2 destinos con stock 0 + presentaciones resultantes.
2. Navegar logistica.produccion.porcionarinsumo → ui-select almacén (receta A) → buscador (receta B).
3. Inyectar origen 10kg vía hot.setDataAtCell + destinos 6/3kg → esperar pie (recetaSeleccionada).
4. Caso A (merma OFF): validar cuadre exacto falla si 10≠9 → encender #guardarFaltanteMerma → merma=1.
5. waitForResponse(porcionamientoreceta/agregarPorcionamientoRecetaPorLote) + click Guardar + .swal2-confirm.
6. Oráculo: origen −10, Pechuga +6@8, Alitas +3@8, merma 1@8 en merma/detallemerma; PPP destinos recalculado.
```
