# Compras — Lecturas (catálogo de endpoints de apoyo al bot)

> Solo lectura (salvo imagen). Cada una con uso bot asignado: **oráculo** (assert), **setup** (arma casos), **precarga** (precarga payloads).

| Endpoint | Responde | Uso bot |
|---|---|---|
| `GET obtenerCompra/{id}[/{paraEdicion}]` (`:25-26` → `Controller:656-814`) | `{compra, productos[]}` con proveedor/local/moneda, impuestos (`impuestoList/dinamicos/ByDetalle`), cuotas+totales (crédito), OCs/guías vinculadas, NCs+devueltos, retenciones, último precio+variación por ítem; `paraEdicion=1` pone `precio=sinImp` si precio-neto | Oráculo + precarga (snapshot para validar agregar/actualizar, clonar) |
| `GET obtenerListaDeCompras/Cabecera/{params b64}` (`:34-35`) | filas + `totalregistros` (proveedor/moneda/local/usuario, cuotas+`creditopagado`, NCs, `conguia/docvinculado`); cabecera con consolidados (subtotal, impuestos, promedio, NCs) | Setup (localizar id por serie/proveedor/fecha) + oráculo de totales |
| `GET obtenerDataListCompraByTipo/{grafico}/{params}` (`:36`) | agregado `totalCompra/promedio/cant/notas` (con caché) | Oráculo de volumen sin paginar |
| `GET obtenerResumenCompraByLocal/{local}` / `POST obtenerResumenDeComprasByLocalFecha` (`:85-86`) | OCs/guías pendientes de canjear, recomendaciones; top insumos/proveedores, últimas, pendiente-declarar | Setup (descubrir canjeables + contexto) |
| `GET descartarRecomendacion[es]...` (`:97-98`) | `{bool}` | Setup/teardown (dashboard idempotente) |
| `GET obtenerUltimaCompraPorProveedor/{prov}` (`:38`) | última compra o null | Precarga (moneda/local/tipodoc del proveedor) |
| `GET obtenerUltimoPrecioCompraPorInsumoProducto/{tipo}/{id}/{local}/{moneda}` + `POST ByItemList` (`:48-49`) | `{ultimoPrecio, ultimoPrecioSinImp, documento, compra_id, porcImpuestos}` (`ORDER BY fecha DESC`, fallback todos-locales/monedas → `precioaprox/costo/promedio`); variación `=(actual−orig)/actual×100` (`Detallecompra:1428-1446`, en `obtenerDetallesCompra:3234`) | Oráculo + precarga (precio esperado, sobreprecio) |
| `GET obtenerHistoricoById/{id}/{hist}` (`:41`) | snapshot + `historicocambio` con mensajes (`HistorialCompra`) | Oráculo (quién/cuándo cambió) |
| `GET obtenerComparativo/{id}` (`:135` → `:3662-3821`) | `{compra, itemList[{item1, item2List, faltante/sobrante}]}` emparejando por item/tipo/presentación/almacén | Oráculo (canje OC/guía→compra) |
| `POST subirImagenCompra` (multipart) (`:63`) | `{rutaArchivo}` (`products/<md5>`) | Setup (sustento referenciable) |

Regla: toda lectura con `parametros` exige JSON-base64 con `locales + fecha_inicio/fin` (validator `:743-903`); listas devuelven paginado (`pagina/registros`).
