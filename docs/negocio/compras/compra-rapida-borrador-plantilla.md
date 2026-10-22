# Compra Rápida, Borradores y Plantillas de Compra

> Rutas `agregar/actualizarCompraRapida` (`:31-32`), `guardarAvanceCompra` (`:23`), `avancecompra/obtenerLista` (`:129`), plantillas (`:54-56,61-62`).

## 1. Compra rápida (`TIPO_COMPRA_RAPIDA=3`)

Caja chica: descripción + precio, **sin Kardex**. Guarda `compra + detallecompramanual(descripcion/precio)` (`CompraLogistica.php:1028-1053,3918-3966`; depura al actualizar `:4071-4090`; lee `:2932-2937`), más cuotas si crédito y **egreso inmediato** si `saliodecaja==SI` (`generarEgresoCaja`, efectivo/tarjeta/cheque; `Egreso: "Compra: "+tipodoc+" N° "+serie+" - "+nro`). Valida con códigos de servicio (4/5): serie, lista, crédito, caja, fecha (`"Se agregó tu Compra con éxito."`). Tablas: `compra, detallecompramanual, comprasporpagar, egreso` (+`compraimpuesto` si versión 3). Bot: verificar egreso + cero movimientos Kardex; negativas de serie/caja.

## 2. Borrador (`guardarAvanceCompra` → `"Guardado"`)

Pausa una factura larga sin tocar BD transaccional: guarda `avancecompra + detalleavancecompra(cantidad/descuento/afecto/precio, producto/presentaciones/servicio, almacen, caducidad)` (`AvancecompraLogistica:21-74,130-218`; validator solo lista, `AvancecompraLogisticaValidator:55-94`). Se lista (`obtenerListaAvancecompra`, exige fechas), se reabre (`obtenerPlantillaDeCompra` reconstruye formato compra), y **al concretar se borra** (`eliminarAvancesCompra`, salvo plantilla; si `esUnaPlantilla()` re-guarda avance, `Controller:84-87`).

## 3. Plantillas de compra

`esplantilla='SI'` en `avancecompra`: listar (filtros fecha/proveedor/tipodoc/local + `numeroItems`), obtener (hereda tipodoc/serie/nro/fecha/crédito/obs/proveedor/local/moneda/caja/impuestos + ítems reconstruidos con último precio y variación, `CompraLogistica:2674-2827`), anular (permiso `ANULAR_COMPRA_LOGISTICA`, **borrado físico** `eliminarTodosPorAvance+delete`, `"Plantilla anulada con exito."`; OC usa borrado lógico `INACTIVO` en cambio).

## 4. Bot

Rápida: alta + egreso + cero Kardex. Borrador: guardar → listar → reabrir → concretar (avance borrado) → compra normal con Kardex. Plantilla: crear (desde compra con `esplantilla`), usar (herencia verificada campo a campo), anular (desaparece físico). Negativas: lista vacía, fechas de lista requeridas.
