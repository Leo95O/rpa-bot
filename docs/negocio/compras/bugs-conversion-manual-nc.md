# Bugs de backend: conversión manual y notas de crédito (mapeados por el bot)

> **Decisión 2026-11-03:** no se toca el backend; el bot solo mapea los defectos. Cada uno queda como paso
> en FALLO en la suite (flujo indicado) hasta que se corrija. Backend: rama `master_php85`, feature en el
> commit `22cb7a8b5` (conversión manual + borrador). Detectados en la corrida del 2026-11-03.

---

## BUG-CM1 (F28) — El insumo desaparece de las búsquedas agrupadas por insumo

**Flujo:** insumo con una presentación de conversión manual; buscarlo donde la pantalla agrupa por insumo
(`agruparInsumo = SI`): Kárdex individual (`kardexindividual.controller.js:915`), ingredientes de receta
(`receta/nueva/nueva.controller.js:1224, 1289`), movimientos de producción, filtros de compras/ventas/reportes
y la directiva de grilla (`handsontable.js:2049`).

* `InsumoLogisticaDB.php:112-114` agrupa con `group by i.insumo_id` y MySQL devuelve una fila cualquiera del grupo.
* `InsumoLogistica.php:1909` descarta después, en PHP, las filas de presentación manual (`debeOcultarPresentacionManual`).
* Si la fila que quedó del grupo es la manual, el insumo entero sale del resultado. Reproducido: manual id 2199 < Base 2200 → ausente.
* No depende de la config 197: apagarla no lo evita.

**Impacto:** el insumo existe, tiene stock y se compra, pero no se encuentra en el Kárdex ni se puede agregar como ingrediente. Sin error visible.

**Arreglo sugerido:** en modo agrupado no descartar la fila, solo vaciar el nombre de la presentación (la pantalla agrupada solo muestra el insumo); o excluir la manual en el SQL del `group by`.

---

## BUG-CM2 (F38) — Anular una NC por precio restaura la entrada con el precio de la presentación

**Flujo:** compra con línea manual (6 Kilo @10, ingreso 5 → costo base S/ 12) → NC por precio → anular la NC.

* `NotacreditocompraLogistica::anular` (`:640-650`) re-clona la ENTRADA_COMPRA con `costooperacion = $producto->item_precio`.
* `item_precio` es el precio por presentación (S/ 10 por Kilo), no el costo por unidad de control. En una línea manual el correcto es `costo × cantidad ÷ cantidad manual` = S/ 12.
* Resultado real: entrada viva `5 @ 10.00` en lugar de `5 @ 12.00`.
* Probablemente más amplio (sin comprobar): cualquier presentación con factor ≠ 1 (p. ej. "Mayorista x10") quedaría con el precio del pack como costo unitario.

**Impacto:** el Kárdex queda mal valorizado tras anular la NC, sin error visible.

---

## BUG-CM3 (F39) — La NC por descuento general se rechaza

**Flujo:** modal de NC → «Es por descuento general» → monto.

* El modal envía `esPorDescuentoGeneral = 1`, `esPorDescuentoEnItems = 0` y líneas con cantidad 0 y `productoDescontar = SI` (`modalRegistroNotaCreditoCtrl.js:695-697`).
* Ningún código del backend (`logistica/`, `smart/`, `api/`) lee `esPorDescuentoGeneral`.
* `NotacreditocompraLogisticaValidator::_validarDetalles` (`:83-87`) la valida como NC por cantidad y la rechaza: "… tiene cantidad 0, por favor verificar. No hay detalles modificados".
* **Confirmado 2026-11-04:** el control de F39 sobre una compra sin conversión manual se rechaza con el mismo mensaje.
  No es de la conversión manual: afecta a toda NC por descuento general.

**Impacto:** la opción «Es por descuento general» del modal no registra la NC en ninguna compra.

---

## BUG-CM4 (riesgo bajo) — Empates de segundo con los clones de la NC por precio descuadran el stock leído

**Flujo:** compra → NC por precio (clona la entrada con fecha `original + 1 second`) → cualquier otro movimiento
del mismo insumo y almacén en ESE segundo (otra NC, una venta que descuenta, etc.).

* Corrida 2026-11-04 (insumo 1825): compra 10:56:23, NC por cantidad 10:56:24, clon de la NC por precio también 10:56:24.
* Con el clon vivo, el stock que devuelve `obtenerStockYCosto` fue 15.5 en lugar de 17.5 (resta dos veces la salida
  del mismo segundo). Al anular la NC, la entrada restaurada quedó en :25 sin empate y el stock volvió a 17.5.
* La cadena de `saldoactual` grabada es correcta; el descuadre está en cómo se lee el último estado cuando hay
  movimientos con la misma fecha (mismo origen que el `<` estricto de `MovimientoalmaceninsumoV2DB.php:109`).

**Impacto:** poco probable con uso normal, pero posible en insumos con mucho movimiento (ventas descontando en el
segundo exacto del clon). El bot lo evita esperando 5 s desde la compra antes de registrar NC (`registrarNotaCredito`).
