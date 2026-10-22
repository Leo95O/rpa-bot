# Solicitud de Compra — Filtros Pre-Canje y Negativas

> Dónde: `logisticaview/app/scripts/logistica/compra/dashboard/dashboard.controller.js:1630-1691`, `.../requerimientocompra/listarequerimientocompra/lista.requerimiento.compra.controller.js:887-936,1046-1061`, `.../verrequerimientocompra/ver.requerimiento.compra.controller.js:124-260`. El backend repite la validación (`RequerimientocompraLogistica.php:687-694`).

## 1. Los 3 filtros + vacío (lista y dashboard, idénticos)

Antes del `POST canjearRequerimientoPorOrdencompra`, el frontend filtra la selección (`validarSolicitudesPorImportar` / `validarOrdenesCompraPorImportar`):

| # | Filtro | Condición | Literal exacto (`UtilityService.mostrarNotificacion(ERROR, ...)`) |
|---|---|---|---|
| 1 | Ya canjeada | `ordencompra_id > 0` | `"Los solicitud de compra con codigo: {ids} ya fueron cajeadas."` / singular `"...ya fue cajeada."` (sic, sin "n") |
| 2 | No aprobada | `estado != APROBADO(2)` | `"Los solicitud de compra con codigo: {ids} no tienen estado aprobado."` / `"...no tiene estado aprobado."` |
| 3 | Vencida | `hoy(YYYY-MM-DD) > fechavencimiento` | `"Los solicitud de compra con codigo: {ids} ya vencieron"` |
| 4 | Vacía | `list.length == 0` | `"Debe seleccionar al menos un requerimiento"` |

Solo se POSTean los marcados: `_obtenerSolicitudesAImportar` / `_obtenerRequerimientosAImportar` (`requerimientocompra_id*1>0 && ..._seleccionadaparaimportar==true`). Nota: el chequeo "mismo local" está **comentado** (`lista...:919-929`) para permitir canje multi-local — es lo que habilita la distribución por local.

## 2. Vista detalle (unitaria, `ver...controller.js:124-260`)

Sin filtros de lista; validación por caso en `operacion(tipo)`: aprobar exige no vencida (`:153-166`) o `"No se puede aprobar un requerimiento ya vencido"`; canjear unitario exige `estado==APROBADO` o `"Debe estar aprobado"` (`:254`); título `"Estas por canjear los requerimientos seleccionados por {N} ordenes/orden de compra"` (sin tilde) + `"Porveedores:/Porveedor:"` (sic) + `"{n} items/item sin proveedor"`; vacío `"No se encontro item para canjear"`; éxito `"Se registraron las órdenes de compra"` / error `"No se pudieron registrar las órdenes de compra"`.

## 3. Checkbox deshabilitado

`fnRenderCheckbox` (`lista...:1190-1192`): si `estado==CANJEADO`, checkbox `readOnly+disabled` — la solicitud canjeada no se puede re-seleccionar.

## 4. Replicación bot (3 negativas + 1 positiva)

N1: solicitud `PENDIENTE` → canjear → literal "no tiene estado aprobado". N2: `APROBADA` con `ordencompra_id>0` → literal "ya fue cajeada". N3: `APROBADA` vencida → literal "ya vencieron" (frontend) y exclusión backend (`:687-694`). P: N aprobadas vigentes multi-local → modal con `distribucionByLocal` (ver `solicitud-de-compra.md`). Asertar por **código/flag**, no por ortografía (los literales tienen typos conocidos).
