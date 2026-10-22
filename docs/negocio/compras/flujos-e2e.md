# Flujos E2E de Compras — Semilla Maestra + Secuencias Replicables

> Complementa `matriz-e2e-masiva.md` (35 casos acumulativos vigentes): este doc fija **qué maestros crear al inicio** (cuántos, con qué configs) y **todos los flujos replicables del módulo Compras** con su matemática esperada (Kardex, stocks, PPP, impuestos con/sin, variación). Tolerancia: stock exacto, costo ±0.02. IGV fiscalizado 18 % (`divisor=1.18`, leído de BD como la suite).

## 0. Semilla maestra inicial (crear una vez tras `limpiarBaseDatos`)

### 0.1 Catálogos (no los crea el bot si existen; `asegurarCatalogosMinimos`)

| Catálogo | Valor QA | Uso |
|---|---|---|
| Proveedor | MAKRO QA (RUC QA) + MAKRO-Dólares (para F24-F26) + Proveedor Default | `proveedor_id` de OCs/compras/NCs; duplicado serie/nro se valida por proveedor |
| Local / almacenes | CD Logístico (1): Principal (1), Producción (18) | Central=1, Sucursal=18 (igual que la suite) |
| Moneda | Soles (`tipocambio_compra=1.0000`) + Dólares (`tipocambio_compra=3.80`) | multiplica costos (`costoTC`) y reportes; último precio segmenta por moneda |
| UM | KG (peso), UNIDAD (conteo) | `unidadmedidainsumo_id` obligatoria |
| Categoría insumo | Categoria uno (activa) | alta de insumos la exige |
| Categoría receta | (solo si el flujo toca recetas; compras no) | — |
| IGV | fila `fiscalizado=1` local 1, 18 % | divisor desgravación; exonerados la ignoran |

### 0.2 Maestros (7 altas: 4 insumos + 1 consumible + 2 productos)

| # | Entidad | Flag | Impuesto | UM | Presentaciones (nombre×cantidad, estándar) | Control stock (alm 1/18) | Stock min/max (por almacén) | Precio min/max (referencial) | Stock inicial |
|---|---|---|---|---|---|---|---|---|---|
| I1 | Carne QA | regular | **Afecto** | KG | Base×1 ✓, Mayorista×10 | 1:SÍ, 18:SÍ | 5 / 500 | 15 / 40 | 0/0 |
| I2 | Verdura QA | regular | **Exonerada** (`afecto=NO`, lo común en verduras) | KG | Base×1 ✓ | 1:SÍ, 18:SÍ | 5 / 300 | 3 / 12 | 0/0 |
| I3 | Pollo QA | regular + **merma auto 5 %** (`mermaporcentaje` + `mermaautomaticaalcomprar=SI`, ambos obligatorios) | Afecto | KG | Base×1 ✓ | 1:SÍ, 18:NO | 5 / 300 | 8 / 25 | 0/0 |
| I4 | Arroz QA | regular | Afecto | KG | Base×1 ✓, Saco×50 | 1:SÍ, 18:SÍ | 10 / 1000 | 2 / 8 | 0/0 |
| C1 | Caja Empaque QA | `consumible=1` | Afecto | UNIDAD | Base×1 ✓ | 1:SÍ | 50 / 5000 | 0.3 / 1.0 | 0 |
| P1 | Gaseosa QA | `controlstock=SI` | Afecto | UNIDAD | UNIDAD×1 ✓, Pack×6 (compra) | 1:SÍ | 12 / 600 | 2 / 6 | 0 |
| P2 | Gaseosa Sin Control QA | `controlstock!=SI` | Afecto | UNIDAD | UNIDAD×1 ✓ | — | — | — | — (nunca Kardex) |

Notas: `preciomin/max` y `stockmin/max` son **referencia/alerta, nunca bloquean** compra/traslado (ver `mapeo-entidades-maestras.md §6`); el bot los verifica solo como lectura. P2 existe para probar el early-return (esperar sin movimiento).

## 1. Flujos (formato usuario: qué se hace, con qué datos, qué debe pasar)

> Convención de fechas: `HOY` = día en que corre el bot (se calcula en vivo). Fecha de entrega = HOY+1 (nunca pasada, el backend la corrige a mañana si es inválida). Vencimiento solicitud = HOY+7 (opcional). Vencimiento OC = HOY+7. Serie/número siempre únicos (`-Date.now()`).

### F1. Solicitud → OC → Compra (canje clásico, afecto con impuestos)
Paso 1 — Se crea la solicitud de compra. Datos: fecha de entrega: HOY+1; área solicitante: Cocina; vencimiento: HOY+7; insumo: Carne QA; presentación: Base; cantidad: 50kg; almacén: Principal. Esperado: solicitud PENDIENTE, stocks en 0.
Paso 2 — Se aprueba (PENDIENTE→APROBADO) y se canjea (se marca el checkbox de la lista). Modal: "1 orden en local CD Logístico, Proveedor MAKRO, ¿distribución? NO". Datos OC generada: proveedor MAKRO, 50kg @20 bruto, importe 1000, `sinImp=NULL`. Esperado: solicitud CANJEADA, OC creada, stock 0.
Paso 3 — Se registra la compra canjeando la OC. Datos: serie/nro únicos, proveedor MAKRO, fecha compra HOY (tributación = compra), 50kg @20, almacén Principal. Esperado: `costo=20`, `sin=16.949`, `importe=1000`, `sub=847.458`, `igv=152.542`; Central 0→50, PPP 20.000; OC PROCESADA; último precio 20.
### F2. Solicitud → OC → Guía → Compra (físico anticipado)
Paso 1 — Solicitud Carne QA 30kg (HOY+1, Cocina) → aprobar → canjear: OC-2 30@22, importe 660. Paso 2 — Se registra la guía canjeando OC-2. Datos: serie guía única, 30kg @22, almacén Principal. Esperado: ENTRADA_GUIA, Central 50→80, PPP 20.750 (sin 17.569); OC-2 PROCESADA. Paso 3 — Se registra la compra con `guiaList` (factura posterior). Esperado: sin movimiento físico nuevo (`alteraStock=NO`), asienta CxP/impuestos; `obtenerGuiasVinculadas` la muestra; comparativo guía↔compra cierra.
### F3. OC manual → Compra (sin solicitud)
Paso 1 — Se crea la OC directa. Datos: proveedor MAKRO, Arroz QA, 2 sacos Saco×50 (=100kg), @4/kg, vencimiento HOY+7. Esperado: OC PENDIENTE/APROBADA, stock 0. Paso 2 — Compra canjeando OC. Esperado: conversión `100kg`, Central 0→100, PPP 4.000.
### F4. Compra directa (sin documentos previos)
Datos: Carne QA 50kg @30 bruto, Principal, serie única. Esperado: Central 80→130, PPP 24.308; último precio 30, variación +33.33 % informativa (vs último real de BD).
### F5. Exonerada (Verdura, sin impuestos)
Datos: Verdura QA 10kg @10, `afecto=NO`. Esperado: `sin==costo==10`, `igv=0`; Central 0→10, PPP 10.000. Contraste motor (igual 9A-9B).
### F6. NC cantidad (devolución)
Datos: NC sobre compra F4, 10kg, serie NC única. Esperado: SALIDA_NOTA_CREDITO_COMPRA, Central 130→120, PPP congelado 24.308.
### F7. NC precio (rebaja)
Datos: NC sobre Verdura, descuento 2 c/u (10u@10). Esperado: sin salida; clon +1s `nuevoCosto=8.00`, origen `fueeliminado`; stock 10, PPP 8.000.
### F8. Modificar compra (hacia adelante)
Datos: compra F3 100@4 → 100@5 (misma serie/nro/proveedor). Esperado: diferencial +100 de valor, PPP re-promediado hacia adelante, impuestos re-desgravados, CxP regeneradas si crédito.
### F9. Anular compra (LIFO)
Datos: anular la modificada F8 con `devolverStock=SI` (<90 días, sin cuotas pagadas, sin guías). Esperado: contra-salidas, PPP previo restaurado, OC desvinculada (APROBADO, recanjeables), NCs anuladas, ingreso reverso si fue caja.
### F10. Distribuida multi-local (una OC, dos destinos)
Paso 1 — Dos solicitudes mismo ítem/proveedor: SOL-101 Piura 10kg + SOL-102 Chiclayo 20kg (cada una: HOY+1, su área, Principal). Paso 2 — Canjear ambas juntas, checkbox distribución SÍ: 1 OC 30u + 2 filas distribución (Piura 10 + Chiclayo 20 con direcciones). Paso 3 — Guía por local (cantidades + `round(orig/cant×cantLocal)`). Esperado: estados PROCESADA/PROCESADA_DISTRIBUCION. Variante con y sin impuestos (convergencia). Requiere 2.º local o simular con almacenes (documentar).
### F11. Crédito + cuotas + amortización
Datos: Arroz 200@4=800 al crédito, 2 cuotas 400+interés, proveedor MAKRO. Esperado: 2 `comprasporpagar`, `limitecredito−=800`; amortizar 400 → cuota 1 cerrada, `limitecredito+=400`; NC con crédito amortiza; anular con cuotas pagadas bloquea.
### F12. Servicio + Rápida (sin Kardex)
Servicio: fumigación 100 + consumible 5u → solo SALIDA_COMPRA_SERVICIO, cero ENTRADA_*, CxP igual. Rápida: útiles 50 caja → `detallecompramanual` + egreso, cero Kardex. Negativas de serie/caja iguales.
### F13. Consumible y producto reventa
Caja Empaque 200@0.50 (espejo 0→200, PPP 0.500) → salida 50 (150, congelado). Gaseosa Pack×6: 12 packs=72u, conversión ×6 ÷6. Gaseosa Sin Control: compra sin movimiento (early-return).
### F14. Calculadora (sin Kardex). Liquidación y electrónicas: FUERA DE ALCANCE
**Liquidación y electrónicas (DTE/OCR/XML) el bot NO las considera** (decisión 2026-10-16; ambos docs quedan como referencia técnica). Calculadora requiere **contexto previo de faltantes**: local de producción, stock bajo el mínimo o requerimiento/MRP con `cantidadFaltante>0`, proveedor asignado. Con ese contexto: agrupar por proveedor → generar (1 OC por proveedor, merma+`ceil`+último precio, obs `"Generada por cálculo de producción "`). Negativas: local no productivo, origen pendiente, duplicada.
### F15. Compra multi-documento (2 OCs + 1 guía → 1 compra)
Dos OCs (Carne 20u + Arroz 50kg) y una guía parcial en una sola compra (`docvinculado=|guias|+|ordenes|`): consolidado ponderado `round(total/cant,4)`, OCs→PROCESADA/ENPROCESO, saldos re-importables.
### F16. Canjes parciales y saldos encadenados
Guía parcial 40/100 → OC ENPROCESO → compra del saldo 60 → PROCESADA (descuento `:927-970` por paso; la suma cierra). Incluir parcial con distribución (PARCIAL por local).
### F17. Cargos y descuentos (matriz de totales)
Arroz 100@4 + descuento ítem 10 % + global + flete 50 + ICBPer + percepción (flete entra al costo → PPP; retención resta al pagable). Ver §4.
### F18. Multi-moneda (TC≠1)
Compra en dólares (`tipocambio=3.80`): `costoTC`, `sinTC`; último precio por moneda; reportes `Σx×TC`.
### F19. Precio neto (`incluye-impuestos=NO`)
Misma F1 digitando neto 16.949: `imp=base×p`; convergencia con F1 salvo céntimo.
### F20. Pago mixto + caja + retenciones
Contado parcial + crédito, efectivo+tarjeta (2 egresos), retención/detracción al pagable. Anular revierte egresos (`"Por anulación de compra: ..."`).
### F21. Compra con merma automática (Pollo QA 5 % + flag SI)
Datos: 100kg @10 bruto, stock S, PPP P. Esperado: merma 5kg, costo encarecido 10.526; ENTRADA (100, S→S+100, PPP=(S×P+1000)/(S+95)) + SALIDA_MERMA (5@0, →S+95); `mermaid` seteado; anular revierte ambas. Caso OFF: 100 netos, PPP normal.
### F22. Fusión de solicitudes (varias → 1 OC)
Paso 1 — Tres solicitudes: SOL-201 Carne 20kg + SOL-202 Carne 30kg + SOL-203 Arroz 40kg (cada una HOY+1, áreas Cocina/Almacén, Principal; todas APROBADAS, mismo proveedor MAKRO). Paso 2a (agrupar) — Seleccionar las 3 → Agrupar: nace SOL-204 con 50kg Carne + 40kg Arroz; orígenes a AGRUPADO (autorreferencia, sin pivote). Paso 2b (canje múltiple directo, alternativo) — Seleccionar las 3 → Canjear: modal "N órdenes, Proveedor MAKRO" → 1 OC con detalle consolidado por presentación (50kg @último precio + 40kg) + pivote `ordenrequerimientocompra` ×3 + estados CANJEADO. Esperado: una sola OC, cantidades sumadas, precio re-escrito al último de compra, trazabilidad a las 3 solicitudes. Negativas: una vencida/no aprobada/canjeada frena el lote (literales `filtros-canje`).
### F23. Fusión de OCs (varias → 1 guía / 1 compra)
Paso 1 — Tres OCs: OC-A Carne 20@20 + OC-B Carne 30@22 + OC-C Arroz 40@4 (todas APROBADAS/ACEPTADAS, MAKRO). Paso 2 — Importar las 3 a una guía (`ordencompraList=[A,B,C]`): líneas consolidadas por presentación con promedio ponderado `round(total/cant,4)` (Carne 50u @21.20); ENTRADAS al Kardex; las 3 OCs→PROCESADA con `guia_id`. Paso 3 (alternativo) — Importar las 3 a una compra: mismo consolidado + desgravación + CxP única; `docvinculado` con las 3. Esperado: 1 documento hijo, saldos cero (o parciales re-importables si fue parcial), `obtenerComparativo` cierra por ítem.
### F24. OC en dólares → compra (TC 3.80)
Paso 1 — OC manual. Datos: proveedor MAKRO-Dólares (moneda Dólares, `tipocambio_compra=3.80`), Arroz QA 50kg @2.00 USD, vencimiento HOY+7. Esperado: OC con `tipocambio=3.80` heredado de la moneda, importe 100 USD. Paso 2 — Compra canjeando OC. Esperado: `costoTC=2.00×3.80=7.60`, `sinTC=(2.00/1.18)×3.80=6.441`, `importe=380.00`; Kardex en soles (PPP con 7.60); `moneda_id`=Dólares en cabecera y detalle.
### F25. Mismo insumo en soles y dólares (último precio por moneda)
Paso 1 — Compra Arroz 50kg @7.60 soles (TC 1.0). Paso 2 — Compra Arroz 50kg @2.00 USD (TC 3.80 → 7.60 soles). Esperado: PPP promedia ambos en soles; `obtenerUltimoPrecioCompraPorInsumoProducto` por moneda devuelve cada uno en su moneda (sin mezclarse, con fallback documentado); variación calculada contra el último de su misma moneda.
### F26. Flete + TC combinados
Datos: Arroz 100kg @2.00 USD, TC 3.80, flete S/76.00, afecto. Esperado: `costoUnit=(2.00×100−0)/100=2.00 USD`, `fleteUnit=(200/200)×76/100=0.76 soles/kg`… (flete en soles sobre costo en soles: `unitSoles=7.60`, `costoFinal=7.60+0.76=8.36`), `sin=8.36/1.18=7.085`; PPP con 8.36; `importe`, `sub`, `igv` y `total=sub+igv+flete` verificados en §4.

## 4. Matriz de totales (subtotal, impuestos, total, cantidades) — verificación obligatoria por compra

Fórmulas (fijo, afecto 18 %; dinámico delega por línea pero cierra igual):

| Campo | Fórmula | Origen |
|---|---|---|
| `detalle.importe` | `costo×cant−descuentoItem` | `Detallecompra:63-68` / guía `:56-63` |
| `detalle.sinImp (subtotal línea)` | `sinUnit×cant` (`sinUnit=bruto/1.18` o neto) | `:2254-2257`, `CalculoLogistica:142-146` |
| `detalle.imp` | `sinUnit×0.18×cant` | `:145` |
| `compra.subtotal` | `Σ sub líneas afectas + Σ (unit×cant) inafectas` | totales V3 `:2039-2084` |
| `compra.igv` | `Σ imp` | idem |
| `compra.total` | `sub+igv+flete+icbper+percepción` (retención **no** suma, resta al pagable) | idem + `compra.js:854` |
| `cantidades` | `Σ cant por presentación == Σ UM-base/ factor` | conversión `Presentacioninsumo:140-164` |

El bot aserta en **dos niveles**: línea (`assertDetalleCompraSinImpuestos` + `importe==costo×cant−desc`) y cabecera (nuevo `assertTotalesCompra`: `subtotal/igv/total` vs Σ recalculado + `flete/icbper/percepción` leídos + `cantidades` vs suma). Casos exonerados: `igv==0`, `sub==total−flete−icbper−percepción`.

## 2. Qué verifica el bot en cada flujo (checklist por flujo)

1. **Kardex**: `assertStockInsumo/EnAlmacen/Consumible` (stock exacto, costo ±0.02, vía con y sin impuestos). 2. **Detalle persistido**: `assertDetalleCompraSinImpuestos` (`costo==pactado`, `sin==pactado/1.18` o `==pactado` si exonerado, `sub==sin×cant`) y `assertDetalleOC` (`precio==importe`, `sinImp` NULL-or-neto según origen bot/UI). 3. **Vínculos**: `ordencompra_id/CANJEADO`, `compra_id/guía_id`, `PROCESADA/ENPROCESO`, `distribucion.guia_id`, `compra_ordencompraList`. 4. **Variación**: `ultimoPrecio` + `item_variacion` (solo informativa). 5. **Deuda**: cuotas, `amortizacion`, `limitecredito`, egresos/ingresos reversos. 6. **Negativas**: literales por substring + estado/BD invariante.

## 3. Conteo final de altas iniciales

**7 maestros** (I1–I4, C1, P1–P2) + 1 proveedor (+default) + 2 almacenes + 2 UM + 1 categoría + IGV 18 %; **9 presentaciones** (6 Base + Mayorista×10, Saco×50, Pack×6); stock min/max en 6 filas `almacenproductoinsumo`; precios min/max en 9 presentaciones (solo referencia). Sin stock inicial (todo nace de los flujos) salvo el necesario para salidas (los flujos lo generan antes).
