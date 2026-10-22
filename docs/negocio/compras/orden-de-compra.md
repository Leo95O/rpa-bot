# Orden de Compra — Mapeo Integral (creación, tipos de ítem, reglas y matemática)

> Entidad: `ordencompra` + `detalleordencompra` (+ `distribucionordencompra`, pivote `ordenrequerimientocompra`).
> Idea humana: la OC es el **compromiso comercial** (qué le pido a quién, a qué precio). No mueve mercadería ni plata: **pacta**. El stock lo mueven después la Guía (físico) y la Compra (contable). Evidencia: `C:\xampp\htdocs\webapp\logistica` + `logisticaview/app/scripts/logistica/ordencompra`.

## 1. Las dos formas de nacer

### 1.1 Desde cero (manual)
Ruta `POST ordencompra/registrarOrdencompra` (`rest/ordencompra/index.php:17`, handler `:64-68` → `OrdencompraLogisticaController.php:512-524 registrarOrdencompra`). Payload obligatorio con **dos raíces** (sin la clave `ordencompra` revienta con `__clone on non-object`, `OrdencompraLogistica.php:223`):
```json
{ "ordencompra": { "local_id": 1, "proveedor_id": 1, "moneda_id": 1, "ordencompra_tipocambio": "1.0000", "ordencompra_fecha": "2026-..", "ordencompra_fechavencimiento": "YYYY/MM/DD", "ordencompra_observacion": "..." },
  "productos": [{ "item_id": 1620, "item_tipo": 1, "detalleordencompra_cantidad": 50, "detalleordencompra_costo": 20, "detalleordencompra_precio": 20, "almacen_id": 1, "presentacioninsumo_id": 5, "ordencompra_id": "-1" }] }
```
Frontend lo arma en `nueva.orden.compra.controller.js:736-766` (`objEnvio.ordencompra + filtrarDetalleDistribucion(detalleParaBackend)` + `avancecompra_id` solo si es plantilla). Cabecera hereda del proveedor (`diaspago, tipoperiodopago, direccionentrega/condicionentrega/pago/comercial`, `:678-681,748-754`) y de la moneda (`tipocambio_compra`, `:751`); `fecha = hoy`, `vencimiento = fechaDeCaducidad`, `porcentajeimpuestos = igv` (`:739-758`).

### 1.2 Desde solicitud (canje)
`POST requerimientocompra/generarOrdenCompraByRequerimiento` → `RequerimientocompraLogistica.php:783-1120` (ver `solicitud-de-compra.md`). Crea **1 OC por proveedor** (+1 con proveedor default para sin-proveedor), con `loterequerimiento_id` heredado (`:886,1020`), `estado=ACEPTADA`, `evaluacion` según config 71, vencimiento +1 semana, `ordencompra_id` en cada solicitud + pivote `ordenrequerimientocompra` + `estado=CANJEADO` (`:989-992,1116-1133`). Detalle consolidado por presentación con precio re-escrito al **último precio de compra** (`obtenerUltimoPrecioCompraPorInsumoProducto`, `:915-939,1047-1067`). Si `distribucionByLocal=1`, `ordencompra_distribucion=ACTIVO` + filas `distribucionordencompra(detalle, local, cantidad, dirección, ACTIVO)` (`:959-981,1087-1109`).

## 2. Detalle por tipo de ítem (a nivel humano y técnico)

La OC **solo acepta bienes comprables: insumos (regulares y consumibles) y productos de reventa**. No acepta recetas (fórmulas) ni servicios (van por orden de servicio).

| Tipo | Clave persistida | Rama código | Particularidad |
|---|---|---|---|
| Insumo regular | `presentacioninsumo_id` (+ `insumo_id`), `producto_id=null` | `DetalleordencompraLogistica.php:166 _esUnaPresentacionInsumo`, parser `OrdencompraLogistica.php:562-566` | Caso base. Cantidad × `presentacion_cantidad` a UM base aguas abajo. |
| Consumible | `presentacioninsumo_id` igual (solo flag `insumo_consumible=1` en el maestro) | Misma rama (cero referencias a `insumo_consumible` en flujo OC) | La OC **no distingue** consumible: la bifurcación a tabla espejo ocurre después, en Compra/Guía (`InsumoLogistica.php:6415-6477`). El bot debe marcar el caso pero el payload es idéntico. |
| Producto reventa | `producto_id` o `presentacioncompraproducto_id` | `:185 _esUnaPresentacionProducto`, `:204 _esUnProducto`; frontend `ordencompra.js:720-728` | Descripción `item_descripcion + presentacion_nombre`; al importar recalcula `cantidad×cantidad_presentación`, `costo/cantidad`. |
| Receta / derivado | — (no soportado) | Cero referencias a `receta_id` en flujo OC | Si llega un `recetabase=1`, el buscador/validator lo trata como insumo o lo rechaza; no hay rama de fórmula. |
| Servicio | — | Módulo `ordenservicio` separado | Nunca en `detalleordencompra`. |

Mapeo grilla→backend (`ordencompra.js:674-740`): `descripcion=item_descripcion`, `cantidad=item_cantidad`, `costo/precio=item_precio[ConImpuestos]` según `ordencompra_precioincluyeimpuestos` (default `SI`), `preciosinimpuestos=item_precioSinImpuestos`, `importe/total=item_total`, `descuento/afectoigv`, `almacen=almacenSeleccionado` (default backend `"1"`, `OrdencompraLogistica.php:540-546`), `ordencompra_id="-1"`, `localList/distribucionList` passthrough. Columnas reales (`DetalleordencompraEntity.php:6-18`): `id, ordencompra_id, cantidad, precio, fechacaducidad, afectoaimpuesto, producto_id, presentacioninsumo_id, almacen_id, presentacionactivo_id, presentacioncompraproducto_id, serviciocompra_id, preciosinimpuestos` (`costo/descuento/importe` colapsan a `precio`).

## 3. Relaciones (cómo se ata con todo)

* `ordencompra.compra_id / guia_id` + `estado PENDIENTE/PROCESADA/ENPROCESO/ANULADA` (`OrdencompraLogisticaController.php:1510-1514` mapeo por `item_tipo`).
* `ordenrequerimientocompra(ordencompra_id, requerimientocompra_id)` — historia solicitud→OC.
* `distribucionordencompra(detalle, local, cantidad, dirección, estado, guia_id)` — reparto multi-local (manual en `DetalleordencompraLogistica.php:87-105` por `localList.cantidad>0`, o por canje).
* `compra.compra_ordencompraList[]` / `guia.ordencompraList` — canjes OC→Compra/Guía (el `ordencompra_id` plano lo ignora el backend, `CompraLogistica.php:294-295`).
* `loterequerimiento_id, requerimientomovimiento_id, ordenproduccion_id, solitudmovimiento_id` — trazabilidad MRP (`OrdencompraEntity.php:6-39`).

## 4. Reglas que le dan orden (estados, validaciones, permisos)

* Estados (`definitions.php:2733-2743`): `APROBADO=1, PROCESADA=2, VENCIDA=0, ANULADA=3, PENDIENTE=4, RECHAZADO=5, PROCESADA_DISTRIBUCION=6, ENPROCESO=7`; despacho `TOTAL=1/PARCIAL=2`. Insert fuerza `PENDIENTE` (`OrdencompraLogistica.php:12`); evaluación `PENDIENTE=0/ACEPTADA=1/...` según `CONFIGURACION_APROBACION_MANUAL(71)`: manual→PENDIENTE, auto→ACEPTADA (`:283-287`).
* Registro valida (`OrdencompraLogisticaValidator.php:50-57`): detalle con `costo y cantidad numéricos` o `"La cantidad o costo de: {desc}, no es valida."` (`:206-229`); referencia única o `"El número de referencia ya ha sido registrado..."` (`:187`); solicitudes vinculadas deben estar APROBADAS/sin OC (`:131-177`, 6 literales "ya tiene OC / anulado / no aprobado / canjeado / agrupado / no válido").
* Anular bloqueada si: ya anulada, procesada (`:96-102`, sic "orde...anualada"), canjeada por compra (`:119`) o por guía (`:126`), o solicitud multi-orden (`:88`). Editar bloqueado si aprobada (`:104-114`).
* Permisos: **registrar NO chequea ACL inline** (convención `REGISTRAR_ORDEN_COMPRA='6'`); anular exige `ANULAR...='8'`, aprobar/rechazar `APROBAR_RECHAZAR...='91'`, evaluar `PERMITIR_EVALUAR...='121'`. Denegado: `"No tienes permisos..."`.
* Frontend previo (`ordencompra.js:792-987`): sin detalles, sin proveedor, vencimiento inválido, y distribución `Σlocal.cantidad == detalle.cantidad` o `"No se ha asignado toda la cantidad... / ...mas cantidad de la que se debe distrubuir..."` (sic).

## 5. Matemática (lo primordial del bot)

1. **La OC pacta, no mueve Kardex.** `OrdencompraLogistica::registrar()` (`:339-370`) = `insert + detalleParser + distribuciones + vínculos`. Cero `incrementarStock/MovimientoalmaceninsumoV2/ENTRADA_*`. El stock lo mueven Compra (`DetallecompraLogistica:77-176 ENTRADA_COMPRA`) y Guía (`DetalleguiaLogistica:604-703 ENTRADA_GUIA`).
2. **Precio guardado = IMPORTE, sin-imp = NULL.** Backend (`:552-554,568`): `detalleordencompra_precio = costo × cantidad; total += precio`. Auditoría `oracle.ts:assertDetalleOC`: `precio == importe`, `preciosinimpuestos IS NULL`, `cantidad == pactada`. La desgravación ocurre **después**, en la Compra.
3. **Lectura inversa:** `item_precio = precio / cantidad` (`:1155-1159,1249-1253`), `item_total = precio_unit × cantidad`.
4. **Herencia con distribución** (`obtenerListaOrdenesImportar`, `:623-691`): sin distribución trae detalle íntegro; con distribución filtra `JOIN distribucionordencompra WHERE local_id` y reprorratea `precio = round(precioOriginal / cantidad × cantidadLocal)` (`:687` + `getRoundPriceFinanzas`), `cantidad = cantidadLocal` (`:690`). Luego descuenta lo ya canjeado en guías (`:927-932`) y compras (`:945+`), promediando ponderado `round(total/cantidad,4)` (`:888-895`).
5. **Impuestos solo al leer** (`armarDetalleObtener`, `:1168-1292`): si `precioincluyeimpuestos!=SI && calcularImpuestos==1`, `total = total×(1+(igv+isc+otros)/100)` con `%` de `ImpuestocompraLogistica` (override `ordencompra_porcentajeimpuestos`); afecto falso si `productogeneral_inafecto/exonerado` o `insumo_afectoigv!=SI`. Versión `2` si impuestos dinámicos (`:279-281`).
6. **Tipo de cambio:** `tipocambio = moneda_tipocambio_compra`; informes suman `total × COALESCE(tipocambio,1)` (`OrdencompraLogisticaDB.php:375`).

## 6. Replicación bot (matriz mínima)

OC-0 manual (insumo, 50@20 → `precio=1000`, `sinImp=NULL`, `total=1000`, sin Kardex) · OC-consumible (mismo payload, flag en maestro; Kardex recién en Compra espejo) · OC-producto reventa (presentación compra, verificar ×/÷) · OC-distribuida manual (2 locales, Σ=cantidad) · OC desde solicitud (último precio, `CANJEADO`, distribución) · Negativas: costo no numérico, referencia duplicada, anular canjeada por compra/guía, editar aprobada · Auditoría `assertDetalleOC` tras cada alta.

## 8. Mapa de sub-flujos (documentos hermanos en esta carpeta)

| Doc | Cubre | Relación clave |
|---|---|---|
| `orden-compra-editar.md` | `POST actualizarOrdencompra`, bloqueos, recálculo, distribución upsert/delete | Lo editado es lo que heredan Guía/Compra; convive con vínculos sin romperlos |
| `orden-compra-aprobar-evaluar.md` | aprobar/rechazar, evaluación manual/auto (config 71) | Aprobar desbloquea importar; evaluar es semáforo previo |
| `orden-compra-importar.md` | OC→Guía/Compra: prorrateo, descuento de canjeado, estados resultantes | Consumidor de todo; escribe los vínculos que bloquean anular |
| `orden-compra-anular.md` | Anulación + secuencia hijo→OC con `devolverStock` | Inverso de importar; `ANULADA` terminal |
| `orden-compra-plantillas-masiva.md` | Plantillas 1x1 y carga masiva (validación por fila) | Precargan el mismo `registrar`; cada OC resultante entra al ciclo normal |

## 7. Dudas abiertas para el Arquitecto (precisadas)

### Duda 1 — ACL en `registrarOrdencompra`: qué es ACL, de dónde sale y qué implica que el bot no loguee
**ACL = Access Control List del ERP.** Cada acción está amparada por un permiso fila en `permisologistica` (ej. `REGISTRAR_ORDEN_COMPRA_LOGISTICA='6'`, `ANULAR...='8'`, `APROBAR_RECHAZAR...='91'`, `PERMITIR_EVALUAR...='121'`, `api/definitions.php:2800+`). La comprobación es `Permisologistica::rolTienePermisoActivo(rol, permiso)` (`api/entity/Permisologistica.php:38-56`): busca en **BD, tabla `rolpermisologistica`**, una fila con ese `rollogistica_id + permisologistica_id + estado=ACTIVO`; si existe → `true`, si no → `false` → literal `"No tienes permisos..."`.
¿De dónde sale el rol? **De la sesión PHP del login manual, no de un config del bot.** `Security::getRolUsuarioLogistica()` (`api/core/Security.php:1434-1448`) lee `$_SESSION["usuario_rol_logistica"`] (seteado al iniciar sesión; fallback por token vía `Tokenusuario`/`usuario.rollogistica_id`, `Usuario.php:371`, `UsuarioEntity:rollogistica_id`). El bot no loguea: se adosa por CDP al Chrome donde tú ya iniciaste sesión (`connectOverCDP`, `obtenerPaginaApp` reutiliza la pestaña), así que **cada `page.evaluate`/`waitForResponse` viaja con tu cookie de sesión y hereda tu rol**. Con tu usuario admin (todos los permisos), todos los gates con ACL pasan naturalmente — el permiso **sí sale de la BD en cada llamada**, pero evaluado contra tu sesión.
Consecuencia práctica: el bot **no puede probar denegaciones con tu sesión actual**; para una negativa ACL habría que iniciar sesión con un rol restringido (sin la fila en `rolpermisologistica`) y repetir la acción. Y el hallazgo se mantiene: `registrarOrdencompra` (`OrdencompraLogisticaController.php:512-599`) **no contiene ningún gate** mientras sus vecinos (anular `:219,910`, aprobar/rechazar `:724,773`, evaluar `:616`, calculadora `:1044`) sí — con tu admin esto es invisible (todo pasa), pero con un rol restringido la OC se crearía igual mientras las demás acciones se denegarían.
Pregunta precisa al Arquitecto: ¿esa ausencia es **olvido** (agregar el gate de una línea) o **diseño** (registro abierto)? Si es olvido, la prueba de denegación requiere sesión restringida; si es diseño, se documenta "registro abierto" y no se prueba ACL aquí.

### Duda 2 — Recetas en la OC: confirmación de tu lógica + dónde está el filtro
Confirmo tu lógica: **el bot no debe forzar recetas en la OC porque el flujo natural las excluye en el buscador, no en el backend.** El buscador de la OC (`busquedaParaCompras`, `nueva.orden.compra.controller.js:403-426`) llama a `busquedaSensitivaSegunTipos` con `args[1]=SI` (esInsumo) y deja `args[2]=NO` (**esReceta apagado**); activa porcionable/descartable/consumible/derivados/activos (`args[3,4,8,11,15,18]`). Idéntico en editar (`editar.orden.compra.controller.js:230-266`), lista (`lista.orden.compra.controller.js:1637-1650`) y carga masiva (`editor.carga.masiva.controller.js:320-335`). O sea: una receta (`recetabase=1`) **ni siquiera aparece como opción** en la UI.
Pero atención: en el backend **no encontré un hard-stop** que rechace `recetabase=1` si llegara por API directa (el validator valida cantidad/costo/referencia/solicitud, y el parser solo bifurca `presentacioninsumo_id` vs `producto_id`). Como la receta también es fila de `insumo`, un POST forzado probablemente persistiría como insumo común. Decisión registrada: el bot **no forzará ese flujo** (respeta el buscador). Gracias a este análisis queda documentado que el backend no tiene esa restricción — si el Arquitecto quiere blindaje, se pide validator, no test antinatural.

### Duda 3 — Resuelta por simulación en código (ambos flujos quedan obligatorios como validación)
Acepto el reto: tracé la cadena completa y la respuesta **sí sale del código**. La duda era si el flag `precioincluyeimpuestos` de la OC cambia la base sobre la que después se prorratea y desgrava. Resultado de la simulación: **no cambia la base; ambos flujos convergen al mismo importe guardado**. El flag solo cambia qué celda digita el usuario; el redondeo de esa derivación (céntimos) es lo único que los dos flujos deben validar.

Cadena simulada (misma compra real: 30u, S/11.80 bruto = S/10.00 neto, IGV 18 %, reparto Piura 10u / Chiclayo 20u):
1. **Grilla OC → payload** (`ordencompra.js:696-706`): con flag `SI`, `costo=precio=item_precio` (el digitado, 11.80 = bruto) y `preciosinimpuestos=item_precioSinImpuestos` (10.00). Con flag `NO`, `costo=precio=item_precioConImpuestos` (el bruto derivado, 11.80) y `preciosinimpuestos=item_precio` (el digitado neto, 10.00). En ambos casos `costo/precio` unitario = **bruto** y `preciosinimpuestos` = **neto**.
2. **Guardado** (`OrdencompraLogistica.php:552-554`): `precio = costo × cantidad = 11.80×30 = 354.00` en ambos flujos. Idéntico.
3. **Prorrateo Chiclayo** (`:687`): `round(354/30×20) = 236.00`, `cantidad = 20`. Idéntico (el redondeo financiero a 2 decimales solo mordería con repartos no exactos).
4. **Compra hereda y desgrava** (`CompraLogistica.php:2254-2257` + `CalculoLogistica.php:124-146`, rama `calcularAPartirDelTotal=false`): el costo heredado se trata como **unitario bruto** (`costoUnitario = cant×valor/cant`), luego `sinImp = 11.80/1.18 = 10.00`, `importe = 11.80×20 = 236.00`. Idéntico.
5. Conclusión: `detallecompra_costo=11.80`, `costosinimpuestos=10.00`, `importe=236.00` en **ambos** flujos. Sobre `detalleordencompra_preciosinimpuestos`: `registrar()` hace `insert()` genérico (`DetalleordencompraLogistica.php:89`), así que persiste lo que el payload traiga — la UI envía el neto (`ordencompra.js:700,705`), pero el payload del bot (`manual-bot-rpa §3.3`) **no envía el campo** → NULL (por eso `assertDetalleOC` exige NULL y pasa). El oráculo queda: NULL para OC creadas por bot, neto para OC creadas por UI.
Riesgo residual que justifica correr los dos flujos: la derivación bruta desde neto (`neto×1.18` en grilla, flag NO) vs. el bruto digitado (flag SI) puede diferir en S/0.01 con precios de 3+ decimales; el redondeo intermedio del prorrateo (`getRoundPriceFinanzas`) amplifica lo mismo en repartos no exactos. Los dos flujos quedan como validación obligatoria de esa convergencia, no como incógnita abierta. (Inferencia marcada: la derivación `item_precioConImpuestos = neto×1.18` se deduce de la simetría del mapeo `:696-706`; la corrida la confirma.)
