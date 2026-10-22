# Bugs de Compras — Flujos NO mapeados (reporte aparte)

> **Decisión 2026-10-16:** estos flujos tienen bugs reales que los hacen inadecuados para el bot E2E (el bot audita cálculos correctos, no explota defectos). Se documentan aquí para el equipo de desarrollo. **No se incluyen en `flujos-e2e.md`.**

---

## BUG-1 (F27) — Cambio de modalidad al modificar compra: 4 bugs encadenados

**Flujo:** editar compra cambiando contado↔crédito o montos de caja.

1. **Borrado físico de cuotas con pagos** (`CompraLogistica.php:1664` + `Comprasporpagar.php:38-61`): `eliminarCoutasCompra()` hace `delete()` de cuotas **y sus `detallecomprasporpagar`** (pagos). Pasar crédito→contado destruye el historial de amortizaciones.
2. **Egreso generado a pesar de validación fallida** (`:1864`): `$this->generarEgreso = true` se setea fuera del `if` de error de saldo/caja → se crea el egreso aunque la validación reportó insuficiencia.
3. **Borrado parcial de egresos** (`:1686-1716`): `eliminarEgresosGeneradosAlActualizarCompra()` solo elimina el **primer** egreso (`getById(...[0])`), pero una compra puede tener hasta 3 (efectivo/tarjeta/otros). Al reeditar: egresos duplicados/huérfanos.
4. **Ingreso compensatorio sin idempotencia** (`:1698-1716`): pasar a `saliodecaja=NO` genera un ingreso por `anularEgresoGeneradoPorCompra` en cada edición, sin marca de ya-compensado → editar 2 veces = 2 ingresos.

**Impacto:** cuotas/pagos/egresos/saldo-caja descuadrados tras modificación.

---

## BUG-2 (F28) — "Sin comprobante": dos validadores discrepan

**Flujo:** compra con `tipodoc="Sin comprobante"` (serie/nro `"-"`).

* `CompraLogisticaValidator.php:594-618` → `existeCompra():685-704` compara `tipodoc+serie+nro+proveedor+estado` por igualdad → dos compras `-/-` del mismo proveedor **colisionan** (falso duplicado).
* `CompraLogisticaDB.php:774-814` tiene guarda `:787-791`: si `nrodoc` no es numérico >0 (`"-"`), retorna `false` → **nunca colisiona** por esa vía.
* Agravante: `generarDatosComprobanteInterno()` (`CompraLogistica.php:2475-2482`) corre **después** de validar. Si el front envía vacío, la validación compara `""` (no colisiona) pero se guarda `"-"` → duplicados silenciosos.

**Impacto:** según qué envíe el front, o bloquea compras legítimas o deja pasar duplicados.

---

## BUG-3 (F29) — Dualidad de fechas: reportes se dividen con fallback divergente

**Flujo:** compra con `compra_fecha` ≠ `compra_fechatributacion`.

* Kardex/stock usa la correcta (física): `fechaparakardex = compra_fecha` (`DetallecompraLogistica.php:459`). **OK.**
* Reportes divididos: operativos filtran por `compra_fecha` (`Compra.php:1031-1068`), contables por `compra_fechatributacion` (`ContabilidadRestPe.php:3031`).
* Nada inicializa `compra_fechatributacion` en `registrar()` → NULLs frecuentes.
* Fallbacks divergentes ante NULL: `informecompras.php:219` usa `fecharegistro`; `ContabilidadRestPe.php:3124` usa `compra_fecha`; `informecomprassiscont.php:221-225` mezcla ambas.

**Impacto:** la misma compra se periodifica distinto por reporte → descuadres conciliación operativa vs contable.

---

## BUG-4 (F30-1) — Flete excluido del costo sin impuestos

**Flujo:** compra con `compra_flete>0`.

`DetallecompraLogistica.php:442-449`: `_obtnerCalculCostoSegunTipoCambio` suma `fleteUnitario` al costo con IGV, pero `_obtnerCalculCostoSinImpuestosSegunTipoCambio` **no lo suma**.

**Impacto:** PPP con IGV incluye flete, PPP sin IGV no → valorizado neto infravalorado en toda compra con flete. El bot debe conciliar ambas vías y alertar delta = flete prorrateado.

---

## BUG-5 (F30-2) — Último precio no filtra por almacén

**Flujo:** compra multi-almacén.

`DetallecompraLogistica.php:1140-1260` `obtenerUltimoPrecioCompraPorInsumoProducto` filtra por `local_id+moneda_id+fecha`, nunca `almacen_id`.

**Impacto:** sugerencia de precio mezcla almacenes. No corrompe guardado, pero sesga la variación.

---

## BUG-6 (F31-1) — Re-canje en edición no libera la orden de servicio anterior

**Flujo:** editar compra servicio cambiando `ordenservicio_id`.

`CompraLogistica.php:3773-3778`: sobrescribe la nueva sin `desvincular`/revertir la previa.

**Impacto:** OS vieja queda `CANJEADO` + `compra_id` huérfano para siempre: bloqueada, cuenta doble en canjes.

---

## BUG-7 (F32-1) — `item_costo` mal recalculado al leer plantilla

**Flujo:** concretar compra desde plantilla/borrador.

`CompraLogistica.php:2719-2723,2773-2777`: hace `item_costo = item_precio / item_cantidad` cuando `detalleavancecompra_precio` ya es **unitario** (`= detallecompra_costo`, `AvancecompraLogistica.php:188`).

**Impacto:** costo y variación divididos por cantidad → falsa caída de precio en pantalla y en `obtenerVariacionPorcentualCostoActual`.

---

## BUG-8 (F32-2) — Avance pierde flete, cuotas y TC al concretar

**Flujo:** guardar avance → reabrir → concretar compra.

`AvancecompraLogistica.php:21-73` `procesarObjetoAvanceCompra` solo copia fecha/esalcredito/nrodoc/seriedoc/tipodoc/total/proveedor/moneda/local/observación/flags plantilla. **Pierde `compra_flete`, `compra_tipocambio`, cuotas, impuestos dinámicos, `ordenservicio_id/recepcioncompra_id`, percepciones.**

**Impacto:** la compra concretada nace sin datos que el avance sí tenía.

---

## BUG-9 (F33) — Anular compra con guías vinculadas: stock huérfano duplicado

**Flujo:** anular compra que vino de guía, con `devolverStock=SI`.

1. **No-reversión** (`CompraLogistica.php:2589-2599`): con guías vinculadas salta `_descontarStockPorDevolucion()`; el `else` con `_descontarStockAGuiasVinculadas()` está comentado (`:2597`). Quedan **2 ingresos vivos** (guía + compra) con la compra INACTIVA → sobrestock + valorización duplicada.
2. **Contador incluye guías anuladas** (`GuiaLogistica.php:702-717`): `compraEstaVinculadaAGuia` cuenta sin filtrar `guia_estado` → una guía anulada histórica inhibe la reversión para siempre.
3. **`liberarCompraVinculada` sin filtro** (`GuiaLogistica.php:1393-1400`): desvincula también guías INACTIVAS, borrando trazabilidad factura↔guía.

**Impacto:** stock fantasma + valorización duplicada + trazabilidad rota.

---

## F34 — Primera compra sin historial: OK (sin bugs)

Sin división por cero (todo guardado), variación inaugural `0` o `+100 %` auditable, costo 0 excluido del PPP futuro. Solo informativo: fallback multimoneda sin tipo de cambio (sugiere precio en otra moneda sin convertir).
