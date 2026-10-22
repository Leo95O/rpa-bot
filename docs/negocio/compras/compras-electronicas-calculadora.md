# Compras Electrónicas e Importación (DTE / OCR / XML) + Calculadora de Stock

> Precargan payloads, no persisten compras (salvo auto-crear proveedor). Blueprint §5: en este flujo nada que mockear de SUNAT/OSE.

## 1. DTE Chile (`estadoBusquedaDteSimplefactura` + `obtenerCompraDesdeDteSimplefactura`)

`GET estadoBusquedaDteSimplefactura/{local}` (`:79` → `Controller:4260-4280`): gate `Simplefactura::integracionActivaIa` + credenciales → `{activo, modo}` (mostrar/ocultar botón, sin literales). `POST obtenerCompraDesdeDteSimplefactura {local_id, rutEmisor, codigoTipoDte, folio, crearProveedor=NO}` (`:80` → `:4293-4466`): valida campos + integración + acceso al local, consulta `Simplefactura::consultarDocumentoDteIa`, mapea a shape compra (`compra_seriedoc="0000"` — DTE sin serie, `nrodoc=folio`, `tipodoc=FACTURA/NC/ND`, `dteResumen{neto,exento,iva,total,líneas,proveedorNuevo,compraExistente}` con anti-duplicado `verificarSiExisteCompraRegistrada`). Con `crearProveedor=SI` inserta/reactiva proveedor; con `NO` y proveedor inexistente vacía la razón social. Literales: local/RUT/tipo/folio requeridos, integración inactiva/sin credenciales/inválidas, sin conexión, rate-limit, DTE inexistente/no interpretable, ya registrado (`"...como compra (código X del Y)"`), sin líneas (solo cabecera).

## 2. OCR (`POST obtenerCompraAImportarOCR {url_imagen,...}`)

`:137` → `Controller:3833-3913`: exige imagen → `Utility::obtenerCompraDesdeCHATGP` (`{proveedor_documento, detalle[{descripcion,cantidad,precio}]}`) → exige documento+detalle → matcheo por `busquedaSensitivaLogistica` con recorte hasta 40 % (`CompraLogistica:4330,4371-4377`); no hallados → `no_encontrados`. Responde `{compra{moneda,proveedor,local,esalcredito=NO,fecha+hora}, productos[], gpt}`. Si el proveedor no existe y hay documento+razón social, lo crea (`agregarProveedor`, `:4292-4303`). Literales: `"Imagen requerida"`, `"Identificador de proveedor es requerido"`, `"No se envio detalle..."`, `"No se encontro proveedor"`.

## 3. XML Costa Rica + DIAN (`POST procesarXMLByImportacionCompra {ruta, local_id?, datosXML?}`)

`:146` → `Controller:4089-4252`: exige `ruta` (`"Url no encontrada"`). Rama DIAN (`:4098-4179`, modelo `:5808-6093`): acepta XML UBL/`AttachedDocument` y ZIP (`"PK"`); ACUSE → `"...no hay nada que importar"`; NC/ND → no se importa como compra; factura → `procesarDatosDianIa` (NIT, líneas netas, `crearProveedor` default SI) + `datosDian{cufe,emisor,total}`. Rama CR (`:4181-4240`, `simplexml`, `:4557-4658/4660+`): Clave/Consecutivo/Emisor/Receptor/Resumen/Detalle; proveedor por identificación→nombre (auto-crea); ítems por código SUNAT luego descripción (`calcularMontosConImpuestosXML`); serie/nro = mitades del consecutivo (20 chars). Responde `{compra{...FACTURA}, productos[], productos_error}` + crudo; éxitos `"XML (DIAN) Procesado con exito"`. Único write: proveedor.

## 4. Calculadora stock → OCs (`POST ordencompra/generarOrdencompraCalculadoraStock`, `POST .../obtenerListaProveedoresPorInsumosCaluladoraStock`)

`rest/compra:118-119` → `OrdencompraLogisticaController:940-1272`. Paso 1 (agrupar, sin persistir): `{insumos[{insumo/producto, faltante}], local, almacen, [ids origen]}` → `{array_proveedor, array_sin_proveedor, local...}` (proveedor por `insumo.proveedor_id` / `productogeneral.proveedor_id`). Paso 2 (generar): `{array_proveedor, redondearCantidades=SI, [ids origen]}` con gates local-producción (`"Debes ser local de produccion..."`), permiso `REGISTRAR_ORDEN_COMPRA`, origen no pendiente (`"...requermiento/orden... pendiente."`), no duplicada (`"...ya tiene una o mas ordenes..."`): **una OC por proveedor** (`obs "Generada por cálculo de producción "`, `total 0`, `+1 week`), detalle solo `faltante>0` con merma `cant/(1−merma%)`, presentación estándar, `ceil()` (exacta si `redondear=NO`), precio `obtenerUltimoPrecioCompraV2×cant`, afecto según inafecto/exonerado; `update total` si >0.

## 5. Bot

Electrónicas: precarga válida/inválida (literales por campo), duplicado (`compraExistente` / `"ya fue registrado"`), proveedor auto-creado o vaciado, líneas no halladas → `productos_error`/`no_encontrados`; **nunca asertar Kardex aquí** (no persiste). Nunca mockear: son consultas reales a terceros solo si la integración está activa (locales PE sin credenciales → gate inactivo). Calculadora: agrupación por proveedor, gates (producción/permiso/pendiente/duplicado), una OC por proveedor con merma+`ceil`+último precio; verificar `obs` prefijo y totales.
