# Solicitud de Compra — Anular

> Endpoint `GET /requerimientocompra/anular/{id}` (`rest/compra/index.php:108` → handler `:409-413` → `RequerimientocompraLogisticaController.php:197-260 actualizarEstado(id, ANULADO)`).

## 1. Flujo

Frontend: `Requerimientocompra.anular(id)` (`resource.requerimientocompra.js:244-247`, model `:119`) llamado desde ver-detalle caso 5 (`ver...controller.js:174`) y menú contextual de lista (`lista...:1278`). Sin filtro previo (a diferencia de aprobar/canjear).

Backend (`Controller:197-260` → `Model RequerimientocompraLogistica.php:414-424`):
1. ACL **solo si ANULADO**: exige `ANULAR_SOLICITUD_COMPRA_LOGISTICA` (`:207`), si no `"No tienes permisos para realizar esta acción, por favor comunicate con el administrador del sistema."`
2. `ordenservicio_id = null` (`:233-235`), `requerimientocompra_estado = ANULADO(0)` + `update()`.
3. **Desagrupa**: `RequerimientocompraLogisticaDB::desagruparRequerimientos(id)` (`:419`; SQL `:222-228`): hijos con `requerimientocompraid=id` vuelven a `PENDIENTE` con FK nula.
4. `EventoLogistica::registrarEvento(ACCION_CAMBIOESTADO, motivo)`.

## 2. Validator y literales

`smart/validators/RequerimientocompraLogisticaValidator.php:75-79 _validarAnulacion()` retorna **vacío**: anular **nunca es bloqueado** por el backend (el freno vive del lado OC: `OrdencompraLogisticaValidator:88-127`). Literales: éxito `"Se modifico con éxito."` (`:237`); `"Se produjo un error modificar."`, `"No se encontro el requerimiento"`, `"id no valido"` (`:241-252`).

## 3. Qué NO toca

No limpia `ordencompra_id` ni pivote `ordenrequerimientocompra`; una solicitud ya canjeada se puede anular a nivel solicitud sin romper la OC (freno del otro lado). **No devuelve stock** (la solicitud no mueve Kardex).

## 4. Replicación bot

1. Crear+anular pendiente → `estado=0`, literal éxito. 2. Anular agrupadora → hijos a `PENDIENTE`. 3. Sin permiso `ANULAR_...` → literal ACL. 4. Anular canjeada → éxito igual (documentar, no asertar bloqueo).
