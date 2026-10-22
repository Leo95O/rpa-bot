# Solicitud de Compra — Canje a Orden de Compra y "¿Activar distribución por local?"

> Flujo: Solicitud de compra (requerimientocompra) → Orden de compra (ordencompra).
> Modal citado: *"Estás por canjear las solicitudes seleccionadas por 1 orden de compra en el local "Healthy Food Piura" — Proveedor: MAKRO — ¿Activar distribución por local?"* (checkbox SweetAlert2).
> Evidencia: frontend `logisticaview/`, backend `C:\xampp\htdocs\webapp\logistica/`.

---

## 1. Qué significa la pregunta (respuesta corta)

Es un **switch de consolidación vs. trazabilidad por origen**, no un campo decorativo. El checkbox (`inputPlaceholder:'¿Activar distribución por local?'`) viaja como `distribucionByLocal` (0/1) en el payload del segundo POST y cambia qué filas se crean en BD:

| Checkbox | `ordencompra.ordencompra_distribucion` | Detalle OC | Tabla `distribucionordencompra` | Efecto negocio |
|---|---|---|---|---|
| **Desmarcado (0)** | `0` (solo local emisor) | Cantidades **consolidadas** por ítem (suma de todas las solicitudes, `consolidarDetalleRequerimiento`) | **No se inserta nada** | Compra centralizada: todo ingresa al almacén de abastecimiento del local que emite la OC. Simple, pero se pierde qué local pidió cada cantidad. |
| **Marcado (1)** | `1` (`ACTIVO`) | Mismo detalle consolidado (la OC sigue siendo 1 por proveedor) | **Una fila por (detalle OC × local solicitante)**: `detalleordencompra_id + local_id + cantidad + direccion + estado=ACTIVO` | Compra distribuida: la OC recuerda cuántas unidades pidió cada local y su dirección de entrega. Habilita despacho parcial/total por local y guías por distribución. |

Texto literal de la app que lo confirma (`ordencompra/modals/opciones.orden.compra.view.html:63-64`):
* `distribucion == '1'` → *"Permite ingresar lo comprado a diferentes locales."*
* `distribucion == '0'` → *"Lo comprado ingresará solo al local que emite la orden."*

---

## 2. Flujo completo en 2 POST (dónde aparece el modal)

El modal está entre dos llamadas (idéntico en 3 pantallas: `compra/dashboard/dashboard.controller.js:1560-1615`, `requerimientocompra/listarequerimientocompra/lista.requerimiento.compra.controller.js:1087-1156`, `requerimientocompra/verrequerimientocompra/ver.requerimiento.compra.controller.js:199-250`):

```
1. POST compra/requerimientocompra/canjearRequerimientoPorOrdencompra  (idList)
   → resource.requerimientocompra.js:141-143 → Controller :524-536 → Model ::canjearRequerimientoPorOrdencompra()
   ← { array_proveedor[{proveedor, items}], array_sin_proveedor[], local{local_descripcion}, requerimientoCompraList[] }
   Frontend arma título "Estás por canjear ... por N orden(es) ... en el local X / Proveedor: Y"

2. MODAL rpAlert (checkbox) → preConfirm(confirmacion):
     response.data.distribucionByLocal = confirmacion   // 0 o 1
   POST compra/requerimientocompra/generarOrdenCompraByRequerimiento (mismo objeto + flag)
   → resource.requerimientocompra.js:161-163 → Controller :538-571 (exige permiso REGISTRAR_ORDEN_COMPRA_LOGISTICA)
   → Model RequerimientocompraLogistica::generarOrdencompraByRequerimientos() (:783-...)
   ← ids de OC creadas → toast "Se registraron las ordenes de compra" + $state.go("logistica.ordencompra")
```

Una OC por proveedor (+1 con proveedor default para ítems sin proveedor, `ProveedorLogistica::buscarProveedorDefault()`, `:864-998`). El `local "Healthy Food Piura"` del título es `response.data.local` = local emisor (`Security::getCurrentLocalId()`, `:792`).

---

## 3. Qué hace el backend con el flag (detalle de ingeniería)

Archivo: `logistica/models/RequerimientocompraLogistica.php:783-1120` (`generarOrdencompraByRequerimientos`).

1. **Lee el flag** (`:787-790`): `distribucionByLocal == SI(1)` → `$ordenCompraPorDistribucionLocal = true`.
2. **Re-hidrata origen por solicitud** (solo si flag ON, `:825-829`): por cada `requerimientocompra_id` recarga `local_id + local(local_direccion) + detalle[]`. Si OFF, ese origen se descarta (consolidación pura).
3. **Crea la cabecera OC** con `local_id` del emisor, moneda/tipo de cambio, `ordencompra_estado=ACEPTADA`, vencimiento +1 semana, `loterequerimiento_id`; y **solo si flag ON** → `setOrdencompra_distribucion(ACTIVO)` (`:887-889` rama sin-proveedor, `:1021-1023` rama con-proveedor).
4. **Consolida detalle** (`consolidarDetalleRequerimiento`, `:760-781`): agrupa por `(producto_id, presentacioninsumo_id, presentacioncompraproducto_id)` sumando cantidades y promediando precio ponderado; guarda `array_relacion[]` (qué solicitudes componen cada línea). Precio re-escrito a último precio de compra (`obtenerUltimoPrecioCompraPorInsumoProducto`, `:915-939,1047-1067`).
5. **Inserta distribución solo si flag ON** (`:959-981` y `:1087-1109`): por cada `array_relacion` → por cada solicitud → por cada detalle coincidente (match por las 3 claves de presentación) → `INSERT distribucionordencompra(detalleordencompra_id, local_id, cantidad=solicitud, direccion=local_direccion, estado=ACTIVO)`.
6. **Vínculos de canje** (siempre): `ordencompra_total` + `update()`, pivote `ordenrequerimientocompra(ordencompra_id, requerimientocompra_id)` por cada solicitud (`:986-993,1114-...`).

### Tablas tocadas

* `ordencompra` (+`ordencompra_distribucion`, `proveedor_id`, `local_id` emisor).
* `detalleordencompra` (consolidado, con `almacen_id` = abastecimiento del emisor salvo override `:798-809`).
* `distribucionordencompra` (**solo si checkbox=1**): `distribucionordencompra_id, detalleordencompra_id, local_id, cantidad, direccion, estado, guia_id` (este último se llena al canjear guía después).
* Pivote `ordenrequerimientocompra` + `requerimientocompra.ordencompra_id/estado=CANJEADO`.

---

## 4. Consecuencias aguas abajo (por qué importa para el bot)

* **Ver OC distribuida:** `verordencompra/ordencompra.html:158`, `modalResumenOrdencompra.html:85,112` muestran bloque de locales solo si `ordencompra_distribucion == SI`. Pantalla dedicada `logistica.ordencompra.listadistribucionordencompra` (`orden.compra.module.js:14`, `lista.distribucion.orden.compra.controller.js:1013-1017` con estados `PARCIAL/TOTAL`).
* **Canjear guía por distribución:** la guía filtra por `distribucionList` del local (`nuevaguia.controller.js:746-748`: solo líneas con `cantidad>0 && (!guia_id || estado==2)`); endpoint `POST obtenerOrdenesCompraAImportarByDistribucion/{local_id}`; al guardar con `guia_distribucion==SI`, `GuiaLogistica.php:464-497` marca `distribucion.guia_id + estado TOTAL/PARCIAL`.
* **Canjear guía normal desde OC distribuida:** `OrdencompraLogistica.php:648,683-690` recorta el detalle al `distribucionordencompra_cantidad` del local y reprorratea precio (`precioOriginal/cantidad × cantidadLocal`).
* **Anular OC canjeada:** bloqueado (`OrdencompraLogisticaValidator.php:93-127`: *"No se puede anular una orden canjeada por una compra/guía..."*) — el bot debe anular guía/compra primero.

---

## 6. Tu duda: "si la solicitud solo admite UN área/local, ¿cómo diferencia el checkbox?"

Tienes razón en el formulario: cada **solicitud individual** registra un solo `local_id` / área solicitante, una `requerimientocompra_fechaentrega` (validada `Y-m-d`, no pasada — el backend la corrige a mañana si es inválida, `RequerimientocompraLogisticaController.php:287-288`), una `requerimientocompra_fechavencimiento` opcional (si no se envía, default `now()`, `RequerimientocompraLogistica.php:182-183`; si está vencida la solicitud se excluye del canje, `:687-694`), y sus ítems van **por presentación específica** (`presentacioninsumo_id`, no insumo genérico — el canje agrupa por esa clave, `:765`).

El checkbox **no opera sobre una solicitud, opera sobre el LOTE seleccionado para canjear**. El modal aparece después de marcar N solicitudes en la lista/dashboard y pulsar Canjear (`listaOrdenCompraAImportar` / `listaSolicitudesCompraAImportar` → `POST canjearRequerimientoPorOrdencompra(idList)` → `canjearRequerimientoPorOrdencompra()` en `RequerimientocompraLogistica.php:670-758`, que fusiona los detalles de todas en `consolidarDetalleRequerimiento`, `:708`).

Por eso:

* **Canjeas 1 sola solicitud → el checkbox es irrelevante en la práctica.** Con OFF: OC de X kg al emisor. Con ON: la misma OC de X kg + **una sola fila** de distribución `(detalle, tu local, X kg)` (`:959-981`). Mismo resultado operativo, una fila extra de trazabilidad.
* **Canjeas N solicitudes de distintos locales/áreas (el caso real del checkbox) → ahí sí decide.** Ejemplo: Sol-101 Piura 10kg + Sol-102 Chiclayo 20kg, mismo proveedor MAKRO → 1 OC de 30kg. Con OFF: 30kg a Piura (se pierde quién pidió qué; Chiclayo necesita traslado posterior). Con ON: 30kg + 2 filas `(Piura,10kg,dirección Piura)` + `(Chiclayo,20kg,dirección Chiclayo)` (`:825-829` rehidrata `local_id/local/detalle` por solicitud solo en este modo), y cada local canjea después su parte por guía.
* El `local "Healthy Food Piura"` del título **no es el área solicitante**: es `Local::getById(Security::getCurrentLocalId())` (`:755`), o sea el local emisor/logueado que centraliza la compra. Las áreas solicitantes viven dentro de cada `tempReq->local_id` del lote.

## 5. Reglas para automatizar (SDET)

1. **Default del bot = checkbox OFF (0)** salvo que el caso pida distribución: equivale a no enviar `distribucionByLocal` o enviar `0`. Para caso distribuido enviar `1` **y** rehidratar `local_id/local/detalle` por solicitud (el backend lo hace solo si flag=1, `:825-829`).
2. **Aserciones:** tras canjear con flag=1 verificar `ordencompra_distribucion=1` + `COUNT(distribucionordencompra)==N locales` + suma de `cantidad` por detalle == `detalleordencompra_cantidad`; con flag=0 verificar `distribucion=0/NULL` y cero filas en `distribucionordencompra` para esa OC.
3. **IDs:** `estado` debe guardar `ordencompra_id` + mapa `local_id→cantidad` (sale de `detalle[].distribucionList`, `OrdencompraLogistica.php:1028-1033,1316-1366`) para los casos de guía por distribución.
4. **Limpieza:** `limpieza_bd.sql:73` ya cubre `DELETE FROM distribucionordencompra` (Fase 1, hijos primero) — no agregar nada.
5. **Negativas:** sin permiso `REGISTRAR_ORDEN_COMPRA_LOGISTICA` → `"No tienes permisos..."` (`Controller:547-554`); solicitudes ya canjeadas/no aprobadas/vencidas se filtran en `:840-847` (hoy con `//return false` comentado — validar comportamiento real antes de asertar bloqueo).
