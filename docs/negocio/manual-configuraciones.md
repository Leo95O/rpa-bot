# Manual de Configuraciones (Ajustes por Local + Globales) — impacto en el bot

> Fuente: pantalla Ajustes (por local + globales), tabla `configuracionlocal`, `api/definitions.php`, `api/entity/Configuracion.php`. Gate canónico: `Configuracion::estaActivado(id, local)`. Cada ficha: nivel usuario (qué ve) + nivel técnico (gate y efecto) + **veredicto AFECTA/NO** con adaptación del bot. Excepción: config **106 es global** (ignora local, `Configuracion.php:446-447`).

## A. Display y costos (grupo A)

### A1. Activar reservas de stock (id 64, +77, +99) — AFECTA (disponibilidad)
Usuario: con reservas activas el sistema aparta stock para producción/delivery y muestra disponible menor que el físico. Técnico: no resta físico (`MovimientoalmaceninsumoV2` intacto); reserva en `reservastock/detallereservastock`, disponible = `real − reservado` (`Insumo.php:385-398`); gates `MovimientoalmaceninsumoController:3980,4048`, `Reservastock.php:269,299,501`. `obtenerStockYCosto` devuelve **físico** (reserva invisible). Bot: si 64/99 activa, validar con `disponible=stock−reservado` (`Detallereservastock::getTotalStockReservado`) y no esperar baja de físico tras reservar.

### A2. Mostrar costos sin impuestos (id 72) — AFECTA (reportes)
Usuario: informes muestran costos netos por defecto. Técnico: solo conmuta columna `costo↔costosinimpuesto` (`MovimientoalmaceninsumoController:4132`, `Almacenproductoinsumo:481-519`, `Insumo:200-202`); `obtenerStockYCosto[].costo` sigue bruto. Bot: endpoint siempre contra bruto; reportes/Kardex valorizado conmutan según 72 (÷1.18).

### A3. Decimales precios/cantidades (id 73; 144 es solo PDF venta) — SOLO FORMATO
Usuario: define cuántos decimales se muestran (default 3, `valoraux1`=costo, `valoraux2`=cantidad). Técnico: `Utility.php:6502,6554`; BD guarda `decimal(12,4)/(18,6)` sin truncar. Bot: comparar numéricamente con tolerancia `10^-N` (leer aux1/aux2), nunca strings.

### A4. Kardex por presentación de control (id 95) — AFECTA (lectura)
Usuario: el Kardex se ve en la presentación marcada como control (ej. cajas en vez de kg). Técnico: solo lectura (`Utility.php:9848-9906`, early-return si OFF); BD y endpoint siguen en UM base. Bot: endpoint siempre UM base; en reportes aplicar inversa (×`presentacion_cantidad` + conversión UM).

### A5. Costos de la última compra (id 106, global) — AFECTA (costo endpoint)
Usuario: costos mostrados según última compra en vez de promedio. Técnico: `Almacenproductoinsumo.php:514 ultimoCosto()` (última entrada vs PPP, con overrides `:523-531`); propaga a `getCosto()` y FIFO/teórico. Bot: leer 106 global; si ON esperar última-entrada (comprar a precio distinto del PPP lo demuestra), si OFF esperar PPP. Ya implementado en `oracle.ts:costoEfectivoEsperado`.

### A6. Ocultar ceros decimales (id 190) — NO AFECTA
Usuario: `30.000→30`. Técnico: trim de texto (`Utility::esOcultarCerosCantidad`). Bot: parsear a número antes de comparar.

### A7. Alerta variación ≥X % (id 109, solo UI) — NO AFECTA
Usuario: banner cuando el precio varía más del umbral. Técnico: **sin gate backend**; `variacion=(nuevo−anterior)/nuevo×100` (`DetallecompraLogistica:1428-1446`, ¡denominador = actual!), solo puebla `item_variacion`. Bot: no esperar bloqueo; como pediste, la variación se verifica como dato (`obtenerCompra.item_variacion`), no como freno.

### A8. Precio de venta por % (id 115) — NO a stock; SÍ a guía de venta
Usuario: el precio de venta se calcula `base×(1+% /100)`. Técnico: toca `item_precio` de guía de venta (`GuiaremisionLogisticaController:806`), base = último precio o costo Kardex (`valoraux2==SI`), override por ítem. Bot: ignorar en stock; en asserts de venta calcular con 115+aux1/aux2.

## B. Validaciones y restricciones (grupo B)

### B1. Derivados en compras (id 119) — AFECTA (condicional)
Usuario: con ON aparecen derivados en el buscador de compras. Técnico: pasa `esDerivado` al buscador (`CompraLogistica:4726,5046`, `Cargamasiva:140,1245`). Bot: leer 119; si OFF no elegir derivados (no aparecen), si ON sí puede.

### B2. Restringir productos del proveedor en OC — NO EXISTE como config
Usuario: la pantalla lo describe pero **no hay `CONFIGURACION_*` ni gate backend** (validator solo filtra listado por proveedor). Bot: usar mismo `proveedor_id` cabecera-detalle y pasarlo al buscador por higiene, sin asertar bloqueo.

### B3. Alterar costos al porcionar (id 121) — AFECTA
Usuario: permite digitar costos resultantes al porcionar. Técnico: con ON el costo usa `presentacionresultantereceta_valorizado` en vez del prorrateo (`Preparacionreceta.php:577,662-787`). Bot: si ON, esperar el valorizado enviado, no el prorrateo.

### B4. Restringir movimientos antes de cuadre (id 123) — AFECTA
Usuario: no permite movimientos con fecha anterior al último cuadre/apertura. Técnico: compara contra `obtenerUltimaAperturaCuadreStock` en compra/guía/movimiento (`Validators :136-167,511-555,404-448`). Literal: `"Los items: ... tienen un cuadre..."`. Bot: fechar operaciones después del último cuadre o usar ítems sin cuadre; ante el literal, re-fechar.

### B5. Canjear cantidades mayores (id 133) — SIN GATE BACKEND
Usuario: permitiría canjear de más. Técnico: solo `definitions.php:505` + doc; cero gates. Bot: canjear `<=solicitado` siempre; `>` solo como negativo controlado.

### B6. Restringir recetas en req. stock (id 153) — SIN GATE BACKEND
Técnico: sin `estaActivado(153)`; hay regla fija que prohíbe recetas/derivados (`RequerimientomovimientoValidator:260`). Bot: usar insumos base en requerimientos.

### B7. Permitir compra de recetas (id 157) — AFECTA
Usuario: con ON el buscador de compras muestra recetas. Técnico: `esReceta=estaActivado(157)` (`CompraLogistica:4717,5037`). Bot: **esta es la respuesta oficial a la duda de recetas en OC/compra**: solo comprar receta si 157=`1`; si `0`, el backend no la lista (sin hard-stop posterior: si se fuerza por API persistiría como insumo — no hacerlo).

### B8. Validar cantidades al canjear OC (id 160, default ON) — POTENCIAL
Usuario: no canjear más de lo solicitado. Técnico: seed default `'1'` pero **sin gate localizado**; canjes solo validan estado/vínculo. Bot: canjear `<=solicitado` siempre.

### B9. Stock de sustitutos en producción (id 189) — AFECTA (producción)
Usuario: solo sustituto con stock suficiente. Técnico: `Modificacionpreparacionreceta.php:188-220`, literal `"...no hay stock suficiente del sustituto...(stock: X, requerido: Y)."` (solo con sustitución). Bot: garantizar stock del sustituto o evitar sustituir.

### B10. Mermas pendientes sin permiso (id 174) — AFECTA (merma/stock)
Usuario: usuarios sin permiso generan mermas que quedan pendientes de aprobación. Técnico: sin `REGISTRAR_SALIDA_DE_STOCK` → `MERMA_ESTADO_PENDIENTE` + `pendientedescargastock=SI, alteraStock=NO` (`MermaLogistica:99-105,393-469`); aprueba rol autorizado (`MermaLogisticaController:2894-2923`). Bot: con usuario sin permiso verá pendiente y **stock inalterado** (falla el assert de Kardex): usar usuario con permiso o añadir paso de aprobación.

## C. Locales, almacenes, correos, acciones, globales (grupo C)

### C1. Locales producción/venta (`local_esproduccion`, `Local.php:964`) — AFECTA
`generarOrdencompraCalculadoraStock` exige producción o `"Debes ser local de produccion..."` (`:1030-1036`); requerimientos bifurcan por flag (`Loterequerimiento:165-211`). Porcionar/preparar no lo chequean. Bot: leer flag antes de calculadora; si NO, ir por requerimiento→producción.

### C2. Almacenes compra/despacho (`deabastecimiento/dedespacho`, `AlmacenLogisticaDB:233,254`) — AFECTA
Los automáticos toman origen/destino de aquí, no de un almacén cualquiera. Sin abastecimiento configurado hay hasta fatal sin null-check (`Solitudmovimiento:849-858`). Bot: resolver ambos por `local_id` (endpoints `obtenerAlmacenDeAbastecimientoPorLocal`) y abortar con mensaje útil si `false`; mockear ambos getters en tests.

### C3. Correos (cuadre + requerimientos) — NO AFECTA flujo
Ambos envían **mail real** (Mailgun/Amazon con adjuntos) solo si config + destinatarios (`Cuadremanual:2892-2993`, `Requerimientomovimiento:4104-4189`); el registro ya persistió, sin rollback. Bot: stubear `enviar*PorEmail` y `enviarCorreoElectronicoMultiDirecciones` en e2e; asertar `tipo/mensajes`, nunca inbox.

### C4. Acciones rápidas — RIESGO OPERATIVO
Hoy una sola: id=1 `UPDATE presentacioninsumo SET buscar=1` sin filtro ni rollback, solo rol sistemas (`CommonLogisticaController:9528-9551`). Bot: **jamás llamarla**; setear `buscar` por fila.

### C5. Globales
**a) Autocompletar destinatario guías venta** — AFECTA DATOS: con gate global ON, al canjear sugiere el cliente del local destino y con confirmación **crea cliente + dirección** (`GuiaremisionLogistica:184-399`, endpoints `:1081,1099`). Bot: solo GET lectura; POST creador con confirmación explícita y RUC ficticio, nunca en bucles.
**b) Cuadre por validación DRAFT** — AFECTA: con activa, el cuadre manual queda `DRAFT` y **no mueve stock hasta validar** rol autorizado + procesar por tandas (`CuadremanualLogistica:168-231,3043-3299`, `Controller:759,3727-3806`; archivo sigue clásico). Bot: consultar `obtenerAccionesCuadre`/`validacionActiva`; tras guardar esperar DRAFT → `validarCuadre` → procesar → recién asertar Kardex.

## Resumen ejecutivo (tabla)

| AFECTAN al bot | NO AFECTAN (o solo formato) |
|---|---|
| 64 reservas, 72 sin-imp (reportes), 95 presentación, 106 última compra, 119 derivados, 121 porcionar, 123 cuadre, 157 recetas, 160 canje-OC, 174 mermas, 189 sustitutos, C1 locales, C2 almacenes, C5a clientes, C5b DRAFT | 73 decimales, 190 ceros, 109 variación, 115 (stock), B2/B5/B6 (sin gate), C3 correos, C4 (prohibido) |

Pre-vuelo recomendado del bot: leer por local `{64,72,73+aux,95,106(global),119,121,123,157,160,174,189}` + `esProduccion` + almacenes + `validacionActiva` + IGV fiscalizado, e imprimirlo como baseline (igual que c72/c106 hoy).

## Plan de toggles mid-suite (qué configs deben cambiarse para cubrir todos los flujos)

Principio acordado: se parte de un **estado inicial definido por DB** (seed de `configuracionlocal` + maestros) y se modifica a mitad de suite con **restore garantizado** (`try/finally`, patrón Bloque 7 contraste). Solo estas configs exigen toggle; el resto se fija una vez al inicio.

| # | Config | Estado inicial (seed) | Toggle requerido (flujo que lo exige) | Restore |
|---|---|---|---|---|
| 106 | Última compra (global) | OFF (PPP, modo normal) | ON para F-distribuida-última-compra y contraste display (ya implementado `setConfig` Bloque 7) | Sí, a OFF |
| 72 | Sin impuestos display | OFF (bruto) | ON para asserts de reportes netos | Sí, a OFF |
| 65 | Impuestos dinámicos (+`valoraux2`=1 COMPRAS) | OFF (rama fija, `version=2`) | ON para rama dinámica (`version=3`, `impuestodetallecompra`) | Sí, a OFF |
| 157 | Compra recetas | OFF | ON solo para F-compra-receta | Sí, a OFF |
| 119 | Derivados en compras | según ambiente (leer) | ON para F-derivado si seed OFF | Sí, al inicial |
| 121 | Valorizado porcionar | OFF (prorrateo) | ON para F-porcionar-valorizado | Sí, a OFF |
| 64/99 | Reservas stock | OFF | ON para F-disponible-vs-físico | Sí, a OFF |
| DRAFT cuadre | Cuadre por validación | OFF (clásico inmediato) | ON para F-cuadre-DRAFT (guardar→validar→procesar) | Sí, a OFF |
| C5a | Destinatario auto | OFF | ON para F-guía-venta-entre-locales | Sí, a OFF |
| 73 aux1/aux2 | Decimales 3/3 | 3/3 | otros valores solo para F-redondeo-display | Sí, a 3/3 |
| 115/109 | Precio-venta % / alerta variación | OFF / 100 % | ON / umbral bajo para F-alerta (solo presencia de banner, sin bloqueo) | Sí |

**Caso especial no toggleable con admin (174 mermas pendientes):** el estado pendiente depende del **permiso del usuario**, no de un flag conmutable: con sesión admin la merma siempre aprueba directo. Ese flujo (pendiente→aprobar) requiere sesión restringida, fuera del alcance E2E acordado; se documenta y no se programa.
**No requieren toggle:** 95 (se lee y se convierte), 123 (se provoca con datos: cuadre posterior real), 160 (default ON, canjear ≤), 189 (se provoca usando sustituto), 190 (parseo), C1/C2 (datos maestros), C3 (stub), C4 (prohibida).

## Decisiones registradas (2026-10-16)
1. **Multi-local**: los flujos F10 (distribución), C5a (destinatario entre locales) y calculadora exigen 2.º local operativo. El bot, con poder total sobre la BD local, decidirá en fase de construcción si crea el local (Lima) o simula con almacenes; este manual solo deja constancia del requisito. Decisión diferida a la fase bot.
2. **Sesión**: el usuario de corrida es admin full-permisos (mermas, validar cuadres, anular/aprobar/evaluar incluidos). Las negativas ACL quedan fuera del alcance E2E (requerirían sesión restringida); si un día faltara un permiso, se crea el usuario/rol con él en vez de rodearlo.
3. **Umbrales vivos vs fijos**: variación (109/aux1) y decimales (73/aux1-2) se **leen en vivo en el pre-vuelo** desde `configuracionlocal` (igual que c72/c106 e IGV fiscalizado hoy), no se fijan en docs ni specs. El doc fija la semántica; los valores los aporta el entorno en cada corrida.
