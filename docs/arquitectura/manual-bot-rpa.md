# Manual de Arquitectura y Operación del Bot RPA — Suite E2E Masiva Logística

> **Proyecto:** logisticaview-rpa-bot · **Estado:** 90/90 casos en verde · **Comando:** `npm run test:suite`
> **Sistema bajo prueba:** ERP logístico (frontend AngularJS 1.x en `logisticaview`, backend PHP Slim Fat-Model en `webapp/logistica`, MySQL `logisticaaa` en localhost:3306).
> **Audiencia:** desarrolladores del bot y equipo QA. Tono: técnico y exhaustivo.

---

## 1. Visión General y Propósito del Bot

### 1.1 Objetivo principal

Automatizar de extremo a extremo la **matriz E2E masiva de 35 casos** (`MATRIZ_E2E_MASIVA.md`) que recorre el flujo logístico y de producción con **estado acumulativo** (sin limpieza entre módulos): Aprovisionamiento → Consumibles → Traslados → Ajustes → MRP → Canjes. El bot no valida la interfaz gráfica; valida la **precisión matemática del backend**: Precio Promedio Ponderado (PPP), Kardex por almacén, reglas LIFO, congelamiento de costo en salidas, revalorización en cuadres y bloqueos de negocio (pruebas negativas).

### 1.2 Alcance de la automatización

| Capa | Qué automatiza | Qué NO automatiza |
|---|---|---|
| Documentos | Solicitud/OC/Compra/NC, consumibles, requerimiento/OM/movimiento, mermas, cuadres, recetas, OPs, guías | Ejecución física de producción (transformación), facturación/SUNAT (GRE), POS/ventas |
| Validación | Stock y costo por almacén tras cada transacción, literales de bloqueo, vínculos de canje | Renderizado HTML/CSS, tiempos de respuesta |
| Datos | Alta de maestros QA (`Carne QA`, `Caja de Empaque QA`, `Plato QA`, `Insumo Importado QA`), limpieza + semilla | Datos productivos (solo BD local `logisticaaa`) |

### 1.3 Tecnologías

| Componente | Tecnología | Uso |
|---|---|---|
| Runtime/lenguaje | Node.js + TypeScript (`strict`, ES2020, CommonJS) | Todo `src/`; compilación `tsc -p tsconfig.json`, ejecución `ts-node` |
| Automatización | **Playwright** (`chromium.connectOverCDP`) | Se adosa a un Chrome ya abierto (puerto 9222); **no** lanza navegador. Reutiliza la pestaña logueada (`obtenerPaginaApp`) |
| Inyección AngularJS | `page.evaluate()` + scope-walk desde `$rootScope` | Mutación de `$scope`/`vm`, llamadas a services (`CommonCollection`, `Insumo`, `Compra`, `OrdenproduccionResource`, etc.), `$timeout` para digest seguro |
| BD | `mysql2/promise` | Limpieza (`db.ts`), semilla de catálogos, oráculo de consumibles (tabla espejo) |
| Reportes | `exceljs` (legacy), `pdfkit` + HTML propio (`reporte.ts`) | `Reporte_Suite.html/.pdf` (+ per-bloque), tabla N°/Fase/Paso/Estado/Esperado/Real/Error con verde/rojo |
| Entorno | XAMPP (Apache :80 + PHP 7.1 + MySQL :3306), frontend grunt :9002, API `//<host>/webapp/` | Ver `definitions.js` (`_dominio`) y §6.4 |

---

## 2. Arquitectura de la Suite de Pruebas (Bloques Operativos)

### 2.1 Diagrama de ejecución

```
npm run test:suite → src/e2e/suite.ts
  ├─ abrirStandalone(true): limpiarBaseDatos() + semilla + 1 browser + 1 page + estado{} + reporte[]
  ├─ runBloque1(page, estado, reporte)  casos 1-9   (Aprovisionamiento)
  ├─ runBloque2(page, estado, reporte)  casos 10-12 (Consumibles)
  ├─ runBloque3(page, estado, reporte)  casos 13-18 (Traslados)
  ├─ runBloque4(page, estado, reporte)  casos 19-20 (Ajustes)
  ├─ runBloque5(page, estado, reporte)  casos 21-28 (MRP)
  ├─ runBloque6(page, estado, reporte)  casos 29-35 (Canjes)
  └─ Reporte_Suite.html + Reporte_Suite.pdf (resumen Éxitos/Fallidos)
```

Cada spec expone `runBloqueN(page, estado, reporte)` **puro** (sin browser/limpieza/reporte) y conserva su `main()` standalone tras `if (require.main === module)` para depuración aislada (`npm run test:bloqueN`). El contrato está en `src/e2e/harness.ts`: `ContextoSuite`, `logFila`, `logVeredicto`, `abrirStandalone`, `diag()`/`DEBUG`.

### 2.2 Bloques y módulos del ERP que validan

| Bloque | Spec | Casos | Objetivo | Módulos ERP ejercitados |
|---|---|---|---|---|
| 1 Aprovisionamiento | `aprovisionamiento.spec.ts` | 1-9 | Alta de insumo, cadena Solicitud→OC→Compra, PPP, NC cantidad (costo congelado), LIFO, negativa de OC canjeada | `insumo`, `requerimientocompra`, `ordencompra`, `compra`, `notacreditocompra` |
| 2 Consumibles | `consumibles.spec.ts` | 10-12 | Alta con `insumo_consumible='1'`, compra y salida con Kardex en **tabla espejo** | `insumo` (flag), `compra`, `merma`, `movimientoalmacenconsumible` |
| 3 Traslados | `traslados.spec.ts` | 13-18 | Requerimiento→OM→movimiento (doble vía con costo heredado), guía documentaria, negativa por emulación, salida en destino | `requerimientomovimiento`, `ordenmovimiento` (`solitudmovimiento`), `movimiento`, `merma`, `emulador` |
| 4 Ajustes | `ajustes.spec.ts` | 19-20 | Cuadre faltante (costo congelado) y sobrante (**revaloriza** al costo digitado), con `procesarCuadrePendiente` obligatorio | `cuadremanual`, `detallecuadremanual` |
| 5 MRP | `mrp.spec.ts` | 21-28 | Recetas 1:1, OPs, detección de faltantes vía `obtenerParaAbastecer`, desvío interno/externo, aprobación/freno, recepción del importado | `receta`, `ordenproduccion`, `requerimientocompra`, `ordencompra`, `compra` |
| 6 Canjes | `canjes.spec.ts` | 29-35 | OC→Guía de compra (`ordencompraList`), traslado 2.º lote, requerimiento→OP (`requerimientomovimiento_id`) | `ordencompra`, `guia`, `requerimientomovimiento`, `movimiento`, `ordenproduccion` |

### 2.3 Reglas transversales de la suite

1. **Acumulación estricta**: solo el Bloque 1 limpia (`data/limpieza_bd.sql`, 77 statements + semilla). Los demás asumen el cierre del anterior y lo **verifican como precondición con fail-fast** (aborto del bloque, no cascada de timeouts).
2. **Oráculo tras cada mutación**: toda escritura va seguida de lectura de stock/costo (ver §4).
3. **Negativas sin literales frágiles**: se aserta el bloqueo funcional (tipo≠1, flag, estado), no la ortografía del mensaje.
4. **Sucursal = almacén 18 "Producción"** (el local 1 solo tiene el 1 Principal y el 18); Central = almacén 1.

---

## 3. Estructura de Datos y Payloads Clave (El Cómo)

Convención: payloads calcados de los controllers AngularJS citados; inyección vía services (`*Resource`) con `page.evaluate`, nunca clics en grids. `BASE = //localhost/webapp/restaurant/logistica/rest/` (vía `BACKEND_LOGISTICA`).

### 3.1 Creación de Insumos — `POST producto/insumo/registrarInsumo`

Helper: `crearInsumo()` / `crearConsumible()` / `crearReceta()` en `src/bot.ts` (todos convergen en `registrarInsumo()`, que navega a `logistica.insumos.nuevo` o `logistica.insumos.consumible.nuevo`, espera `esperarInsumoListo` — `vm.registrarInsumo` + `listaUnidadesMedida` + `listaCategoriainsumo` + `insumo.almacenes` — e inyecta `vm.insumo`).

```json
{
  "insumo_codigo": "E2E-<ts>", "insumo_codigointerno": "E2E-<ts>",
  "insumo_nombre": "Carne QA", "unidadmedidainsumo_id": 1,
  "categoriainsumo_id": "<id 'Categoria uno'>", "clasificacionabcSelected": {"id": "1"},
  "insumo_porcentajeventa": 0, "insumo_mermaporcentaje": 0,
  "insumo_consumible": "0",
  "presentaciones": [{ "presentacioninsumo_nombre": "Base", "presentacioninsumo_cantidad": 1, ... }],
  "almacenes": [{ "almacen_id": 1, "almacen_controlar": true, "inventario_cantidad": 0, "costoApertura": 0 }]
}
```

Reglas aplicadas: `insumo_consumible='1'` solo en vista consumible; apertura dispara `producto/insumo/aperturarStock` (esperado por el bot).

### 3.2 Solicitudes de Compra — `POST compra/requerimientocompra/registrar`

Helper: `registrarSolicitud()` (`aprovisionamiento.spec.ts`). Shape de `nuevo.requerimiento.compra.controller.js:225-261` + `_genererarDetalleCompra` (`models/requerimientocompra.js:700-755`):

```json
{
  "local_id": 1, "almacen_id": 1, "usuario_id": 1,
  "requerimientocompra_fechaentrega": "2026-09-26",
  "detallerequerimientocompraList": [{
    "detallerequerimientocompra_descripcion": "Carne QA",
    "detallerequerimientocompra_cantidad": 50, "requerimientocompra_id": "-1",
    "tipo": 1, "insumo_id": 1620, "producto_id": null,
    "presentacioninsumo_id": "<default>", "almacen_id": 1, "almacenSeleccionado": {...}
  }]
}
```

Regla: fecha `Y-m-d` **futura** (el validator rechaza pasadas); item resuelto por `busquedaSensitivaSegunTipos` + presentación por defecto (`item_presentacionid`).

### 3.3 Órdenes de Compra — `POST ordencompra/registrarOrdencompra`

Helper: `registrarOrdenCompra()`. Shape de `nueva.orden.compra.controller.js:736-786` + `_genererarDetalleOrdencompra` (`models/ordencompra.js:668-746`). **El 500 `__clone ... on non-object` (`OrdencompraLogistica.php:223`) ocurre si falta la clave `ordencompra`**: el payload es `{ordencompra: {...}, productos: [...]}`:

```json
{
  "ordencompra": { "local_id": 1, "proveedor_id": 1, "moneda_id": 1,
    "ordencompra_tipocambio": "1.0000", "ordencompra_fecha": "2026-09-26" },
  "productos": [{ "item_id": 1620, "item_tipo": 1,
    "detalleordencompra_descripcion": "Carne QA",
    "detalleordencompra_precio": 20, "detalleordencompra_costo": 20,
    "detalleordencompra_cantidad": 50, "detalleordencompra_importe": 1000,
    "ordencompra_id": "-1", "insumo_id": 1620, "almacen_id": 1, "almacenSeleccionado": {...} }]
}
```

Anulación: `GET ordencompra/anularOrdencompra/{id}`; con compra vigente responde bloqueo ("canjeada por una compra", caso 9).

### 3.4 Órdenes de Producción — `POST produccion/ordenproduccion/agregar`

Helper: `crearOP()` (`mrp.spec.ts`). Shape de `parseOrdenproduccion()` (`nuevaorden.controller.js:1478-1554`):

```json
{
  "local_id": 1, "almacen_id": null,
  "ordenproduccion_fechaestamada": "2026-09-25 18:52:13",
  "ordenproduccion_encargado": "BOT QA", "ordenproduccion_estado": 0,
  "detalleordenproduccionList": [{
    "almacen_id": 18, "insumo_id": "<platoId>",
    "unidadmedidainsumo_id": 1, "detalleordenproduccion_cantidadestimada": 20
  }]
}
```

**Workaround crítico (regla de oro MRP): NO enviar `detalleordenproduccion_estado`.** La entity lo incluye en el INSERT si viene seteado (`DetalleordenproduccionEntity.php:258-259,282`) pero **no tiene su `bindParam`** (falta entre líneas 295-312) → `SQLSTATE[HY093]` HTTP 500. Sin el campo, el backend asigna el default y el detalle persiste. El bot documenta esto in-situ; si desarrollo agrega el bind faltante, el campo puede volver.

### 3.5 Requerimientos de Stock — `POST requerimientomovimiento/agregarSolicitudAbastecimiento`

Helper: `registrarReqStock()` (`traslados.spec.ts`). Shape de `solicitud.controller.js:639-649`:

```json
{
  "requerimiento": { "local_id": 1, "requerimientomovimiento_fecha": "2026-09-25 16:01:57" },
  "productos": [{ "insumo_id": 1620, "producto_id": null,
    "detallerequerimiento_cantidad": 40,
    "detallerequerimiento_almacendestinoid": 18 }]
}
```

Regla: `requerimientomovimiento_fecha` en `Y-m-d H:i:s` y **no pasada** (margen +5 min en el bot); sin ella: `"La fecha asignada al requerimiento no es valida."` (`RequerimientomovimientoLogisticaValidator.php:105-120`).

### 3.6 Movimientos — `POST movimiento/agregarOrdenmovimiento`, `POST movimiento/agregar`

Helpers: `registrarOrdenMovimiento()` (`{movimiento:{local_id, almacen_id(origen, FK obligatoria), solitudmovimiento_fechaestimada, solitudmovimiento_solicitante}, productos:[...]}`) y `registrarMovimiento()` (`{movimiento:{local_id, movimiento_fecha}, productos:[detalle...]}`), con detalle `detallemovimiento_*` (`_genererarDetalleMovimiento`, `models/movimiento.js`: `descripcion/unidadmedida/cantidad/cantidadsolicitada, movimiento_id:'-1', tipo, almacen_id(origen), almacenorigenid, almacendestinoid, insumo_id/producto_id, presentacioninsumo_id`). Sin `almacen_id` en cabecera de OM: FK 1452 (`solitudmovimiento.almacen_id`).

### 3.7 Recetas — `POST producto/receta/registrarReceta`

Helper: `crearReceta()` (`bot.ts`): reutiliza el builder de insumo y desvía a `Insumo.registrarReceta(vm.insumo)` con `ingredientesList:[{receta_insumoid, receta_cantidad, unidadmedidainsumo_id}]` + `insumo_genera`. Reglas: exige `categoriareceta_id` (NO `categoriainsumo_id`; `InsumoLogisticaValidator.php:910-916`), resuelta vía `obtenerCategoriarecetaList()`; y **eliminar `insumo_tienereemplazables`/`reemplazables`** del payload (deriva esquema-código: la columna no existe en `logisticaaa.insumo` y con dominio local el backend la incluiría en el INSERT → 500 `InsumoEntity.php:1189`). Recetas QA 1:1 en UNIDAD (1 plato = 1 kg) para que los números de la matriz apliquen directos.

---

## 4. El Motor de Validación (Oráculo y Kardex)

### 4.1 `validarStock()` — insumos normales (`src/kardex.ts` + `src/e2e/oracle.ts`)

1. Resuelve el `item_id` por nombre exacto vía `CommonCollection.busquedaSensitivaSegunTipos` (21 args posicionales).
2. Lee `Insumo.obtenerStockYCosto(id)` → `GET producto/insumo/obtenerStockYCosto/{id}` → array por almacén.
3. Toma **`data[].costo`** (PPP real con impuestos); `costoStock.costopromedio` es fallback (suele ser 0: el backend solo lo calcula con flag `retornar_costo_promedio`).
4. Compara con tolerancia **0.02**; reintenta 0/0 transitorios (digest async tras `actualizarCompra`).
5. `assertStockInsumoEnAlmacen()` extiende lo mismo filtrando por `almacen_descripcion` (Central vs Producción) — `kardex.ts` original solo miraba el Principal.

### 4.2 `validarStockConsumible()` — tabla espejo (`oracle.ts`)

Los consumibles (`insumo_consumible='1'`) **no pasan** por `movimientoalmaceninsumo` sino por **`movimientoalmacenconsumible`** (`InsumoLogistica.php:6212-6237`; constantes `TIPO_*` invertidas). Como las SALIDAS persisten `saldoactual=0/costo=0`, el oráculo **calcula**, no lee la última fila:

```
stock = Σ entradas(tipo=1) − Σ salidas(tipo=0) vivas (fueeliminado != '1')
costo = costopromedioactual de la última ENTRADA viva
```

Sin movimientos + esperado 0/0 = OK (alta fresca).

### 4.3 PPP esperado vs real

`ppp(stockAnt, costoAnt, cant, costo) = (stockAnt*costoAnt + cant*costo)/(stockAnt+cant)` (`fixtures.ts`, espejo de `MovimientoalmaceninsumoV2.php:2969-2987`, redondeo a 3 decimales en aserciones). Reglas del backend que el oráculo replica:

| Evento | Stock | Costo |
|---|---|---|
| Entrada (compra/guía/traslado-destino/sobrante→*ver nota*) | +cantidad | PPP recalculado |
| Salida (merma, consumo, NC cantidad, traslado-origen, faltante) | −cantidad | **congelado** (movimiento a costo 0) |
| NC precio | sin cambio | re-entrada clonada |
| Anulación | contra-movimiento + `regularizarEntradasDesdeID` | recalculado hacia adelante (LIFO vuelve exacto) |
| Cuadre sobrante | +diferencia | **revalorizado** al costo digitado (`TIPO_CUADRE: costopromedioactual=costooperacion`, NO promedia) |

---

## 5. Flujos de Automatización Complejos (Deep Dive)

### 5.1 Flujo MRP (casos 21-28, `mrp.spec.ts`)

```
crearReceta("Plato QA", [Carne 1×1]) ──→ POST receta/registrarReceta
crearOP(plato, 5, alm.18) ──→ POST ordenproduccion/agregar ──→ evaluarFaltantes ──→ []
caso 21 OK (cabe en stock 8)
crearOP(plato, 20, alm.18) ──→ evaluarFaltantes ──→ [Carne 12]
   ├─ generarDesvioInterno ──→ GET generarOrdenMovimiento/{op} ──→ solitudmovimiento (origen=alm. abastecimiento)
   ├─ caso 23: OP PENDIENTE(0) ≠ APROBADA(4) → bloqueada, stocks intactos
   ├─ registrarMovimiento(12) ──→ Central 45→33, Sucursal (8×30+12×25)/20=27
   └─ aprobarOP ──→ GET aprobar/{op} ──→ estado 4 (freno liberado)
crearInsumo Importado + crearReceta(Plato Importado 1:1)
crearOP(importado, 80) ──→ faltantes [80] ──→ registrarSolicitud(80) [desvío externo manual]
registrarOrdenCompra(80@15) + registrarCompra ──→ Central 80/15
```

Puntos finos documentados en código:

- **Detección de faltantes**: `obtenerInsumoRecetaFaltanteParaProducir` **solo explota sub-recetas/derivados** (`continue` en `InsumoLogistica.php:6820-6822`): con ingredientes planos siempre da `[]`. El bot usa **`obtenerParaAbastecer/{op}/{almacen}/{validarStock}`** (ruta ToolInsumos, `item_cantidadFaltante = cantidad − stock`) y parsea `itemPorAbastecer[].item_cantidad` (los items NO traen claves `*faltante*`: un parser anterior que las buscaba daba falsos negativos).
- **Desvío interno real**: `generarOrdenMovimiento` salta almacenes iguales al de abastecimiento (`OrdenproduccionLogisticaController.php:61-63`). Dato maestro corregido: `almacen.deabastecimiento`: Central(1)=1, Producción(18)=0 (estaba al revés y el desvío se saltaba todo con "No se encontraron ingredientes").
- **"Freno de Seguridad"** no existe como literal; la regla es *solo OP APROBADA se prepara* (`verordenproduccion.controller.js:709-718`).

### 5.2 Flujo de Canjes (casos 29-35, `canjes.spec.ts` + §3)

Viaje de identificadores (`estado: EstadoSuite` compartido por `suite.ts`):

```
OC-2 = registrarOrdenCompra(30@22) ──→ id
guía = registrarGuia({..., ordencompraList:[OC-2]}) ──→ GuiaLogistica:178 copia a listaOrdenesCompra
     ──→ ordencompra.guia_id = 28, Central (33×25+30×22)/63 = 23.571  [verificado por DIAG CanjeGuia]
req  = registrarReqStock(10) ──→ OM = registrarOrdenMovimiento(10)
mov  = registrarMovimiento(10) ──→ Central 63→53, Sucursal (20×27+10×23.571)/30 = 25.857
reqP = registrarReqStock(15)
OP   = crearOP(plato, 15, alm.18, {requerimientoId: reqP}) ──→ consultarOP aserta
       requerimientomovimiento_id == reqP (vieneDeUnRequerimiento, OrdenproduccionLogistica:1315)
```

Canjes previos reutilizados: compra→OC por `compra_ordencompraList[]` (caso 4, `CompraLogistica.php:294-295`; `ordencompra_id` plano lo ignora el backend).

---

## 6. Diagnósticos y Manejo de Errores

### 6.1 Filosofía `[DIAG]`

Cada helper de escritura devuelve `{ok, id?, error?, raw?, payload?}` donde `raw = {tipo, mensajes, data}` es **el JSON crudo de PHP** y `payload` lo enviado. Tras cada llamada se imprime `[DIAG <Modulo>]` + la red capturada por `waitForResponse` (`esperarEndpoint`). Esto convirtió cada first-run en un contrato ejecutable: el backend dice exactamente qué campo falta (`cantidad is not defined`, `__clone ... non-object`, `FK 1452`, `HY093`, `"La fecha ... no es valida"`), se ajusta el payload a la medida y la siguiente corrida pasa.

### 6.2 Catálogo de DIAGs

| Tag | Cubre | Dato clave que aporta |
|---|---|---|
| `[DIAG Sesion]` | Pre-flight | `url`, `$state`, `usuarioId`, `localId` (detecta pestaña sin login: causa del timeout de 60s) |
| `[DIAG InsumoVista]` | Solo `DEBUG=1` | `foundVm`, `um/cat/alm` (cazó el `cat:0` → semilla de categoría) + sonda UM |
| `[DIAG Solicitud/OrdenCompra]` | Casos 2-3, 27-28 | payload + `raw` + red |
| `[DIAG CanjeOC/CanjeGuia]` | Casos 4, 30 | vínculo + **relectura del documento padre** (`compra_id`/`guia_id` en la OC) |
| `[DIAG Movimiento/OrdenMov/ReqStock/Emular]` | Bloque 3 | payload + red; Emular muestra `operacionRestringidaPorStockNegativo` y la simulación −150 sin persistir |
| `[DIAG Salida/SalidaSuc]` | Casos 12, 18 | `raw` de `merma/agregarMerma` |
| `[DIAG Cuadre19/20-procesar]` | Casos 19-20 | id de cuadre + resultado de `procesarCuadrePendiente` (el guardar deja el cuadre **pendiente**: sin procesar no toca Kardex) |
| `[DIAG OP/Faltantes/DesvioInt/AprobarOP]` | Bloque 5 | `raw` + `porAbastecer=[{id, cant}]` resumido (no trunca a 2000 chars) |

### 6.3 Controles de robustez del arnés (`harness.ts`)

- `DEBUG`/`diag()`: verbosidad opt-in (`$env:DEBUG='1'` en PowerShell); en verde la consola solo trae `[OK]/[FALLO]`.
- Timeouts acotados (endpoints 45-60s, vistas 25s) y sleeps mínimos donde ya hay barrera de red.
- **Fail-fast por precondición** (Bloques 3-6): sin el estado del bloque previo se aborta con una fila explícita en vez de pagar N timeouts en cascada.
- Patrón de inyección: scope-walk por marca `vm`, datos vía services, mutaciones dentro de `$timeout` (digest seguro, nunca `$apply` directo), lectura de confirmación por `waitForResponse` + `leerRespuesta`, modales cerrados con `cerrarModales()` (`.swal2-confirm`/`.swal2-close`).

### 6.4 Entorno y operaciones

- **BD real:** MySQL `logisticaaa` (localhost:3306, root/sin clave). La define `webapp/parameters.php:59-63` (caso 0); `db.ts`/`oracle.ts` usan `DB_NAME=logisticaaa` (hubo un bug histórico apuntando a `logistica`, ya corregido). **No existe usuario MySQL `admin`**: `admin/seven26$` es login de app (`usuario_nick`/`usuario_clave` en texto plano).
- **Origen único:** frontend `:9002` + API `:80/webapp` vía `_dominio = '//'+hostname+'/webapp/'` en `definitions.js`. Sin esto: `Cannot GET /restaurant/...`, escritorio en blanco y login "incorrecto" con credenciales válidas.
- **Limpieza** (`data/limpieza_bd.sql`, 77 statements): orden hijos-primero deduplicado con `FOREIGN_KEY_CHECKS=0` (obligatorio: ciclos `insumo↔producto↔productogeneral` + auto-referencias hacen imposible el orden topológico puro). **Excluye maestros** (categorías, productos generales); incluye cabeceras (`compra`, `guia`, `notacreditocompra`) para no chocar con `existeCompra/existeGuia`. Semilla idempotente en `db.ts`: `Categoria uno` activa + config de abastecimiento documentada.
- **Defectos reportados a desarrollo** (con archivo:línea): bind faltante `:detalleordenproduccion_estado` (`DetalleordenproduccionEntity.php:281-312`); `false &&` que desactiva el chequeo de movimientos posteriores (`MovimientoValidator.php:62`); `_validarAnulacion` vacía en solicitudes (`RequerimientocompraLogisticaValidator.php:75-79`).

---

---

## 7. Operación y Mantenimiento del Bot

### 7.1 Instrucciones de Ejecución

**Precondiciones (siempre, en este orden):**

1. XAMPP corriendo (Apache :80 + MySQL :3306). Verificar: `http://localhost/restaurant/logistica/rest/compra/obtenerCompra/1` debe responder `{"tipo":"401",...}` (API viva), no 404.
2. Frontend servido en `:9002` (grunt) con `_dominio` apuntando a `/webapp/` (ver §6.4).
3. Chrome abierto con depuración remota y pestaña logueada (matar instancias previas primero):
   ```powershell
   taskkill /F /IM chrome.exe /T & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-temp" --remote-allow-origins="*"
   # abrir http://localhost:9002/#!/escritorio e iniciar sesión (admin / seven26$)
   ```
   Sin pestaña logueada en ese Chrome, el bot (`connectOverCDP`) no tiene sesión y todo timeoutea.
4. Dependencias instaladas (`npm install`) y compilación sana (`npx tsc -p tsconfig.json --noEmit`).

**Suite completa (35 casos, ~5 min en verde):**

```powershell
npm run test:suite          # limpia 1 vez, encadena Bloques 1→6, Reporte_Suite.*
```

**Bloque individual (depuración aislada):**

```powershell
npm run test:bloque1        # casos 1-9   (limpia; deja estado para el 3)
npm run test:bloque2        # casos 10-12 (limpia; independiente)
npm run test:bloque3        # casos 13-18 (asume cierre del Bloque 1)
npm run test:bloque4        # casos 19-20 (asume cierre del Bloque 3)
npm run test:bloque5        # casos 21-28 (asume cierre del Bloque 4)
npm run test:bloque6        # casos 29-35 (asume cierre del Bloque 5)
```

Regla de oro: los Bloques 3-6 **no limpian**; si su precondición falla, abortan con fila explícita (`Bloque N abortado`). Para aislarlos: `BLOQUE3_LIMPIAR=1 npm run test:bloque3` (los stocks no coincidirán con la matriz, solo sirve para depurar payloads).

**Modo detallado:**

```powershell
$env:DEBUG='1'; npm run test:suite   # PowerShell (sintaxis bash VAR=1 no funciona aquí)
```

`DEBUG=1` activa los `[DIAG]` (payloads, JSON crudos, red). En verde se omite para no pagar I/O de consola. Exit codes: `0` todo verde, `1` hay fallidos, `2` error fatal.

### 7.2 Cómo agregar un nuevo Bloque o Caso

**Nuevo caso dentro de un bloque existente:** añadir el paso en el `runBloqueN` correspondiente siguiendo el patrón invariable — *mutación → DIAG implícito en el helper → `val(assert...)`*. Los IDs intermedios van a `estado` (`EstadoSuite` en `fixtures.ts`); los datos de entrada a constantes `QA_*` en el mismo archivo. Nada de literales sueltos en el spec.

**Nuevo bloque (ej. `mimodulo.spec.ts`):**

1. Crear `src/e2e/mimodulo.spec.ts` con esta plantilla mínima:
   ```ts
   import { Page } from 'playwright';
   import { navegar, cerrarModales } from '../bot';
   import { FilaReporte } from '../types';
   import { EstadoSuite } from './fixtures';
   import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
   import { logFila, logVeredicto, abrirStandalone } from './harness';

   const F = 'Bloque 7: Mi Módulo';

   /** Casos N-M. PRECONDICIÓN: cierre del Bloque 6 (documentar stocks exactos). */
   export async function runBloque7(page: Page, estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
     const log = (f: FilaReporte): void => logFila(reporte, f);
     const val = (v: { paso: string; ok: boolean; esperado: string; real?: string; error?: string }): void =>
       logVeredicto(reporte, F, v);
     await navegar(page, 'logistica.escritorio');
     await page.waitForTimeout(500);
     await cerrarModales(page);
     // 1. Precondición con fail-fast (copiar patrón de traslados.spec.ts).
     // 2. Casos: helper de escritura (retorna {ok,id,error,raw}) + val(assert...).
   }

   /** Entrada standalone: npm run test:bloque7. */
   async function main(): Promise<void> {
     const ctx = await abrirStandalone(false); // true solo si el bloque es independiente
     await runBloque7(ctx.page, ctx.estado, ctx.reporte);
     const resumen = resumirReporte(ctx.reporte);
     const html = generarHtmlReporte(ctx.reporte, resumen);
     await fs.writeFile(path.resolve('data', 'Reporte_Bloque7.html'), html, 'utf8');
     await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque7.pdf'), resumen);
     console.log('\n== Bloque 7 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
     await ctx.browser.close();
     process.exit(resumen.fallidos ? 1 : 0);
   }

   if (require.main === module) {
     main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
   }
   ```
2. Registrar en `suite.ts` (`import { runBloque7 } ...` + llamada tras el Bloque 6) y en `package.json` (`"test:bloque7": "ts-node src/e2e/mimodulo.spec.ts"`).
3. **Obligatorio:** el `if (require.main === module)` — sin él, importar el spec desde `suite.ts` ejecutaría su `main()` (limpieza + `process.exit`) e impediría la unión. Verificado con `ts-node -e "require('./src/e2e/X.spec')"`.
4. Documentar el bloque en `MATRIZ_E2E_MASIVA.md` (numeración continua) y sus fórmulas en `REPORTE_ARQUITECTURA_KARDEX.md` antes de programar.

### 7.3 Mantenimiento del Oráculo y Limpieza BD

**Nueva tabla transaccional en el ERP** (ej. un nuevo documento con detalle):

1. Añadir `DELETE FROM <tabla> WHERE <pk> > 0;` a `data/limpieza_bd.sql` respetando las fases: **detalles (Fase 1) → movimientos Kardex (Fase 2) → cabeceras (Fase 3) → presentaciones/maestros del bot (Fase 4)**. Hijos siempre antes que padres.
2. **No intentar orden topológico puro**: hay ciclos (`insumo↔producto↔productogeneral` + auto-referencias); la seguridad la da `FOREIGN_KEY_CHECKS=0/1` que envuelve el script, el orden es higiene + velocidad. Verificar PKs contra `restaurant.sql` antes de escribir el `WHERE` (las 73 actuales están verificadas).
3. **Jamás incluir maestros de catálogo** (categorías,UM, almacenes, locales, proveedores, configuraciones): van en `asegurarCatalogosMinimos()` (`db.ts`) como semilla idempotente, nunca en DELETE.
4. Si el documento mueve Kardex en tabla nueva/espejo, extender `oracle.ts` (nuevo `leerStock*` + `assert*`) siguiendo el patrón `leerStockConsumible`: cálculo por movimientos vivos, nunca última fila.
5. Probar: `npm run test:suite` debe seguir 100% verde; la limpieza rota se detecta al instante (FK 1452 o residuos que alteran el caso 1).

**Nueva regla de negocio que afecte costos**: actualizar la tabla de §4.3, los `esperado` de la matriz y los specs el mismo día — oráculo y matriz nunca deben divergir (la divergencia 26.875 vs 30 del caso 20 es el ejemplo canónico de por qué).

### 7.4 Gestión de Reportes

| Artefacto | Ruta | Cuándo se genera |
|---|---|---|
| Reporte global HTML/PDF | `data/Reporte_Suite.html`, `data/Reporte_Suite.pdf` | Siempre al final de `test:suite` (éxito o fallo) |
| Reportes por bloque | `data/Reporte_BloqueN.html/.pdf` | Solo en corridas standalone `test:bloqueN` |
| Excel legacy | `data/Reporte_Bot.xlsx` | Solo suite legacy `src/legacy/` (no usar) |
| Dumps de diagnóstico | `data/debug_notaCredito_*.json`, `data/debug_modificarCompra_*.json` | Solo cuando un helper necesita volcar estructuras del `$scope` |

**Cómo interpretar el reporte tras una corrida:**

1. Cabecera: fecha, total, Éxitos/Fallos. Si Fallidos > 0, el `process.exit(1)` lo refleja en CI.
2. Filas numeradas (N° continua 1..N, fases en orden de ejecución). Fila **roja** = aserción fallida con `Esperado vs Real` + `Error` (literal del backend o del bot).
3. Protocolo de triaje: (a) ¿falló la precondición del bloque? → el problema está en el bloque anterior, no en este; (b) ¿el `Real` es timeout/ составило nulo? → entorno (sesión, API caída), reintentar; (c) ¿divergencia numérica? → comparar contra §4.3 y `MATRIZ_E2E_MASIVA.md`: si el backend tiene razón, actualizar matriz+spec el mismo día; si no, defecto a desarrollo con archivo:línea.
4. Para depuración profunda, re-correr con `DEBUG=1`: los `[DIAG]` muestran payload enviado, JSON crudo PHP y respuesta de red por cada escritura.

---

*Documentos relacionados: [Matriz E2E masiva](../qa/matriz-e2e-masiva.md) (los 35 casos), [Blueprint de automatización](blueprint-automatizacion.md) (selectores/endpoints), [Reporte de arquitectura del Kardex](../qa/reporte-arquitectura-kardex.md) (fórmulas), [Blueprint de porcionar insumos](blueprint-porcionar-insumos.md) (recetas $digest/ui-select), [AI_CONTEXT](ai-context.md) (reglas de inyección AngularJS), [Manual maestro del negocio](../negocio/manual-maestro-logistica.md) (contexto funcional).*

