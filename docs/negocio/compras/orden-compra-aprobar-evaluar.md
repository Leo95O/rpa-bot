# Orden de Compra — Aprobar / Rechazar / Evaluar

> Rutas `rest/ordencompra/index.php:25,33-35` → `OrdencompraLogisticaController.php:607-646,710-826`. Config `CONFIGURACION_APROBACION_MANUAL_DE_ORDEN_DE_COMPRA=71` (`definitions.php:454`).

## 1. Aprobar / rechazar

| | Aprobar | Rechazar |
|---|---|---|
| Ruta | `GET /aprobarOrdencompra/{id}` (`:33` → `:132`) | `GET+POST /rechazarOrdencompra/{id}` (`:34-35` → `:149`; POST lee `payload.motivo`, default `PARAM_TODOS`) |
| Transición | `PENDIENTE(4)/RECHAZADO(5) → APROBADO(1)` (`:789-797`); otro estado → `" No es posible aprobar un requerimiento que no se encuentra en estado pendiente."` (espacio inicial) | `→ RECHAZADO(5)` + motivo; éxito `"Se modifico con éxito."` |
| Permiso | `APROBAR_RECHAZAR_ORDEN_COMPRA='91'` (`:724,773`); sin permiso `"No tienes permisos..."` | mismo |
| Frontend | `GET aprobarOrdencompra/{id}` habilitado solo `PENDIENTE/RECHAZADO` (`lista...:231`); rechazar vía modal `"Estas por rechazar la orden de compra #"+id / "Ingrese el motivo"` (`lista...:2005-2006,2033`) | — |

## 2. Evaluar (doble capa: estado × evaluación)

Valores `definitions.php:2391-2394`: `PENDIENTE=0, ACEPTADA=1, OBSERVADA=2, RECHAZADA=3`. Al crear: manual(71 activa)→PENDIENTE, auto→ACEPTADA (`OrdencompraLogistica.php:283-287`). Endpoint `POST /evaluarOrdenescompra {listaOrdenescomopra:[ids], ordencompra_tipoevaluacion:1..3}` (`:25` → `:114` → `Controller:607-646`): exige permiso `PERMITIR_EVALUAR_ORDEN_DE_COMPRA='121'` + rango 1..3; por id `evaluacion=tipo + update`. Éxito `"Se evaluaron las ordenes compra con exito."` (sic); parcial `"Se produjo un error al evaluar..."`; sin permiso/rango `"El usuario no cuenta con el permiso para realizar la evaluación."` Frontend pre-filtra ya-aceptadas (`"Las ordenes de compra con codigo: X ya fueron aceptadas."`, `:1266`) y exige selección (`:1292`); checkbox deshabilitado si `evaluacion==3`, con `compra_id/guia_id>0`, `estado` fuera de APROBADO/ENPROCESO o `distribucion==SI` (`:1369-1398`). Bug: condición `:620` (`!=ACEPTADA || !=RECHAZADA`, siempre true) impide bloqueo backend de re-evaluación — solo verificable vía frontend.

## 3. Relación con los otros sub-flujos

* **Aprobar es prerrequisito de casi todo**: editar bloqueado en APROBADA (hay que rechazar→editar→re-aprobar); **importar a Guía/Compra exige estados canjeables** (`ACEPTADA/PROCESADA_DISTRIBUCION/ENPROCESO`, `OrdencompraLogistica.php:640`) — una OC PENDIENTE no aparece en `obtenerOrdenesCompraAImportar`.
* **Evaluar no mueve estados**, solo el semáforo `evaluacion`; con aprobación manual, la OC nace `evaluacion=PENDIENTE` y el flujo real es evaluar→aprobar→importar.
* **Rechazar reabre**: `RECHAZADO` puede re-aprobarse o editarse, a diferencia de `ANULADA` (terminal salvo desvinculación).

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| A1 | `GET aprobarOrdencompra/{PENDIENTE o RECHAZADO}` | `estado==1` + `"Se modifico con éxito."` |
| A2 | Aprobar APROBADA/PROCESADA | literal `no se encuentra en estado pendiente` |
| A3 | `POST rechazarOrdencompra/{id} {motivo}` | `estado==5`, evento con motivo |
| A4 | Sin rol 91 | `"No tienes permisos..."` (requiere sesión restringida) |
| A5 | `POST evaluarOrdenescompra {ids, tipo:1/2/3}` (config 71 + permiso 121) | `evaluacion` cambia, literal éxito; `tipo:0/4` o sin permiso → literal permiso |
