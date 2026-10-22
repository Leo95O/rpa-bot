# Formas de Pago en Compras — contado, mixto, crédito, débito

> No existe "compra al débito" como modalidad: es **tarjeta al contado** (`PAGO_TARJETA='2'`). `PAGO_DEBITO='4'` es de ventas (`definitions.php:959`, `pagoventa_tipo`); ningún flujo de compra lo referencia. Tipo de tarjeta DEBITO (VISA/Mastercard) vive dentro de `compra_montotarjeta`, no como forma propia.

## 1. Campos y fórmulas (`nuevacompra.controller.js:1759-1994`, `compra.js:349-353,1315`)

`pago=efectivo+tarjeta+cheque(otro)` · `debe=round(total−pago−retención)` (cero si abono excede + warn) · `interés=debe×%/100`, `totalDeuda=debe+interés`, `cuota=round(deuda/n)`, `interésCuota=round(interés/n)`, `capital=cuota−interés` (máx 10 cuotas, `Σcapital==debe` o `"...cronograma no coincide..."`) · cierre `round(pago+debe+retención)==round(total)` o `"...no coinciden..."` · contado exige `faltante<=0` (`"El monto pagado es insuficiente..."`) y caja con saldo por medio (`"...mayor al saldo actual en caja..."` ×3). Otro-pago: Transferencia/Depósito/Otros (`utility.service.js:3402-3409` → `1/2/3`) + banco + referencia.

## 2. Registro backend (`CompraLogistica.php:664-670,1421-1479`)

Crédito → `generarCuotasCredito()` (una `comprasporpagar` por cuota + `limitecredito−=Σ`); contado-caja → `generarEgresoCaja()` (**hasta 3 egresos**: `PAGO_EFECTIVO='1'` / `TARJETA='2'` / `OTROS='19'`→ se guarda `DEPOSITO='7'` por `char(1)`, `Egreso.php:79-80`; motivo `"Compra: tipodoc N° serie-nro[ — Tipo/Banco/Ref.]"`). Validaciones: crédito sin cuotas, caja (sin caja/selección/apertura/saldo). Abono de cuotas (`detallecomprasporpagar`): `formapago 1=Efectivo/2=Transferencia/3=Depósito/4=Cheque/5=Otros` + columnas por medio (`pagoefectivo/tarjeta/otros/deposito/cheque`, banco, operación, caja/turno); cierre `amortizacion+=pagos`, `>=totalcuota→pagada`, egreso si `dinerosalecaja`, `limitecredito+=pago`.

## 3. Bot (inamovible)

Contado puro (1 medio) / **mixto** (efectivo+tarjeta: 2 egresos, `pagado+debe+ret==total`) / crédito N cuotas (CxP + `limitecredito` + amortización parcial/total + `dinerosalecaja`) / retención (resta pagable) / negativas (insuficiente, descuadre, sin saldo, sin cuotas, >10). Débito se prueba como tarjeta al contado, jamás como modalidad.
