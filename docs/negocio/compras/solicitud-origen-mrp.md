# Solicitud de Compra — Origen MRP (generada desde faltantes de producción/movimiento)

> Dos endpoints que crean solicitudes sin formulario: `POST /requerimientocompra/generarSolicitudStockPorInsumosFaltantes` y `GET /requerimientocompra/generarSolicitudCompraPorRequerimiento/{reqMovId}` (`rest/compra/index.php:116-117` → handlers `:462-473` → `RequerimientocompraLogisticaController.php:573-872`).

## 1. Atajo D1: `generarSolicitudCompraPorRequerimiento(reqMovId)` (`Controller:573-622`)

Recibe **solo el id por URL**. Lee `obtenerRequerimientoMovimientoParaEdicion(id)` (`:581`), arma payload `{local_id=reqMov.localproduccionid, requerimientomovimiento_id, insumos[]={insumo_id/producto_id, item_cantidad=item_cantidadFaltante=cantidad, unidadmedidainsumo_id}, almacen_id=abastecimiento del local}` (`:585-610`) y delega a D2 (`:611`). Origen UI: menú "Generar solicitud de compra" en lista de requerimientos de stock (`lista.requerimientos.controller.js:157-179`).

## 2. Motor D2: `generarSolicitudStockPorInsumosFaltantes(obj)` (`Controller:624-872`)

Payload JSON:
```json
{ "local_id": 0, "almacen_id": 0, "requerimientomovimiento_id?": 0, "ordenproduccion_id?": 0, "solitudmovimiento_id?": 0,
  "insumos": [{ "insumo_id?": 0, "producto_id?": 0, "item_cantidadFaltante": 0, "item_cantidad?": 0, "cantidad?": 0, "unidadmedidainsumo_id?": 0, "item_tipo?": 1, "item_id?": 0 }] }
```
Constructores: `calculadorastock.controller.js:659-663,848-861` (según `calculadora_tipo` adjunta `ordenproduccion_id/solitudmovimiento_id/requerimientomovimiento_id`), `calculoproduccion.controller.js:982-984` (suelta, sin FKs).

Crea (`:695-786`): cabecera `estado=PENDIENTE(1)`, `observacion="Generada por cálculo de producción "`, `total=0`, `local_id` del almacén, usuario actual + FKs opcionales; detalle por insumo con `item_cantidadFaltante>0` (presentación estándar, `cantidad=ceil(equivalente)`, merma auto `:734`). Si trae `requerimientomovimiento_id`, genera **reserva de stock** (`:803-842`, `RESERVA_STOCK_TIPO_OPERACION_REQUERIMIENTOMOVIMIENTO`).

## 3. Bloqueos (literales)

ACL `REGISTRAR_SOLICITUD_COMPRA` o `"No tienes permisos..."` (`:634-641`); origen pendiente → `"No puedes generar una solicitud de compra de un requermiento pendiente."` (sic, `:650`, análogos OP/movimiento `:658,665`); duplicado no-anulado por FK → `"Error ya existe una solicitud de compra vinculada a ese requerimiento de stock."` / orden producción / orden movimiento (`:855,859,863`); éxito `"Se genero la solicitud de compra con exito."` (`:846`, sin tilde), fallo `"Error al generar la solicitud de compra favor volver a intentar."` (`:850`). Retorna `{tipo,mensajes,data=requerimientocompra_id}`.

## 4. Trazabilidad con lotes

La solicitud no recibe `loterequerimiento_id` directo; lo arrastra vía `requerimientomovimiento_id/ordenproduccion_id/solitudmovimiento_id` (`RequerimientocompraLogistica.php:1337`, `CommonLogisticaController:2338`, `OrdenproduccionLogisticaController:467-468`); inversa `obtenerRequerimientoCompraDeLoteRequerimiento` (`:1139`), `DiagramaRelaciones:550-613`; al canjear, la OC hereda `loterequerimiento_id` (`:886,1020`).

## 5. Replicación bot

1. Desde OP con faltantes: `POST generarSolicitudStockPorInsumosFaltantes{local,almacen,ordenproduccion_id,insumos:[{insumo_id,cantidadFaltante}]}` → id, `estado=1`, observacion prefijo cálculo. 2. Repetir → literal duplicado. 3. Con reqMov pendiente → literal pendiente. 4. Con reqMov → verificar reserva creada. 5. D1: `GET generarSolicitudCompraPorRequerimiento/{reqMovId}` → mismo resultado vía atajo.
