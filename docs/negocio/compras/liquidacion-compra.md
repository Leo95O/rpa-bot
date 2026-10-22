# Liquidación de Compra — Mapeo (agrupador contable, sin prorrateo)

> Rutas `POST liquidacioncompra/preProcesadoLiquidacionCompra`, `POST /registrar`, `GET /obtener/{id}`, `/anular/{id}`, `/obtenerLista` (`rest/compra/index.php:140-144` → `CompraLogisticaController:3177-3403` → `LiquidacioncompraLogistica.php`). Uso exclusivo `Vecindad de los Cuates`.

## 1. Qué es (y qué NO es)

Agrupador de compras para facturación/migración contable. `registrar()` (`LiquidacioncompraLogistica.php:68-86`) solo: `INSERT liquidacioncompra` + `UPDATE compra SET compra_liquidacionid=id WHERE compra_id IN (...)`. **No toca `detallecompra`, no recalcula costos, no genera Kardex.** La tabla (`LiquidacioncompraEntity.php:7-26`) no tiene columnas de flete/aduana/percepción ni detalle de gastos: no hay prorrateo de importación en backend (búsqueda vacía en `logistica/`, `api/entity*/Liquidacion*` y validator). `anular()` revierte: `estado=INACTIVO` + `compra_liquidacionid=NULL` (`:88-105`).

## 2. Payload y validaciones

Pre-registro `{listaCompras:[ids], local_id, caja_id, moneda_id, proveedor_id, fechas documento/vencimiento/contabilidad}` (`Controller:3209-3267`); registro exige lo mismo (`Validator:45-90`). Solo admite compras `ACTIVO + paraliquidacion + liquidacionid IS NULL` **del mismo local y moneda** o `"Todas las ventas deben pertenecer al mismo local..."` / `"No se encontraron algunas de las ventas..."` / `"Se esperaba almenos una compra para liquidar"`. Fórmulas (todo sumatorias): `dscto=Σcompra_descuento`, `impuestos=Σcompra_igv`, `total=Σcompra_total` (`Controller:3246-3251`, recalculadas en validator `:73-83`; asiento SAP por compra en `:277-289`).

## 3. Relación y verificación bot

1:N vía `compra.compra_liquidacionid` (condicionado a dominio Vecindad en `CompraEntity:896-1453`). Bot: `SELECT SUM(total,igv,descuento) FROM compra WHERE liquidacionid=?` vs fila; link/unlink antes-después; `detallecompra_costo` idéntico antes-después (prueba de no-prorrateo); lista exige fechas (`"Fecha de inicio/fin requerida"`). Bug menor: anular responde `data=notacreditocompra_id` (inexistente → null, `:3290`).
