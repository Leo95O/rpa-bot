# Solicitud de Compra — Agrupar (consolidar N solicitudes en 1)

> No confundir con canjear (agrupar crea 1 solicitud desde N; canjear crea OCs desde N). Endpoint `GET /requerimientocompra/agrupar/{idList CSV}` (`rest/compra/index.php:112` → handler `:442-446` → `RequerimientocompraLogisticaController.php:262-337 agrupar()`).

## 1. Precondiciones frontend (`lista...controller.js:939-984` `validarAgruparRequerimientocompra`)

Sin chequeo de vencimiento (a diferencia del canje): 1) ninguna con `ordencompra_id>0` (literal "ya fue cajeada", `:947`); 2) todas en `PENDIENTE||APROBADO` o `"... no tienen estado pendiente o aprobado."` (`:955`); 3) mínimo 2 (`"Debe seleccionar al menos dos requerimientos para agrupar"`, `:978`); 4) mismo `almacen_id` (`"Todos los requerimientos deben tener el mismo almacen"`, `:965`) y mismo estado (`"Todos los requerimientos deben tener el mismo estado"`, `:969`). Llamada: `Requerimientocompra.agrupar(ids.join(","))` (`:1161-1173`) → `GET .../agrupar/{csv}` (`resource.requerimientocompra.js:221-224`).

## 2. Qué hace el backend (`Controller:262-337`)

1. Consolidado SQL `RequerimientocompraLogisticaDB::obtenerDetallerequerimientocompraConsolidado(idList, TIPO_INSUMO)` + `TIPO_PRODUCTO` (`:271,279`; SQL `:199`: `SUM(cantidad) GROUP BY presentacioninsumo_id/producto_id`), copiando `local_id/almacen_id/fechaentrega` del primer detalle (fecha inválida → mañana, `:287-289`).
2. `registrar()` interno (`:296`) crea la **solicitud agrupadora** (nuevo `requerimientocompra_id`).
3. Marca cada origen: `requerimientocompra_requerimientocompraid = nuevoId` (autorreferencia, **sin tabla pivote**) + `estado = AGRUPADO(4)` + evento (`:300-309`).
4. La agrupadora hereda el estado del origen (`:310-314`, normalmente PENDIENTE/APROBADA por la homogeneidad exigida).
5. Sin detalles: `"Los requerimientos seleccionados no tienen detalles"` (`:322`); id inválido: `"id no valido"` (`:329`).

## 3. Reversión

Anular la agrupadora libera hijos: `RequerimientocompraLogisticaDB.php:222-228 desagruparRequerimientos(padre)`: `UPDATE ... SET requerimientocompraid=null, estado=PENDIENTE WHERE requerimientocompraid='{padre}'` (llamado desde `RequerimientocompraLogistica.php:419`).

## 4. Replicación bot

1. Crear 2 solicitudes mismo almacén/estado con mismo ítem (cantidades distintas). 2. `GET agrupar/1,2` → nueva id; orígenes `estado=4` + `requerimientocompraid=nueva`; agrupadora con cantidad sumada. 3. Negativas: 1 sola → "al menos dos"; almacenes distintos → "mismo almacen"; una canjeada → "ya fue cajeada". 4. Anular agrupadora → hijos de vuelta a `PENDIENTE` con FK nula.
