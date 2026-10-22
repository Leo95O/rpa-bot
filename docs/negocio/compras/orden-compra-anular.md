# Orden de Compra — Anular (secuencia E2E con hijos)

> Endpoint `GET /anularOrdencompra/{id}` (`rest/ordencompra/index.php:22` → `OrdencompraLogisticaController.php:207-232 anularOrdencompra`). Modelo `OrdencompraLogistica.php:429-448 anular()`.

## 1. Validaciones (`OrdencompraLogisticaValidator.php:69-128`)

* Ya anulada → `"No se puede anular la orde de compra por que ya fue anualada."` (sic, `:96`); procesada → `"...ya ha sido procesada."` (`:100`).
* Con `compra_id` seteado → `"No se puede anular una orden canjeada por una compra."` (`:119`); con `guia_id` → `"...por una guia."` (`:126`). **Solo miran las columnas `ordencompra.compra_id/guía_id`, no distribuciones parciales ni pivotes.**
* Permiso `ANULAR_ORDEN_COMPRA_LOGISTICA` (`:219`) o `"No tienes permisos..."`.

## 2. Efecto (`anular()`)

`ordencompra_estado = ANULADA(3) + update()`, actualiza requerimiento/distribución (`:433-434`), evento (`:435`), desvincula consolidada (`:448`). **No hay `fueeliminado` en cabeceras** (solo en `movimientoalmacen*_fueeliminado=SI`).

## 3. Secuencia correcta para OC canjeada (relación con Guía/Compra)

1. Anular el hijo con `devolverStock=SI`: Compra `GET /anularCompra/{id}/{1}` (`CompraLogistica.php:2552-2606`: `estado=INACTIVO`, `desvincularOrdencompraVinculado()` → `UPDATE ordencompra SET compra_id=null, estado=APROBADO`, y si `SI` + sin guía → `_descontarStockPorDevolucion()` marca `fueeliminado=SI`); Guía `GET /anularGuia/{id}/{1}` (`GuiaLogistica.php:438-448`, `Controller:679-726`: bloquea si hay merma vinculada `"...vinculada a una salida de stock..."`, si pasó `DIAS_MAXIMO_ANULACION`, si hay operaciones Kardex posteriores o cuadre pendiente).
2. Releer OC (`GET /obtenerOrdencompra/{id}`): `compra_id/guía_id==null`, `estado` de vuelta en APROBADO/PENDIENTE.
3. `GET /anularOrdencompra/{id}` → `estado==3`.
* Bloqueos hijas útiles al bot: compra al crédito con cuotas pagadas (`"...cuotas pagadas"`), lote consumido (`"...lote ya consumido..."`), guía con merma/cuadre/antigüedad.

## 4. Relación con los otros sub-flujos

* **Anular es el inverso de importar**: deshace `PROCESADA/ENPROCESO + vínculos`, pero solo si los hijos se anulan primero (la desvinculación vive en el anular del hijo, no en el de la OC).
* **Anular vs editar/aprobar**: `ANULADA` es terminal (editar y aprobar la rechazan); el camino de corrección es anular hijo→anular OC→nueva OC, o rechazar→editar→re-aprobar si aún no hay canje.
* **Anular solicitud agrupadora** libera hijos a PENDIENTE (`solicitud-anular.md`); anular OC no toca solicitudes (el vínculo `ordenrequerimientocompra` persiste como historia).

## 5. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| N1 | Anular OC APROBADA sin canje | `estado==3`, literal éxito |
| N2 | Anular OC con `compra_id/guía_id` | literales `canjeada por una compra/guia` |
| N3 | Anular OC PROCESADA/ANULADA | literales `procesada` / `anualada` |
| N4 | Secuencia hijo→OC | tras `anularCompra/guía(SI)`: `compra_id/guía_id==null` en OC, movimientos `fueeliminado=SI`, luego OC anula |
| N5 | Guía con merma / compra con cuotas / fuera de días | literales hijas correspondientes antes de tocar la OC |
