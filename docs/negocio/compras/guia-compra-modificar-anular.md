# Guía de Compra — Modificar y Anular

> Endpoints: `POST /actualizarGuia` (`rest/guiacompra/index.php:21` → `Controller:348-411`), `GET /anularGuia/{id}/{devolverStock}` (`:22` → `Controller:679-757`).

## 1. Modificar

`procesarObjetoGuia` + `inicializarModificacion()` (conserva `fechaemision` anterior, carga anterior para comparar, `:191-223`) → `validar(MODIFICAR_GUIA)` → `existeGuia()` (duplicado serie/número) → `actualizar()` (`:342-375`: histórico, `update()`, re-parse detalle, recalcula impuestos, `actualizarDetalleguia`, previsualización). Por línea (`DetalleguiaLogistica.php:375-458`): nueva→`insert+incrementarStockGuia`; modificada (cantidad/costo/descuento/afecto/almacén/lote/presentación/sinImp o fecha/TC nuevos, `:820-839,387-403`)→`update+incrementarStockGuia(true)`; eliminada→`disminuirStockPorAnularGuia+delete`. Éxito `"Se actualizó tu guía con éxito."`; duplicado mismo literal de registro; >90 días `"La guia tiene más de 90 días registrada."` (sin "de compra", distinto al de anular); cuadre posterior mismo literal. **Kardex posterior desactivado en modificación** (`Validator:107-114` comentado) — solo aplica al anular.

## 2. Anular (orden de validaciones y literales)

1. ACL `ANULAR_GUIA_COMPRA_LOGISTICA` o `"No tienes permisos..."` (`:688-694`).
2. Merma vinculada (`merma.guia_id + ACTIVO`, `GuiaLogistica.php:129-135`) → `"La guía de compra esta vinculada a una salida de stock, para poder anular la guía primero anule la salida de stock cod: ..."` (`:748-751`).
3. >90 días → `"La guía de compra tiene más de 90 días registrada."` (`Validator:122-127`).
4. Kardex posterior **solo productos** (motivos `SALIDA_MOVIMIENTO, SALIDA_PREPARACION_RECETA_BASE, SALIDA_MERMA`, `:292-299`) → `"El producto de la posición N, ya ha sido usado para otra operacación..."` (insumos no bloquean, `:312-319` comentado).
5. Cuadre/apertura posterior (si config local activa) → `"Los items: ... tienen un cuadre..."`.
6. Compra vinculada: **sin validación** — se puede anular guía usada por compra (deja huérfano).
Efecto (`GuiaLogistica.php:438-452`): `estado=INACTIVO + usuario/fecha anula`, desvincula OCs (`guia_id→null`, OC reactiva) y guía-remisión, `update()`. Stock **solo si `devolverStock==SI`**: anula movimientos `ENTRADA_GUIA` (`fueeliminado=SI`) + merma automática (`:1471-1482,772-811`); con `!=SI` la cabecera muere pero el stock queda. Éxito `"Se anuló la guía de compra con éxito."`

## 3. Relación con los otros sub-flujos

* **Modificar vs importar**: lo modificado recalcula impuestos y mueve Kardex diferencial (no reescribe historia); si la guía nació de OC, la OC no se re-evalúa (el vínculo persiste tal cual).
* **Anular guía → reactiva OC** (desvincula, OC vuelve a canjeable) pero **no avisa a la compra** que la usó (huérfano `compra_id`). Orden correcto de desarme total: anular compra (libera guías) → anular guía (revierte stock, desvincula OC) → anular OC.
* **Anular sin devolver** (`devolverStock!=SI`): útil solo si el stock ya se corrigió por otra vía (cuadre); el bot debe preferir `SI` y verificar `fueeliminado`.

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| M1 | `actualizarGuia` cambiando cantidad/costo | diferencial de stock + PPP recalculado, impuestos re-desgravados |
| M2 | Duplicado serie/número de otro proveedor-activo | literal duplicado (vía `validarGuiaPorProveedor...` o POST) |
| M3 | Modificar guía >90 días | literal sin "de compra" (vs anular con "de compra") |
| A1 | `anularGuia/{id}/1` limpia | `estado=INACTIVO`, movimientos `fueeliminado=SI`, OC desvinculada |
| A2 | `anularGuia/{id}/0` | cabecera INACTIVO pero stock intacto (documentar, no usar por defecto) |
| A3 | Guía con merma ACTIVA / >90 días / producto con salidas / cuadre posterior | literales respectivos en orden |
| A4 | Guía usada por compra | anula igual (huérfano `compra_id`); el bot lo advierte, no lo espera como error |
