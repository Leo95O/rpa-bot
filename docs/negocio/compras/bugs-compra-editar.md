# Bug de Compra — Edición de una compra ANULADA (falta el freno en el backend)

> Alcance: defecto real encontrado por el bot E2E (Bloque 8, caso 45) al auditar el módulo de Compras.
> Estado: **reportado, no corregido**. El bot lo verifica con una negativa: la operación **debe** estar bloqueada.

---

## Bug CE-1 — `actualizarCompra` no valida el estado de la compra (permite reescribir una compra anulada)

### Dónde

* **Backend (sin freno):** `smart/validators/CompraLogisticaValidator.php:145-209` (`_validarModificacion()`).
  Valida moneda, fecha, antigüedad (>90/120 días), cuotas pagadas, almacén del local, lista/UM, crédito sin
  cuotas, caja, documento notificado, cuadre posterior y reducción bajo lote consumido.
  **No comprueba `compra_estado`**: no hay ninguna rama que rechace una compra `INACTIVO` (anulada).
* **Frontend (con freno):** `logisticaview/app/scripts/logistica/compra/listacompra/todaslascompras.controller.js:369-387`
  (`disabledContextMenuEditarAnular()`): si `compra_estado == estadosList[0].valor` (INACTIVO) devuelve `false`
  → la acción **"Editar compra"** queda deshabilitada en el menú contextual.

Es el mismo patrón que **Bug A** de `bugs-orden-compra.md` (el freno vive en la UI y no en el validator):
el usuario nunca ve el hueco porque la pantalla no ofrece la acción, pero la API sí la acepta.

### Impacto

1. Una compra anulada (documento con historia: movimientos `fueeliminado=SI`, NCs anuladas, OC desvinculada)
   puede **reescribirse**: el detalle persistido se muta y la cabecera pasa a reflejar otro documento.
2. **El Kardex no se recalcula**: la edición de una compra anulada no genera movimientos diferenciales
   (sus movimientos están eliminados), así que **cabecera/detalle y Kardex dejan de cuadrar** entre sí.
3. Se rompe la trazabilidad del documento anulado (el histórico ya no es reconstruible).

### Reproducción paso a paso

1. Registrar una compra (ej. 20 kg @ 50, serie/nro únicos) sobre un insumo con Kardex.
2. Anularla con `devolverStock=SI` → `compra_estado = 0` (INACTIVO) y contra-movimientos `fueeliminado=SI`.
3. `POST compra/actualizarCompra` con el mismo `compra_id` y un detalle distinto (ej. 5 kg @ 30).
4. Respuesta: **`tipo=1` (éxito)**. El `detallecompra` persistido queda con `cantidad=5, costo=30, importe=150`
   (20@50 original), y **no** hay movimiento nuevo en `movimientoalmaceninsumo`.

### Verificación por bot

`src/e2e/ediciones.spec.ts` (Bloque 8, caso 45): se anula la compra del caso 8 del Bloque 1 y se intenta
editarla; el veredicto esperado es **bloqueada por el sistema**. Hoy el sistema la permite → el caso queda
en rojo ("se permitió (defecto)"), que es el resultado correcto de una auditoría: el caso se puso verde
cuando el backend incorpore el freno por estado.

> Recordatorio de postura (ver `bugs-orden-compra.md`): el bot **no** explota el hueco — solo lo Constata
> con una negativa que el ERP promete bloquear. No se forzaron caminos, no se alteró el dato de otros flujos.

### Fix sugerido

Agregar en `CompraLogisticaValidator::_validarModificacion()` la validación de estado (p. ej.
`"No se puede modificar una compra que ya ha sido anulada."`) y/o rechazar en `CompraLogistica::actualizar()`
cuando `compra_estado != ACTIVO`. Severidad: **media-alta** (integridad de documentos contables; no es un
problema de seguridad).
