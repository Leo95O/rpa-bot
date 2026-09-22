# AI_CONTEXT.md — Contexto técnico del proyecto RPA E2E (logisticaview)

> Manual de instrucciones **IA a IA**. Léelo completo antes de tocar código.
> El objetivo de este repo es ejecutar pruebas E2E que automatizan un flujo transaccional
> (crear insumos → compras → guías de ingreso → validaciones de Kardex) contra una aplicación
> legacy **AngularJS v1.x** con backend **PHP/MySQL**.

---

## 1. Stack tecnológico

| Capa | Tecnología | Notas |
|------|------------|-------|
| Automatización | **Playwright** (`chromium.connectOverCDP`) | Se conecta a un Chrome ya abierto vía CDP, **no** lanza navegador propio. |
| Runtime | **Node.js + ts-node** | Scripts ejecutados con `ts-node src/*.ts`. Compilado con `tsc` a `dist/`. |
| Excel | **exceljs** | Lectura del Excel de datos (`parser.ts`) y escritura del reporte (`test-e2e.ts`). |
| BD | **mysql2** (promise) | Limpieza de base de datos en `db.ts`. |

Dependencias (package.json): `playwright`, `exceljs`, `mysql2` + devDeps `ts-node`, `typescript`, `@types/node`.

Scripts npm:
- `npm run test:e2e` → `ts-node src/test-e2e.ts` (orquestador E2E actual).
- `npm run build` → `tsc -p tsconfig.json`.
- `npm start` → `node dist/index.js` (orquestador legacy por Excel).
- `npm run dev` → `ts-node src/index.ts` (orquestador legacy por Excel).

---

## 2. Peculiaridades del FRONTEND (CRÍTICO — AngularJS legacy)

### 2.1. Qué es la app
- SPA AngularJS **v1.x** servida en `http://localhost:9002` (estado UI-Router vía hash, ej. `#!/escritorio`).
- Backend API REST en `http://localhost:9001`, con el módulo logística en el prefijo
  `BACKEND_LOGISTICA` = `/restaurant/logistica/rest/` (definido en `logisticaview/app/scripts/definitions.js`).
- Código fuente frontend: `C:\Practicas\RESTAURANT_PROYECT\logisticaview`.
- Código fuente backend: `C:\xampp\htdocs\webapp` (logística en `\logistica`).

### 2.2. Cómo extraer/inyectar datos en el `$scope`
Toda interacción se hace con `page.evaluate()` dentro del contexto del navegador. El patrón base:

```ts
await page.evaluate(async () => {
  const injector = angular.element(document.body).injector();
  const $rootScope = injector.get('$rootScope');          // raíz de scopes
  const CommonCollection = injector.get('CommonCollection'); // búsquedas/catálogos
  const Insumo = injector.get('Insumo');                  // modelo/factory de insumos
  const Compra = injector.get('Compra');                  // modelo/factory de compras
  const Guia   = injector.get('Guia');                    // modelo/factory de guías
  const SecurityService = injector.get('SecurityService'); // local/usuario/token actual
  const PARAM = injector.get('PARAM');                    // constantes SI/NO/ACTIVO/TODOS
  // ... lógica ...
});
```

### 2.3. Encontrar el controlador (`vm`) de una vista (scope-walk)
Cada vista usa `controllerAs: 'vm'`. Para llegar al `vm` correcto se recorre el árbol de scopes
desde `$rootScope` buscando una **marca distintiva** (una función/propiedad única del controlador):

```ts
function encontrarScope(marca) {
  let found = null;
  (function walk(s) {
    if (found) return;
    if (s.vm && marca(s.vm)) { found = s; return; }
    let c = s.$$childHead;
    while (c) { walk(c); c = c.$$nextSibling; }
  })($rootScope);
  return found;
}
```

Marcas útiles (funciones del `vm`):

| Estado UI-Router | Marca (`s.vm.X`) | Módulo que lo usa |
|---|---|---|
| `logistica.insumos.nuevo` | `typeof s.vm.registrarInsumo === 'function'` | `bot.ts` (crear insumo) |
| `logistica.compra.nuevacompra` | `typeof s.vm.procesarDatosCompra === 'function'` | `bot.ts` (registrar compra) |
| `logistica.compra.editarcompra` | `typeof s.vm.fnActualizarCompra === 'function'` | `compras.ts` (modificar) |
| `logistica.guiacompra.nuevaguia` | `s.vm.guia && typeof s.vm.guia.agregar === 'function'` | `guias.ts` (registrar guía) |
| `logistica.guiacompra.editarguia` | `s.vm.guia && typeof s.vm.fnobtenerGuia === 'function'` | `guias.ts` (modificar guía) |
| `logistica.kardex.individual` | `typeof s.vm.fnPrepararFiltrosParaCargarKardex === 'function'` | `kardex.ts` (legacy) |

### 2.4. Navegación
```ts
// bot.ts
export async function navegar(page, estado, params?) {
  await page.evaluate((a) => {
    const injector = angular.element(document.body).injector();
    injector.get('$state').go(a.estado, a.params);
  }, { estado, params });
}
```
Estados: `logistica.escritorio`, `logistica.insumos.nuevo`, `logistica.compra.nuevacompra`,
`logistica.compra.editarcompra` (param `{ idCompra }`), `logistica.guiacompra.nuevaguia`,
`logistica.guiacompra.editarguia` (param `{ idGuia }`), `logistica.kardex.individual`.

### 2.5. Ciclo `$digest` y esperas (la fuente nº1 de bugs)
AngularJS actualiza el modelo en un `$digest` **asíncrono**. Después de una respuesta HTTP el
`.then()` que puebla `vm.X` corre recién en el siguiente digest. Por eso:
- Tras disparar una acción, usa `esperarEndpoint(page, urlPart, timeout)` (basado en
  `page.waitForResponse`) para esperar la respuesta de red.
- Luego usa `page.waitForFunction(...)` para esperar a que el **modelo** ya esté poblado
  (p. ej. `s.vm.compraList.length > 0 && s.vm.showLoading === false`).
- `page.waitForTimeout(ms)` para asentar la UI (modals, re-renders).

### 2.6. Grillas HandsOnTable (y su trampa)
Las tablas de detalle usan la directiva `rp-hot` (HandsOnTable). El `ng-model` es el array en el
`vm`:
- Compras: `vm.compra.detallecompraList` (y `vm.compra.detallecompraListParaBackend` tras `procesarDatosCompra`).
- Guías: `vm.guia.detalleguiaList`.
- Kardex: `vm.compraList` (grid `id="hot-kardexList"`, **no** existe `.kardex-grid`).

> **Trampa comprobada:** leer el stock/costo desde la grid del Kardex (`vm.compraList`) devolvía
> `stock=0`/`costo=0` de forma no fiable (problemas de filtro de almacén + digest + formato).
> **Solución adoptada:** leer el stock/costo vía el endpoint autoritativo `Insumo.obtenerStockYCosto`
> (ver §3.3), no desde el `$scope` de la grid.

### 2.7. Modales residuales (SweetAlert2 / rpAlert)
Tras registrar insumos/compras, la app muestra un SweetAlert2 ("Guardado exitoso"). Un modal
residual **bloquea la siguiente navegación** (timeout en `waitForFunction`). Mitigación en `bot.ts`:

```ts
export async function cerrarModales(page) {
  try { const c = await page.$('.swal2-confirm'); if (c) await c.click(); } catch {}
  try { const c = await page.$('.swal2-close');   if (c) await c.click(); } catch {}
  await page.waitForTimeout(300);
}
```
`crearInsumo` la llama **antes y después** de registrar cada insumo.

### 2.8. Botones por CSS vs funciones del controlador
Para guardar guías (edición) resultó más fiable **hacer click por CSS** que llamar a la función del
`vm` (que podía no estar expuesta o pedir confirmación). Flujo en `guias.ts`:

1. `button[ng-click="vm.procesarDatosGuia()"]` (Continuar) → muestra previsualización.
2. `button[ng-click="vm.fnActualizarGuia()"]` (Editar guía) → dispara `actualizarGuia`.
3. `.swal2-confirm` → confirma el diálogo de confirmación.

---

## 3. Peculiaridades del BACKEND y BD

### 3.1. Backend PHP (Slim 3) + MySQL
- Base de datos: **`logistica`** en `localhost`, usuario `root` sin password (acceso por CLI con
  `C:\xampp\mysql\bin\mysql.exe -u root logistica`).
- Respuestas envueltas: `{ tipo, mensajes: [], data }`.
  **`tipo` es string**: `SUCCESS='1'`, `ERROR='3'`, `DANGER='3'`. Siempre comparar con
  `Number(tipo) === 1`, nunca `=== 1`.

### 3.2. `db.ts` — limpieza con `FOREIGN_KEY_CHECKS = 0`
`limpiarBaseDatos()` borra (en orden) `presentacioninsumo`, `movimientoalmaceninsumo`,
`almacenproductoinsumo` e `insumo`, envuelto en:

```sql
SET FOREIGN_KEY_CHECKS = 0;   -- antes
... DELETE FROM ... ;
SET FOREIGN_KEY_CHECKS = 1;   -- después
```

Motivo: `insumo` es referenciado por ~40 tablas (`insumoequivalencia`,
`impuestocompraproductogeneralinsumo`, etc.). Sin desactivar FKs, `DELETE FROM insumo` revienta.

> **OJO:** la limpieza **NO borra** `compra`, `detallecompra`, `guia`, `detalleguia`,
> `notacreditocompra`. Por eso los comprobantes (serie/número) se hacen únicos con `Date.now()`
> (ver §3.4) para no chocar con corridas anteriores.

### 3.3. Lectura de stock/costo — `Insumo.obtenerStockYCosto`
Endpoint `GET producto/insumo/obtenerStockYCosto/{insumo_id}` → `data[]` con un elemento por
almacén con control de stock. Campos relevantes:

```json
{
  "almacen_id": 1,
  "almacen_descripcion": "Almacen Principal",
  "stock": 10,
  "costo": 2.0,
  "costoStock": { "costo": 2.0, "stock": 10, "costopromedio": 0, "costosinimpuesto": 1.695 }
}
```

> **Clave:** `costoStock.costopromedio` suele ser **0** porque el backend (`InsumoLogistica::getStockCosto`)
> solo lo calcula si recibe el flag `retornar_costo_promedio`, que `obtenerStockYCosto` **no** envía.
> **Leer siempre `data[].costo`** (el costo promedio real, con impuestos). `kardex.ts` usa `costo`
> como primario y `costoStock.costopromedio` solo como fallback si es `> 0`.

### 3.4. Comprobantes únicos con `Date.now()`
`compras.ts` (`registrarCompra`) y `guias.ts` (`registrarGuia`) añaden un sufijo temporal al
número para evitar colisiones de serie/número (que el backend valida con
`CompraLogisticaValidator::existeCompra()`):

```ts
numero: p.numero + '-' + Date.now()            // compras
guia_numeroguia = args.numero + '-' + Date.now()  // guías
```

### 3.5. Otros datos de backend aprendidos
- **Proveedor**: se busca con `CommonCollection.obtenerProveedorPorBusqueda(nombre)`. Devuelve
  objetos con `proveedor_id`, `proveedor_razonsocial`, `proveedor_ruc`. El `proveedor_id` válido se
  captura **directo de la respuesta de búsqueda** (no de `vm.compra.proveedorSeleccionado`, que
  Angular puede resetear).
- **Fecha de compra** debe ir formateada `YYYY-MM-DD HH:mm:ss` (`moment(...).format(...)`). Un string
  `YYYY-MM-DD` suelto es rechazado ("La fecha de la compra no es valida").
- **Búsqueda de items**: `CommonCollection.busquedaSensitivaSegunTipos(...)` con 21 argumentos
  posicionales (ver firma en `collection.common.js`). Devuelve `data[]` con `item_id`, `item_tipo`
  (`1`=insumo, `2`=producto), `item_descripcion`, `item_codigo`.
- **Config que desactivaría el stock síncrono**: `CONFIGURACION_ENTRADAS_SALIDA_STOCK_DESDE_MODULO_CONTROL_STOCK`
  (id `38`) está en `0` para el local 1 → **el stock SÍ se actualiza sincrónicamente** (no hay worker
  fire-and-forget activo). Si un día el Kardex "no aparece", verificar esta config antes de asumir
  un problema asíncrono.
- **Config costo sin impuestos**: `CONFIGURACION_MOSTRAR_COSTO_SIN_IMPUESTOS` (id `72`) en `0` →
  `costo` incluye impuestos.
- **Presentación en compras (CRÍTICO)**: la búsqueda `busquedaSensitivaSegunTipos`
  (`InsumoLogistica::parseBusquedaSensitiva`) devuelve `item_presentacionid` / `item_presentacion`
  (la presentación **por defecto**), **NO** `presentacionList`. Si `resolverItem` de `bot.ts` lee
  `presentacionList` y no cae a `item_presentacionid`, `presentacioninsumo_id` termina `NULL` en
  `detallecompra`. Consecuencias encadenadas: (1) el backend **no incrementa stock** (Compra
  Fantasma) y (2) `obtenerDetallesCompra` **no expone `item_id`/`item_descripcion`** (los items del
  dump salen `{}` → Buscador Ciego). Para una presentación concreta por nombre ("Caja de 24") hay
  que consultar `Insumo.obtenerInsumoDetallado(insumo_id,0,0)` → `data.listaPresentaciones`
  (`presentacioninsumo_id`, `presentacioninsumo_nombre`, `presentacioninsumo_cantidad`).

---

## 4. Estructura del proyecto (src/)

| Archivo | Responsabilidad |
|---|---|
| `test-e2e.ts` | **Orquestador E2E** (flujo real). Ejecuta la secuencia Fase 1 (insumos) → Fase 2 (compras) → Fase 3 (guías), con `try/catch` por paso, acumula filas en `reporte[]` y al final escribe `data/Reporte_Bot.xlsx` (función inline `generarReporte`). Guarda en memoria `estado.insumoA` / `estado.insumoB` / `compra1` / `compra2` / `guia`. |
| `bot.ts` | Conexión (`conectarNavegador`, `obtenerPaginaApp`), navegación (`navegar`, `esperarEndpoint`, `leerRespuesta`, `leerJson`), operaciones de insumo E2E (`crearInsumo`, `consultarInsumo`, `agregarPresentacion`), `cerrarModales`, y el flujo legacy por Excel (`ejecutarInsumos`, `ejecutarCompras`, `registrarInsumo`, `registrarCompra`). |
| `kardex.ts` | Lectura/validación de stock: `buscarInsumo`, `leerStockYCosto` (vía `Insumo.obtenerStockYCosto`), `validarStock`, `obtenerEstadoGlobal`. |
| `compras.ts` | `registrarCompra` (nº único), `consultarCompra`, `modificarCompra` (matchea por `insumoId`), `anularCompra`, `registrarNotaCredito`. |
| `guias.ts` | `registrarGuia` (nº único), `consultarGuia`, `modificarGuia` (matchea por `insumoId` + click CSS), `anularGuia`. |
| `db.ts` | `limpiarBaseDatos()` con `mysql2/promise` y `FOREIGN_KEY_CHECKS`. |
| `parser.ts` | Lectura del Excel de datos (`leerExcel`) para el flujo legacy (`index.ts`). |
| `types.ts` | Tipos compartidos: `InsumoAgrupado`, `CompraAgrupada`, `ResultadoOperacion`, `FilaReporte`. |
| `index.ts` | Orquestador **legacy** (leía todo de un Excel genérico). Ya **no es el flujo principal** (reemplazado por `test-e2e.ts`). |

> Nota: **no existe `reporte.ts`**; la generación del Excel de reporte está inline en `test-e2e.ts`
> (y también en `index.ts`). Si se desea, se puede extraer a un módulo `reporte.ts`.

### Flujo de datos (Fase 1 → Fase 3)
1. `test-e2e.ts` → `limpiarBaseDatos()` (db.ts) → `conectarNavegador()` (bot.ts) → `navegar('logistica.escritorio')`.
2. `crearInsumo('test A'/'test B')` (bot.ts) → guarda `estado.insumoA/insumoB`.
3. `validarStock(nombre, stock, costo)` (kardex.ts) → `Insumo.obtenerStockYCosto`.
4. `registrarCompra/modificarCompra/anularCompra/registrarNotaCredito` (compras.ts) usando `insumoId`.
5. `registrarGuia/modificarGuia/anularGuia` (guias.ts) usando `insumoId`.
6. `generarReporte(reporte)` → `data/Reporte_Bot.xlsx`.

---

## 5. Comandos de ejecución

### 5.1. Levantar Chrome con CDP (puerto 9222)
```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\chrome-temp"
```
Debe ser un Chrome **dedicado** (sin sesiones abiertas) porque `connectOverCDP` se conecta al
puerto `9222` y el bot reutiliza la pestaña ya abierta y logueada en la app (`localhost:9002`).

### 5.2. Ejecutar la prueba
```powershell
npm run test:e2e
```
Flujo: limpia BD → conecta a Chrome → navega a `escritorio` → Fase 1/2/3 → escribe
`data/Reporte_Bot.xlsx` → `process.exit(fallidos ? 1 : 0)`.

### 5.3. Variables de entorno útiles
- `CDP_ENDPOINT` (default `http://127.0.0.1:9222`) — endpoint CDP.
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` (defaults `localhost` / `3306` / `root` / `` / `logistica`).

---

## 6. Aprendizajes duros (resumen de errores resueltos — no repetirlos)

1. **`localhost` vs `127.0.0.1`**: `connectOverCDP('http://localhost:9222')` falla por IPv6 (`::1`).
   Usar `http://127.0.0.1:9222`.
2. **`tipo` de respuesta es string**: comparar `Number(tipo) === 1`.
3. **`proveedor_id`**: capturar del resultado de búsqueda, no de `vm.compra.proveedorSeleccionado`.
4. **Fecha de compra**: `YYYY-MM-DD HH:mm:ss`.
5. **`compra_fecha` se anula tras `procesarDatosCompra`**: capturar `proveedor_id`/`moneda_id`/
   `local_id`/`almacen_id` **antes** de `procesarDatosCompra`.
6. **Esperar el `$digest`**: tras cada respuesta HTTP, esperar a que `vm.X` esté poblado.
7. **Modales residuales**: `cerrarModales()` antes/después de cada acción.
8. **No leer stock/costo del `$scope` de HandsOnTable**: usar `Insumo.obtenerStockYCosto` y `data[].costo`.
9. **Colisión de serie/número entre corridas**: sufijo `Date.now()`.
10. **Localización de items por `insumo_id`** (estricto), no por texto.
11. **Guías: guardar por click CSS** (Continuar → Editar guía → `.swal2-confirm`), no por `vm.fnActualizarGuia()`.
12. **No existe worker asíncrono de stock** (config 38 = 0): el Kardex es síncrono.
