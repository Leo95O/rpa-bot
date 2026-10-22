# Solicitud de Compra — Ciclo de Vida, Estados, Aprobación y Permisos

> Entidad: `requerimientocompra` + `detallerequerimientocompra`. Evidencia: `C:\xampp\htdocs\webapp` + `logisticaview/app/scripts`.

## 1. Estados (no existe VENCIDO como estado)

| Estado | Valor BD (string) | Valor frontend (número) | Descripción UI |
|---|---|---|---|
| `POR_GENERAR` | `'-1'` | — | "Por generar" (proceso producción aún no genera) |
| `ANULADO` | `'0'` | `0` | "Anulada" |
| `PENDIENTE` | `'1'` | `1` | "Por Aprobar" |
| `APROBADO` | `'2'` | `2` | "Aprobada" |
| `CANJEADO` | `'3'` | `3` | "Canjeada" |
| `AGRUPADO` | `'4'` | `4` | "Agrupada" |
| `RECHAZADO` | `'5'` | `5` | "Rechazada" |

Backend: `api/definitions.php:2702-2708`; descripciones `logistica/models/RequerimientocompraLogistica.php:48-72,483-511`. Frontend: `logisticaview/app/scripts/definitions.js:428-435`. "Vencido" es solo validación por fecha (`fechavencimiento < hoy`), nunca un estado.

Diagrama: `PENDIENTE → APROBADO → CANJEADO` (vía OC) · `PENDIENTE ⇄ RECHAZADO → APROBADO` · `PENDIENTE/APROBADO → AGRUPADO` (hijos) + nace agrupadora · cualquiera → `ANULADO`.

## 2. Endpoints (`logistica/rest/compra/index.php:104-117`)

| Acción | Método y ruta | Handler | Efecto |
|---|---|---|---|
| Registrar | `POST /requerimientocompra/registrar` | `:386` → `registrar()` | Crea cabecera `estado=PENDIENTE` + detalles |
| Actualizar | `POST /requerimientocompra/actualizar` | `:392` → `actualizar()` | Edita pendiente |
| Aprobar | `GET /requerimientocompra/aprobar/{id}` | `:414` → `aprobarRequerimientocompra(id, APROBADO)` | `PENDIENTE/RECHAZADO → APROBADO` + evento |
| Rechazar | `POST /requerimientocompra/rechazar/{id}` body `{motivo}` | `:419-435` → `actualizarEstado(id, RECHAZADO, motivo)` | Requiere motivo (`PARAM_TODOS` por defecto) |
| Anular | `GET /requerimientocompra/anular/{id}` | `:409` → `actualizarEstado(id, ANULADO)` | Ver doc `solicitud-anular.md` |
| Agrupar | `GET /requerimientocompra/agrupar/{idList CSV}` | `:442` → `agrupar(idList)` | Ver doc `solicitud-agrupar.md` |
| Consolidado | `GET /requerimientocompra/obtenerConsolidadoParaImportar/{idList}` | `:437` | Preview sin persistir |
| Canjear (paso 1) | `POST /requerimientocompra/canjearRequerimientoPorOrdencompra` | `:448` | Valida y devuelve `array_proveedor/sin_proveedor` |
| Generar OC (paso 2) | `POST /requerimientocompra/generarOrdenCompraByRequerimiento` | `:455` | Crea OCs, pone `CANJEADO` |

## 3. Aprobar / rechazar (reglas exactas)

Controller `logistica/controllers/RequerimientocompraLogisticaController.php`:
* `aprobarRequerimientocompra()` (`:459-522`): solo si estado es `PENDIENTE` o `RECHAZADO` (`:485`); si no → `" No es posible aprobar un requerimiento que no se encuentra en estado pendiente."` (con espacio inicial). Éxito `"Se modifico con éxito."` + `EventoLogistica::registrarEvento(ACCION_CAMBIOESTADO)` (`:497`).
* Frontend además bloquea aprobar vencidas: `"No se puede aprobar un requerimiento ya vencido"` (`lista...controller.js:196`, `ver...controller.js:166`).
* `rechazar` habilitado si `PENDIENTE||APROBADO` (`lista...:214`); `aprobar` habilitado si `PENDIENTE||RECHAZADO` (`lista...:169`). Botones `requerimientocompra.html:14-28` con `ng-disabled` por estado.
* Registrar: éxito `"Se agregó tu requerimiento de producción con éxito."`, error `"Se produjo un error al crear tu requerimiento de produccion. Inténtalo de nuevo."` (`:27-68`).

## 4. Validator (qué exige el POST)

`smart/validators/RequerimientocompraLogisticaValidator.php`: registro exige numeroReferencia + usuario + local + almacén + ≥1 detalle + fecha entrega + fecha vencimiento (`:49-59`); detalle exige `cantidad>0` (`"Error: ... tiene una cantidad no valida."`), `cantidadaceptada>0`, entrega válida (`"La fecha de entrega asignada no es valida."`), vencimiento ≥ entrega (`"La fecha de vencimiento asignada no puede ser menor a la fecha de entrega."`), referencia única (`"El número de referencia ya ha sido registrado con anterioridad."`). **Anulación: retorna vacío, cero validaciones** (`:75-79`).

## 5. Permisos (`api/definitions.php:2799-2813`)

`REGISTRAR_SOLICITUD_COMPRA='10'`, `ANULAR_SOLICITUD_COMPRA_LOGISTICA='12'`, `APROBAR_RECHAZAR_SOLICITUD_COMPRA_LOGISTICA='62'`, `REGISTRAR_ORDEN_COMPRA_LOGISTICA='6'`. Anular exige `...12` (`Controller:207`), rechazar/aprobar exigen `...62` (`:216,:469`), generar OC exige `...6` (`:547`), generar desde faltantes exige `...10` (`:634`). Sin permiso: `"No tienes permisos para realizar esta acción, por favor comunicate con el administrador del sistema."` Registrar/actualizar/agrupar **no chequean ACL**.

## 6. Replicación bot

1. `POST registrar` → asertar `estado=1` + literales registro. 2. `GET aprobar/{id}` dos veces: 1.ª éxito, 2.ª literal "no es posible aprobar...". 3. Aprobar vencida (frontend) → literal vencido. 4. Sin permiso → literal ACL. 5. Rechazar con motivo → `estado=5`, re-aprobar → `estado=2`.
