# Compra — Impuestos: modo fijo vs dinámico y matriz de configuraciones

> Dispatcher `CompraLogistica.php:2177-2296`, motor `CalculoLogistica.php:6-164`, preview `obtenerMontosPorImpuestosDinamicos` (`rest/compra/index.php:24` → `Controller:282-316`, devuelve `{listaImpuestosGeneral, detalleCompra, totalesCompra}` sin persistir).

## 1. Fijo vs dinámico (config 65)

`CONFIGURACION_PERMITIR_USO_DE_IMPUESTOS_DINAMICOS...=65` (`definitions.php:450`) en `configuracionlocal(valor=1/0, valoraux2=submodo 0=ALL/1=COMPRAS/2=VENTAS, `:4061-4063`); compras usa el check grueso (`estaActivado(65)`, `Configuracion.php:135-149`; `CompraLogistica:2186,2095,2316`, `CalculoLogistica:20`). Con dinámico, el catálogo por ítem sale de `ImpuestocompraLogistica::obtenerImpuestosPorInsumoProducto` y el cálculo delega por línea (`:2249-2266`, consolida `:2285`, totales V3 `:2293`); `compra_version=3`. En fijo, `CalculoLogistica.php:120-160`: `unit=(cant×valor−desc)/cant`, IGV `p=Igv::getPorcentajeIgvFiscalizadoCompra(local)/100`.

## 2. IGV fiscalizado (lo que el bot ya lee de BD)

Tabla `igv(fiscalizado=1, local_id)` → `Igv::getPorcentajeIgvFiscalizadoCompra()` (`Igv.php:115-164`): Perú con 10→**18** forzado, fuera Perú sin fila→0, fallback 18. Override por compra (`CompraLogistica:316-326,401-411`): Perú + `impuestoPeruNoDinamicos` válido + dinámicos OFF → `USAR_PORCENTAJE_AUXILIAR=true, PORC_IMPUESTO_COMPRA=%`, persistido en `compra_porcimpfiscalizado`. Constantes `AUX=10/AUX_2=8/AUX_3=10.5/FISCALIZADO_PERU=18` (`:2227-2233`).

## 3. Matriz con/sin impuesto × stock × variación (cómo afecta cada config)

| Config / campo | Detección bot | Con impuesto (afecto) | Sin impuesto (exonerado/inafecto) | ¿Mueve stock? | ¿Genera variación? |
|---|---|---|---|---|---|
| Base precio (`generoimpuestossobretotal` → `calcularAPartirTotal`) | `compra_generoimpuestossobretotal` | Bruto: `sin=unit/(1+p)`, `imp=sin×p×cant` | Neto: `sin=unit`, `imp=sin×p×cant` (el neto es base) | No decide stock | Misma `variacion=(actual−ant)/actual×100` sobre el costo resultante |
| `afectoimpuestos` línea (`detallecompra_afectoimpuestos`, default 1; de `insumo_afectoigv` / `productogeneral_inafecto/exonerado`) | por línea + maestro | desgrava y genera `impuestodetallecompra` | `imp=0, sub=unit×cant` (fijo `:151-157`, dinámico `:67-70` vía `parseDetalleCompraImpuestoCero`) | No | Sí, contra último precio con el mismo tratamiento |
| `compra_version` 2/3 | `compra_version` | V3 lee `impuestodetallecompra` + dinámicos (`:2978-2991`) | V3 inafecto `total=subtotal` (`CalculoLogistica:355-390`) | No | No |
| Percepción (`percepciontotal`) | `compra_percepciontotal` | suma al total, fuera de `igv/subtotal` | igual | No | No (no toca costo) |
| Retención/detracción (`conretencion, montoretencion`) | `compra_conretencion/montoretencion` | resta al pagable | igual | No | No |
| ICBPer (`compra_icbper`) | `compra_icbper` | `total=sub+igv+flete+icbper` (no en líneas) | igual | No | No |
| Flete (`compra_flete`) | `compra_flete` + línea | `fleteTotal=totalItem/totalDet×flete`, `fleteUnit=cant`, **entra al costo** (`Detallecompra:425-426`) → **sí mueve PPP** | igual (el flete no desgrava) | Vía costo | Sí (costo con flete vs último sin flete) |
| Tipo de cambio | `compra_tipocambio` | `costoTC=unit×TC`, `sinTC=sin×TC` | igual | No (solo reportes `Σx×TC`) | Último precio por (`tipo,presentación,local,moneda`) |
| `alteraStock/conguia/pendienteprocesarstock` | `compra_conguia`, `pendienteprocesarstock` | `conguia==SI→alteraStock=NO` (físico ya entró por guía); diferido + `aumentarStockPorCompraPendiente()` | igual | **Decide si la compra mueve físico** | Solo si mueve stock |
| Último precio / variación | `obtenerUltimoPrecioCompraPorInsumoProducto(tipo,id,local,moneda)` | `item_variacion`, alerta si `\|var\|>=config%` (`ordencompra.js:80-107`) | igual | No | **Es la variación: informativa, nunca bloquea** |

Regla de oro: **solo `costo` (con flete/TC/descuento) y `cantidad` mueven el PPP**; todo lo demás (percepción, retención, ICBPer, cuotas, versión) mueve totales/deuda, no Kardex. La variación es solo reporte (`ReporteVariacionPrecioCompras`, `Emuladorguia:147-182`).
