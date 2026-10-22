# Compra — Modificar y Anular

> Endpoints: `POST /actualizarCompra` (`rest/compra/index.php:22` → `Controller:119-209`), `GET /anularCompra/{id}/{devolverStock}` (`:39` → `Controller:983-1045`).

## 1. Modificar (`actualizar()` en `CompraLogistica.php:1593-1736`)

`procesarObjetoCompra → inicializarParaActualizacion → validar(MODIFICAR_COMPRA) + validarReduccionLoteEdicionIa() + validarSaldoCajaPorCambioModalidadCompra() + !existeCompra()` → `actualizar()`: histórico, `update()` cabecera, re-parse + re-desgravación, `actualizarDetallecompra` (flete re-prorrateado `:698-717`, `modificacionDetalle` por línea: nueva/modificada/eliminada → entradas/salidas diferenciales + `regularizar`), re-alineación de guías/OCs (`actualizarDetalleGuiacompra/Ordencompra`), **CxP borrada y re-generada** (`eliminarCoutasCompra + re-registrar` por `listCuotas`, `:1664-1678`), egresos de caja re-emitidos, impuestos V3, previsualización. Éxito `"Se actualizo tu compra con éxito."` (+ aviso de lote `"Esta compra pertenecia a un lote..."`).
Bloqueos (`Validator:145-209` + caja/cuadre/lote): moneda, fecha, >N días (90; 120 Hanzo), cuotas pagadas (`"La compra es al crédito y tiene cuotas pagadas"`), almacén del local, los 5 de lista/UM, crédito sin cuotas, caja (3 literales + 2 de cambio de modalidad), documento notificado al proveedor electrónico, cuadre posterior, reducción bajo lote consumido.

## 2. Anular (`anular()` en `:2552-2609`)

Permiso `ANULAR_COMPRA_LOGISTICA` → `validar(ANULAR_COMPRA)` → `compra_devolver=devolver` → efectos: `estado=INACTIVO + usuario/fecha anula`; **desvincula OC** (`compra_id=NULL`, OC→APROBADO, `:2635-2639`) y orden-servicio/recepción; si `saliodecaja==SI` crea **ingreso reverso** (`:2517-2537,2581`); re-parse; si `devolver==SI` y **sin guías vinculadas** (`compraEstaVinculadaAGuia`, `GuiaLogistica.php:702-717`) → `_descontarStockPorDevolucion()` (contra-salidas por línea, `fueeliminado=SI`); anula NCs de la compra + sus movimientos; **libera guías y OCs** (`liberarCompraVinculada`, guías quedan ACTIVAS con `compra_id=null`).
Validaciones (`Validator:81-143`): >N días (`"La compra tiene más de N días registrada."`), productos procesados, **cuotas pagadas** (bloquea), cuadre posterior, **lote consumido/movido** (`"El item de la posicion N tiene su lote ya consumido o movido a otro almacen..."`). Éxito `"Compra Anulada con exito"`.

## 3. Relación con los otros sub-flujos

* **Anular compra reactiva OC** (desvincula, OC→APROBADO recanjeables) y **libera guías** (ACTIVAS, reutilizables) — es el primer paso del desarme total (compra→guía→OC).
* **Con guías vinculadas no descuenta su propio stock** (el físico lo puso la guía; `_descontarStockAGuiasVinculadas` comentado `:2597`) — el bot debe anular guías por separado para revertir todo el físico.
* **Modificar re-escribe CxP**: cualquier cambio de total con crédito regenera cuotas; los pagos ya amortizados bloquean (`cuotas pagadas`).
* **NCs mueren con la compra** (`anularNotaCreditoCompra` + anula sus movimientos).

## 4. Validaciones verificables por el bot

| # | Acción | Aserción |
|---|---|---|
| M1 | `actualizarCompra` cambiando precio/cantidad | PPP re-promediado diferencial + impuestos + `precio==costo×cant`, CxP regeneradas |
| M2 | Duplicado / moneda / fecha / >días / cuotas pagadas / lote | literales respectivos |
| A1 | `anularCompra/{id}/1` limpia sin guías | `INACTIVO`, movimientos `fueeliminado=SI`, OC desvinculada (APROBADO), NCs anulas |
| A2 | Con guías vinculadas | sin descuento propio; luego anular guías y verificar físico revertido |
| A3 | Con cuotas pagadas / >días / lote consumido / cuadre | literales de bloqueo en orden |
| A4 | Contado-caja | ingreso reverso creado (`"Por anulación de compra: ..."`) |
