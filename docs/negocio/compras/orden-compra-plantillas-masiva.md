# Orden de Compra — Plantillas y Carga Masiva

> Plantilla = `avancecompra` con `avancecompra_esplantilla='SI'` + `tipo=AVANCECOMPRA_TIPO_ORDENCOMPRA`. Rutas UI `orden.compra.route.js:25-110` (plantillas, registroporplantilla, gestionmasiva). Borrado lógico `avancecompra_estado ACTIVO/INACTIVO`.

## 1. Plantillas 1x1

* Guardar: mismo `POST registrarOrdencompra` con `ordencompra_esplantilla/actualizarplantilla/nombreplantilla/avancecompra_id` (`nueva.orden.compra.controller.js:760-766`); si `actualizarplantilla==SI` **no crea OC**, guarda/actualiza avance (`Controller:541-542,833-882 guardarAvanceOrdencompra`, literal `"Guardado"`); si `esUnaPlantilla()` crea OC **y** plantilla (`:572-574`). Mapeo a avance `AvancecompraLogistica.php:76-115` (fecha, total, proveedor, moneda, local, observación, productos→`detalleavancecompra`).
* Usar: `GET obtenerDataPlantillaOrdencompra/{id}` (error `"La plantilla fue eliminada."`, éxito `"Retornando plantilla"`, `:884-904`) hereda local/proveedor/moneda/tipocambio/detalle (`:503-520`, armado `CompraLogistica.php:2674-2744`); el usuario edita y guarda como OC normal.
* Eliminar: `GET eliminarPlantillaOrdencompra/{id}` (`"Plantilla eliminada con éxito."` / `"...no existe o ya fue eliminada."` / `"...aún no está disponible."`, `:906-935`).

## 2. Carga masiva (`gestionmasiva/editor`)

* `POST cargaMasiva/validar {filas}` (sin grabar) y `POST cargaMasiva/registrar {filas, origen, avancecompra_id?}` (`Controller:2043-2108`): agrupa filas en una OC por `local|proveedor|fechavencimiento|fechaentrega` (`:1302-1320`), valida todo (`:1443-1456`), registra cada OC en transacción propia (`:1465-1490`) + histórico (`:1532-1561`). Con errores no graba nada. Literales: `"No hay filas para procesar."`, `"Una carga admite como máximo ..."`, `"No se registró ninguna orden... N fila(s) con errores."`, `"Carga #X: se crearon N orden(es)..."`.
* Fila: `{local, almacen, proveedor(RUC), fechavencimiento, fechaentrega, tipo, codigo(SKU), presentacion, cantidad, precio}` (Excel `Local, Almacén, Proveedor, Vencimiento dd/mm/aaaa, Entrega, Ítem, Presentación, Cantidad, Precio`; variantes con RUC/tipo/código). Seguimiento `POST cargaMasiva/lista` (semáforo VERDE/ÁMBAR/ROJO), `GET filas/{historicocambio_id}`, `POST reintentar/{id}` (`"Esta orden ya se creó (OC #...)."`).
* Validaciones por fila (todas `Fila #N: ...`): local (acceso/existencia/duplicado/moneda), almacén (pertenencia), proveedor (RUC activo/único), fechas (formato dd/mm/aaaa, no pasadas), tipo (`PRODUCTO, INSUMO, RECETA, PORCIONABLE, DERIVADO, DESCARTABLE, CONSUMIBLE, ACTIVO` — aquí SÍ aparecen recetas/porcionables como tipos válidos de fila), código (existencia/univocidad/tipo coincidente/elegido de lista), presentación (pertenencia/activas; vacío→default/`UNIDAD`), derivados (habilitados en local) y control en almacén (`"X no se controla en el almacén Y"`), cantidad>0, precio≥0, duplicados (misma combinación → sumar en una fila).

## 3. Relación con los otros sub-flujos

* **Plantilla → registro**: reutiliza el mismo `registrarOrdencompra` (misma matemática `precio=costo×cantidad`, mismos validators); la plantilla solo precarga el payload.
* **Masiva → N OCs**: cada grupo resultante entra al ciclo normal (nace PENDIENTE, luego aprobar→importar→anular aplican igual). El `origen=PLANTILLA` + `avancecompra_id` trazan procedencia (`_cargarDesdePlantilla`, filas "sin local ni almacén": `proveedor, tipo, codigo, cantidad, precio`).
* **Tipos aceptados**: la masiva admite `RECETA/PORCIONABLE/DERIVADO` como tipo de fila (a diferencia del buscador 1x1 que filtra recetas) — el bot debe probar al menos una fila porcionable y una receta para fijar si persisten o se rechazan.

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| P1 | Guardar como plantilla (`esplantilla=SI`) | OC creada + `avancecompra_id` retornado (`"Guardado"`) |
| P2 | Solo actualizar plantilla (`actualizarplantilla=SI`) | NO crea OC, retorna `avancecompra_id` |
| P3 | Cargar plantilla → registrar | OC con detalle heredado, literal `"Tu orden de compra se agrego con éxito."` |
| P4 | Eliminar plantilla + recargar | `"Plantilla eliminada con éxito."` → luego `"La plantilla fue eliminada."` |
| M1 | `validar` con matriz de filas malas (RUC inexistente, fecha pasada, tipo inválido, cantidad 0, duplicado) | literales §2 por fila con `Fila #N:`; `registrar` con errores no graba nada |
| M2 | `registrar` válido multi-grupo | una OC por combinación, mensaje `"Carga #X..."`, seguimiento en `lista` + `reintentar` |
