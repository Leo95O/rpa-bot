# Orden de Compra — Importar a Guía / Compra (canje aguas abajo)

> Previo común: `POST .../obtenerOrdenesCompraAImportar` (Guía `:32-33`/`GuiaLogisticaController:568-579`, Compra `:68`/`CompraLogisticaController:1561-1572`) → `OrdencompraLogistica::obtenerListaOrdenesImportar(lista, validarEstado, local_id)` (`:623`). Creación: Guía `POST /guardarGuia` (`guiacompra/index.php:20`, payload `guia.ordencompraList[]`, `GuiaLogistica.php:235-327`); Compra `POST /agregarCompra` (`compra/index.php:21`, payload `compra.compra_ordencompraList[]`, `CompraLogistica.php:466-662`).

## 1. Qué hereda (fórmulas)

* Solo estados canjeables (`ACEPTADA/PROCESADA_DISTRIBUCION/ENPROCESO`, `:640`); sin distribución trae detalle íntegro; **con distribución filtra por `local_id` y reprorratea**: `precio = round(precioOriginal/cantidad × cantidadLocal)` (`:683-691`), `cantidad = cantidadLocal`.
* Consolidado multi-OC con promedio ponderado `round(total/cant,4)` (`:888-899`); unitarios `item_precio = precio/cantidad`, `item_total = precio×cantidad` (`:729-733,808-811`).
* **Descuento de lo ya canjeado**: resta cantidades usadas en guías activas (`:927-938`, match tipo+id+presentación) y en compras activas (`:945-970`); solo pasan líneas con `cantidad>0`.

## 2. Estados que pone

* Guía con distribución (`GuiaLogistica.php:462-502`): marca `distribucion.guia_id + estado TOTAL(1)/PARCIAL(2)`; completa→OC `PROCESADA(2)`, parcial→`PROCESADA_DISTRIBUCION(6)`. Sin distribución (`:506-601`): OC `PROCESADA`, o `ENPROCESO(7)` si despacho parcial; con 1 OC compara cantidades guía vs OC para decidir completo.
* Compra (`CompraLogistica.php:1246-1415`): `compra_id + PROCESADA`, parcial→`ENPROCESO`; con 1 OC verifica `detallecompra_cantidad < ordencompra_cantidad`; si `precio != costo×cantidad` lo repara (`:1399-1400`).
* Matemática heredada (ver `orden-de-compra.md §5`): la Compra/Guía desgrava después (`CalculoLogistica.php:124-146`: bruto→`sinImp=bruto/1.18`).

## 3. Relación con los otros sub-flujos

* **Importar es el consumidor de todo lo anterior**: lee el detalle vigente (lo que dejó **editar**), exige el estado que deja **aprobar**, respeta la `evaluacion` (checkbox deshabilitado si `evaluacion==3`), y escribe los vínculos que después bloquean **anular** (`compra_id/guía_id`, estados `PROCESADA/ENPROCESO`).
* **Importar parcial habilita el siguiente canje**: el saldo (`cantidad OC − canjeado`) sigue importable; el bot debe encadenar OC→Guía parcial→Compra del saldo y verificar que la suma cierra.
* **Distribución conecta con solicitud**: `distribucionByLocal=1` en el canje solicitud→OC es lo que permite importar por `local_id` aquí (`...ByDistribucion/{local_id}`).

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| I1 | Importar OC PENDIENTE | `array_ordenes` vacío (filtrada por `:640`) |
| I2 | Importar OC distribuida por local | `cantidad==cantidadLocal`, `precio==round(orig/cant×cantLocal)` |
| I3 | Segundo canje tras parcial | `item_cantidad` = saldo (descuento `:932,:960`); líneas agotadas ausentes |
| I4 | Guía total vs parcial | OC `PROCESADA` vs `PROCESADA_DISTRIBUCION/ENPROCESO`; `distribucion.guia_id` seteado con estado correcto |
| I5 | Compra repara precio (`:1399-1400`) | si divergía, `detalleordencompra_precio==costo×cantidad` tras importar |
