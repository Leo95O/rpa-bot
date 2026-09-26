# Blueprint Técnico de Automatización E2E (Playwright) — Flujo Insumos → Compras → Guías → Kardex

> Stack: AngularJS 1.x (`logisticaview`) + PHP Slim Fat-Model (`webapp/logistica`) + MySQL `logistica`.
> Contrato red: `BACKEND_LOGISTICA = '/restaurant/logistica/rest/'` (`logisticaview/app/scripts/definitions.js:60`).
> Respuesta siempre HTTP 200 con `{ tipo, mensajes[], data }`, `tipo` es **string**: `SUCCESS='1'`, `ERROR='3'` (`webapp/api/definitions.php:97-100`, `api/entity/extras/Respuesta.php:3-11`). En Playwright comparar siempre `Number(json.tipo) === 1`.

---

## 1. Mapa de Selectores y Mutación del DOM

### 1.1 Nuevo insumo (`logistica.insumos.nuevo`, ctrl `producto/insumo/nuevo/nuevo.controller.js:58`, `vm.registrarInsumo` def `:284`)

| Elemento | Selector primario |
|---|---|
| Código | `#insumo_codigo` (`nuevo.html:29`), `ng-model="vm.insumo.insumo_codigo"` |
| Código interno | `#insumo_codigointerno` (`:38`) |
| Nombre (required) | `#insumo_nombre` (`:48`), error `small[ng-message="required"]` (`:50-51`) |
| Unidad medida | `#un ui-select`, `ng-model="vm.insumo.unidadMedidaSeleccionada"` (`:67`) |
| Permite conversión | `#checkEquivalencia`, `ng-model="vm.insumo.permiteConversion"` (`'1'/'0'`, `:78`) |
| Cantidad equivalencia | `input[ng-model="vm.insumo.insumoequivalencia.insumoequivalencia_cantidad"]` (`:90`) |
| Categoría | `#categoriainsumo_id ui-select`, `ng-model="vm.insumo.categoriaSeleccionada"` (`:109`) |
| Margen / merma | `#insumo_porcentajeventa` (`:171`), `#insumo_mermaporcentaje` (`:185`) |
| Proveedor | `rp-busqueda-proveedores#proveedor`, `ng-model="vm.proveedorSeleccionado"` (`:199`) |
| Clasificación ABC | `#insumo_clasificacionabc` (`:210`) |
| Grids | `#hot-ImpuestosPorLocal` (`:252`), `#hot-presentacionesCompra` (`:263`), `#hot-stockPorAlamacen` (`:276`) |
| Guardar | `button.btn-primary[ladda="vm.btnCargando"][ng-click="vm.registrarInsumo()"][ng-disabled="form.$invalid"]` (`:282`) |

Marca scope-walk: `typeof s.vm.registrarInsumo === 'function'`.

### 1.2 Nueva compra (`logistica.compra.nuevacompra`, ctrl `compra/nuevacompra/nuevacompra.controller.js:372`, vista `compra/nuevacompra/nuevacompra.html`)

| Elemento | Selector |
|---|---|
| Loader vista | `rp-loader[rp-show="vm.loadding"]` (`:2`) |
| Local | `rp-select-locales[ng-model="vm.compra.localSeleccionado"]` (`:34`), fijar `#fijarLocalCompra` (`:42`) |
| Fechas | `input[ng-model="vm.compra.fechaDeCompra.date"]` (`:83`), `input[ng-model="vm.compra.fechaDeTributacion.date"]` (`:90`) |
| Proveedor | `rp-busqueda-proveedores#proveedor` (`:94`) |
| Comprobante | `rp-obtener-comprobantes-compra#tipoDeComprobante` (`:103`) |
| Serie / número | `input[ng-model="vm.compra.compra_seriedoc"]` (`:115`), `input[ng-model="vm.compra.compra_nrodoc"]` (`:116`) |
| Grid detalle (HandsOnTable) | `rp-hands-on-table-detalle-compra[rp-model="vm.compra.detallecompraList"]` (`:147`) |
| Notas | `#notas textarea[ng-model="vm.compra.compra_observacionpago"]` (`:199`) |
| Continuar (header/footer) | `button.btn-primary[ng-click="vm.validarDatosPaso1();vm.fnCancelarTemporizador()"][ng-disabled="vm.compra.detallecompraList.length==0"]` (`:18`, `:235`) |
| Guardar (solo tras previsualización) | `button[ng-click="vm.fnGuardarCompra()"]` (`:246`, `ng-if="!$state.is('logistica.compra.editarcompra')"`) |
| Guardar cambios (edición) | `button[ng-click="vm.fnActualizarCompra()"]` (`:247`, dentro de `ng-if="vm.compra.mostrarPrevisualizacionMovimientoCompra"` `:241`) |

> Trampa confirmada: el botón `fnActualizarCompra` **no existe en el DOM** hasta pasar por Continuar → pago → previsualización. El bot NO debe hacer click CSS aquí: invocar `vm.fnActualizarCompra()` vía `page.evaluate` (patrón ya aplicado en `rpa-bot/src/compras.ts`).

Marcas: nueva `typeof s.vm.procesarDatosCompra === 'function'`; editar `typeof s.vm.fnActualizarCompra === 'function'`.

### 1.3 Guías (`guiacompra/nuevaguia/nuevaguia.html`, ctrls `nuevaguia.controller.js:95`, `editarguia.controller.js:77`)

| Elemento | Selector |
|---|---|
| Continuar | `button.btn-primary[ng-click="vm.procesarDatosGuia()"][ng-disabled="vm.guia.detalleguiaList.length==0"]` (`:10`, `:189`) |
| Local / proveedor | `rp-select-locales[ng-model="vm.guia.localSeleccionado"]` (`:17`), `rp-busqueda-proveedores#proveedor` (`:55`) |
| Serie / número | `#serie input[ng-model="vm.guia.guia_serie"]` (`:66`), `input[ng-model="vm.guia.guia_numeroguia"]` (`:67`) |
| Grid | `rp-hands-on-table-detalle-compra[rp-model="vm.guia.detalleguiaList"]` (`:115`) |
| Guardar / editar | `button[ng-click="vm.fnGuardarGuia()"]`, `button[ng-click="vm.fnActualizarGuia()"]` (`:198-203`) |

Flujo fiable ya probado: click `procesarDatosGuia()` → click `fnActualizarGuia()` → click `.swal2-confirm`.

### 1.4 Kardex (`kardex/individual/index.html:62`, ctrl `kardexindividual.controller.js:179`)

- Grid: `div[rp-hot][id="hot-kardexList"][ng-model="vm.compraList"]` (`:62`), loader `rp-loader[rp-show="vm.showLoading"]` (`:63`).
- Filtros (`controlesfiltros.html`): `#local` (`:8`), `#almacen` (`:25`), item (`:42`), `#fechaDeCompra` (`:64`), `#moneda` (`:80`), `#motivoKardexSeleccionado` (`:100`), aplicar `button[ng-click="vm.fnPrepararFiltrosParaCargarKardex(true)"]` (`:120`).
- ⚠️ NO leer stock de `vm.compraList` (devuelve 0 por filtros/digest). Oráculo: `Insumo.obtenerStockYCosto(id)` → `GET producto/insumo/obtenerStockYCosto/{id}`, leer `data[].costo` (ignorar `costoStock.costopromedio`, suele ser 0).

### 1.5 Rutas `$scope` para inyección (no usar clics en grids virtuales)

```js
// Compras
vm.compra.detallecompraList                          // filas HOT (lectura/escritura)
vm.compra.detallecompraListParaBackend               // payload (REGENERAR con vm.compra.obtenerFormatoDetalleCompraBackend(lista, impuestoList, compra_id))
vm.compra.impuestoList, vm.compra.proveedorSeleccionado, vm.objEnvio.productos
// Guías
vm.guia.detalleguiaList                              // + vm.guia.obtenerFormatoDetalleGuiaBackend(...)
vm.detalleguiaListParaBackend, vm.detalleguiaEliminados
// Insumo
vm.insumo.{insumoequivalencia, presentaciones, almacenes, impuestosCompraList, categoriaSeleccionada}
```

---

## 2. Sincronización y Barreras de Espera

### 2.1 Spinners (qué esperar en `waitForFunction`, no solo `waitForSelector`)

| Nivel | Flag / selector | Archivo |
|---|---|---|
| Global | `div#loading-wrapper[ng-if="!showLoading"]` (`app/index.html:101`), `div#loading-wrapper[ng-show="showLoading"]` (`common/mainloading/mainloading.html:2`); `$rootScope.showLoading` (`utility.service.js:280-299`) | global |
| Compra | `vm.loadding` (`nuevacompra.html:2`), `vm.cargandoDatosCompra` (Continuar), `vm.btnFinalizarCompra` (Guardar), `vm.flagCalculandoImpuestosDinamicos` (`:207`) | compra |
| Guía | `vm.loadding` + `ladda="vm.loadding"` (`nuevaguia.html:3`, ctrls `:22`, `:25`) | guías |
| Insumo | `vm.btnCargando` + `ladda="vm.btnCargando"` (`nuevo.html:282`, ctrl `:326-329`) | insumo |
| Kardex | `vm.showLoading` (`kardexindividual.controller.js:700/730`, `index.html:63`) | kardex |

Barrera recomendada: `page.waitForResponse(POST + urlPart)` **+** `page.waitForFunction(vm.X poblado)` **+** `waitForTimeout(500-2500)` para asentar modales.

### 2.2 Endpoints exactos para `waitForResponse` (POST, base `…/restaurant/logistica/rest/`)

| Operación | `urlPart` | Slim (`rest/…/index.php`) |
|---|---|---|
| Registrar insumo | `producto/insumo/registrarInsumo` | `producto:55` |
| Aperturar stock | `producto/insumo/aperturarStock` | `producto:68` |
| Agregar compra | `compra/agregarCompra` | `compra:21` |
| Actualizar compra | `compra/actualizarCompra` | `compra:22` |
| Guardar guía | `guiacompra/guardarGuia` | `guiacompra:20` |
| Actualizar guía | `guiacompra/actualizarGuia` | `guiacompra:21` |

Lecturas (GET, para oráculo, no barrera): `producto/insumo/obtenerStockYCosto/{id}` (`:77`), `compra/obtenerCompra/`, `guiacompra/obtenerGuia/`.

---

## 3. Captura de Errores y Validaciones (Hard-Stops)

### 3.1 JSON del Validator PHP

```json
{ "tipo": "3", "mensajes": ["La lista de productos y/o insumos está vacía."], "data": "" }
```

Mensajes literales (`webapp/api/entity/Compra.php`, `Guia.php`, `Insumo.php`):
- Compra `:679` / Guía `:312`: `"La lista de productos y/o insumos está vacía."`
- Compra `:675` / Guía `:307`: `"Estas tratando de eliminar todos los productos y/o insumos de esta lista"`
- Compra `:649`: `"Existe un problema con la cantidad o costo del item: X"`; `:654`: `"El item: X no cuenta con un almacen seleccionado."`; `:643` UM incompatible; `:665` sin impuestos; `:690` crédito sin cuotas
- Frontend (`models/compra.js:1272-1283`): `"No se han encontrado detalles de compra."`, `"Selecione una fecha valida para la compra."`, `"No ha seleccionado un proveedor."`, `"No se ha selecionado un comprobante."` (sic)
- Insumo `:565`: `"El nombre del insumo ya existe."`; duplicado compra: `ERROR_COMPRA_YA_EXISTE='E_COMPRA_001'` (`logistica/DefinitionsErrors.php:18`, vía `existeCompra()` `:695-714`: match `tipodoc+serie+nro+proveedor_id+estado=1`)

### 3.2 Render en pantalla (selectores para pruebas negativas)

- Diálogos: `window.rpAlert = Swal.mixin(...)` (`config.js:622-642`). Uso: `rpAlert.fire(...)`. **No hay `.alert-danger`/toasts.**
- Selectores de aserción: `.swal2-popup`, `.swal2-title`, `.swal2-html-container`, confirmar `button.swal2-confirm.btn-primary`, cancelar `button.swal2-cancel.btn-secondary`.
- Bloqueo de guardado: doble mecanismo — botón con `ng-disabled="vm.compra.detallecompraList.length==0"` / `form.$invalid` (nunca dispara red) **y** validación que dispara `rpAlert` de error tras el POST (caso `detallecompraListParaBackend` stale → `"La lista…vacía."`).
- Patrón negativo: `waitForResponse(urlPart)` → `Number(json.tipo) !== 1` → `json.mensajes[0]` contiene literal → `expect(page.locator('.swal2-popup')).toBeVisible()`.

---

## 4. Fórmulas del Oráculo (Backend, valores verificados en E2E real)

### 4.1 Costo promedio ponderado — `api/entity/MovimientoalmaceninsumoV2.php:2969-2987, 3296-3311`

```php
$costoOperacion   = ($stockAntes * $costoOperacion   + $cantidadEntrada * $mov->costooperacion)
                  / ($stockAntes + $cantidadEntrada);   // si denominador <= 0 => 0
$costoSinImpuestos = ($stockAntes * $costoSinImpuestos + $cantidadEntrada * $mov->costosinimpuesto)
                   / ($stockAntes + $cantidadEntrada);
```

Valorización (`DetallecompraLogistica.php:871-872`): `valorizacion_anterior = costosanterior*stockanterior`, `valorizacion_actual = costooperacion*saldoactual`. Comportamiento E2E confirmado: **anular revierte stock vía contra-movimiento (`SALIDA_ANULAR_COMPRA`), NO reescribe el costo histórico** (tras anular, el costo queda congelado).

### 4.2 Presentaciones — `CompraLogistica.php:2790,3188,3540`

```
cantidad_UMbase = item_cantidad × presentacioninsumo_cantidad
```

⚠️ Con merma del 50% (caso `test B`): `Caja de 24` aporta `24 × 0.5 = 12u` efectivas por caja. Verificado: 2 cajas → +24u (`20→44`, costo `(16.6+44)/44=1.377`).

### 4.3 Merma — `MovimientoalmaceninsumoV2.php:2963-2966`

```
cantidadParaCalculo = cantidad - merma   (si merma > 0)
```

Campos `detallecompra_mermaid` / `detalleguia_mermaid` (`DetallecompraEntity.php:17`); al anular detalle se anula su merma (`DetallecompraLogistica.php:723-725`).

### 4.4 IGV — `logistica/models/CalculoLogistica.php:128-149` (10%/18%)

```
// precio CON IGV:  costoSinImp = costoUnitario / (1 + %IGV)
// precio SIN IGV:  costoSinImp = costoUnitario
totalImpuestos = costoSinImp × %IGV × cantidad
```

El oráculo `obtenerStockYCosto[].costo` **incluye impuestos** (config 72 en 0). Guardado `detallecompra_costosinimpuestos` (`CompraLogistica.php:2254`).

### 4.5 Nota de crédito — `NotacreditocompraLogistica.php`

- `DESCUENTO_CANTIDAD (:539-588)`: genera `SALIDA_NOTA_CREDITO_COMPRA` por la cantidad devuelta (sí descuenta stock, no toca costo).
- `DESCUENTO_PRECIO (:592-661)`: no toca stock; re-inserta `ENTRADA_COMPRA` clonada +1s con nuevo costo y anula la anterior.

---

## 5. Dependencias de Terceros y Mocks

**Veredicto: NADA que mockear de SUNAT/OSE en este flujo.** `grep sunat|nubefact|ose|ubl|greenter` en `logistica` solo devuelve `producto_codigosunat` (campo maestro) y flag `guiaremision_aprobadaporsunat`. La GRE electrónica pertenece a otro módulo (Almacenes/Guía de Remisión, no Guía de Compra).

Lo único con sabor XML (importación contable, no emisión):
- `POST /procesarXMLByImportacionCompra` (`rest/compra:146` → `CompraLogistica.php:4557-4636`, facturas Costa Rica vía `simplexml`)
- `POST /obtenerCompraDesdeDteSimplefactura` (`:80`, precarga Chile/DTE)
- Rama DIAN Colombia (`CompraLogistica.php:5799-5802`, gate por contenido UBL/ZIP)

Regla: en este flujo **no interceptar nada**; si algún día se automatiza GRE/SimpleFactura, mockear esos 3 endpoints.

---

## 6. Gestión del Estado (Setup/Teardown)

**No existe seeder/endpoint de truncado** en `logistica` (`grep TRUNCATE|Seeder` solo borrados parciales de `compraimpuestocompra/detalleavancecompra/impuestodetallecompra`). La app solo hace anulaciones lógicas (`estado=INACTIVO`, `movimientoalmaceninsumo_fueeliminado=SI` + `regularizarEntradasDesdeID()`).

Setup actual del bot (`rpa-bot/src/db.ts`, válido y recomendado):
```sql
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM presentacioninsumo WHERE presentacioninsumo_id > 0;
DELETE FROM movimientoalmaceninsumo WHERE movimientoalmaceninsumo_id > 0;
DELETE FROM almacenproductoinsumo WHERE almacenproductoinsumo_id > 0;
DELETE FROM insumo WHERE insumo_id > 0;
SET FOREIGN_KEY_CHECKS = 1;
```
- `FOREIGN_KEY_CHECKS=0` es obligatorio (`insumo` referenciado por ~40 tablas).
- Limpieza **no** borra `compra/detallecompra/guia/detalleguia/notacreditocompra` → los comprobantes deben ser únicos por corrida (`numero + '-' + Date.now()`, validado por `existeCompra()`/`existeGuia()`).
- Tablas satélite a vigilar si hay residuos: `compraimpuestocompra, impuestodetallecompra, comprasporpagar, notacreditocompra, merma`.

---

## Apéndice: recetas Playwright listas para copiar

```ts
// Navegación + scope-walk
await page.evaluate(a => angular.element(document.body).injector().get('$state').go(a.e, a.p), { e: 'logistica.compra.editarcompra', p: { idCompra: id } });
await page.waitForFunction(() => { /* walk $rootScope buscando s.vm.fnActualizarCompra */ }, undefined, { timeout: 60000 });
// Barrera
const resp = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('compra/actualizarCompra'), { timeout: 300000 });
// Inyección detalle + regeneración backend (obligatorio, evita "lista vacía")
vm.compra.detallecompraListParaBackend = vm.compra.obtenerFormatoDetalleCompraBackend(vm.compra.detallecompraList, vm.compra.impuestoList, vm.compra.compra_id);
// Guardar edición (sin click: el botón no existe pre-preview)
await page.evaluate(() => { /* walk + found.vm.fnActualizarCompra() */ });
await page.waitForSelector('.swal2-confirm', { timeout: 15000 }); await page.click('.swal2-confirm');
// Oráculo (tolerancia 0.02, reintentar 0/0 transitorio tras actualizarCompra)
const { Insumo } = injector; const s = await Insumo.obtenerStockYCosto(id); // leer data[].costo
```
