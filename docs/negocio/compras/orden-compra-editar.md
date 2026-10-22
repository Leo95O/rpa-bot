# Orden de Compra — Editar / Actualizar

> Endpoint `POST ordencompra/actualizarOrdencompra` (`rest/ordencompra/index.php:23` → handler `:95-100` → `OrdencompraLogisticaController.php:257-270 actualizaOrdencompra`). Pantalla `logistica.ordencompra.editarordencompra`.

## 1. Payload (qué envía el frontend)

`editar.orden.compra.controller.js:481-503`: `{ordencompra:{... +proveedor_id,local_id,moneda_id,tipocambio,fecha,fechavencimiento}, productos:[...detalleParaBackend con localList], productosEliminados:[{detalleordencompra_id}]}` (`removeItemList`, `:499`). Recurso `resource.ordencompra.js:543-545`, modelo `ordencompra.js:123-124`.

## 2. Qué hace el backend (`OrdencompraLogistica.php:297-428`)

`inicializarEditar()` preserva `ordencompra_fecha` de BD; si estaba VENCIDA y el nuevo vencimiento es futuro → PENDIENTE; referencia vacía → null. `actualizar()` = `actualizarDetalles()` + `elimincarDetalles()` + `update()`: por línea `precio = cantidad × costo` (`:397`), re-bifurca `presentacioninsumo_id/producto_id` (`:399-403`), `total = Σ` (`:404,416`); con `detalleordencompra_id>0` → `actualizar(distribucion)` (`:407`), si no → `registrar()` (`:410`). Distribución (`DetalleordencompraLogistica.php:107-145`): `cantidad>0` → upsert, `≤0` con id → delete. Eliminados (`:418-428` + `:147-160`): borra distribuciones del detalle y luego el detalle.

## 3. Relación con los otros sub-flujos

* Editar alimenta a **importar**: lo que cambie aquí (precio/cantidad/distribución) es lo que heredan Guía/Compra (`obtenerListaOrdenesImportar` lee el detalle vigente). Editar después de canjear parcial deja saldos a importar distintos — el descuento de lo ya canjeado (`:927-970`) se calcula contra el detalle **actual**.
* Editar vs **anular**: editar una OC `APROBADA` está bloqueado; hay que rechazarla primero (vuelve a PENDIENTE/RECHAZADO) o anularla. Editar no cambia `compra_id/guia_id`: si ya hay canje, la edición convive con el vínculo (no lo rompe).
* Editar vs **evaluar**: la evaluación (`aceptada`) no bloquea edición por sí sola; el bloqueo es por `estado==APROBADO`.

## 4. Bloqueos (backend real: corre el validator de *servicios*, no el de OC)

`actualizaOrdencompra` valida con `OrdenservicioLogistica::MODIFICAR_ORDENSERVICIO` (bug conocido): el literal efectivo es `"No se puede editar una orden de servicio ya aprobada."` (`OrdenservicioLogisticaValidator.php:245`) + `"La cantidad o precio del: ... , no es valida."` (`:90`), `"Ingrese almenos un detalle..."` (`:99`), referencia duplicada (`:71`). Además `OrdencompraLogisticaValidator.php:385-390`: `"Compra no valida para editar."` (id inválido). Frontend previo: `"Algunos artículos son incorrectos..."`, `"No se han encontrado detalles..."`, `"Selecione una fecha de vencimiento valida..."`, `"No ha seleccionado un proveedor."`, confirm `"¿Seguro que quieres modificar la orden de compra?"`, éxito `"Se modificó la orden de compra"`. En lista: `"No es posible editar una orden de compra que ya ha sido aprobada."` (`lista...:181-183`).

## 5. Validaciones verificables por el bot

| # | POST | Aserción |
|---|---|---|
| E1 | `actualizarOrdencompra` sobre OC APROBADA | `tipo=ERROR`, mensaje contiene `ya aprobada` (hoy dice *servicio*; si lo corrigen dirá *compra*) |
| E2 | id `0/-1` | `"Compra no valida para editar."` |
| E3 | `ordencompra_numeroreferencia` existente | `"El número de referencia ya ha sido registrado con anterioridad."` |
| E4 | Edición válida (cambiar cantidad/precio + agregar/quitar línea + `productosEliminados`) | `GET obtenerOrdencompra`: `precio==cantidad×costo` por línea, `total==Σ`, línea eliminada ausente con 0 distribuciones huérfanas |
| E5 | `distribucion=1` + `localList` con `cantidad=0` | fila de distribución borrada tras `GET` |
