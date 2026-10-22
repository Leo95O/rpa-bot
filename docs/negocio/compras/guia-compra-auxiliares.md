# Guía de Compra — Endpoints Auxiliares (remisión, histórico, comparativo, última guía)

> Cierra el 16/16 de `rest/guiacompra/index.php`. Los 4 son de lectura/vínculo, sin movimiento de Kardex. Evidencia: `GuiaLogisticaController.php` + `GuiaLogistica.php`.

## 1. `POST obtenerGuiaRemisionAImportar` (vínculo con GRE)

`index.php:34` → `Controller:644-677`: recibe lista de guías de remisión (electrónicas/SUNAT) y devuelve `{guia:{local, transportista_id}, productos[]}` vía `GuiaremisionLogistica::obtenerListaGuiaremisionImportarV2(lista, SI)`. Exige acceso al local (`Usuariolocal::getUsuarioLocalPorLocalUsuario` o flag todos-locales) o `"El usuario no cuenta con permisos para acceder al local."` (`:654-658`). Al guardar, la guía-compra enlaza remisiones (`actualizarGuiasRemision`, `GuiaLogistica.php:321`; al anular las libera: `guia_id=null, estado=ACTIVA`, `:629-631`). Uso bot: precarga documental, no matemática; verificar `transportista_id/local` heredados. Nota: la GRE electrónica real vive en otro módulo (`guiaremision`, blueprint §5: nada que mockear en este flujo).

## 2. `GET obtenerHistoricoById/{guia_id}/{idHistorico}` (auditoría)

`index.php:35` → `Controller:825-851`: busca en `historicocambio` (`afecta=HISTORICOCAMBIO_GUIACOMPRA, idafecta=guia_id, id=idHistorico`); vacío → `"Error al obtener la información."`; si existe, `GuiaLogistica::procesarObjetoHistorico + HistorialGuia::obtenerMensajesDeCambiosGuia` (lista legible de qué cambió). Uso bot: tras `actualizarGuia`, verificar que el histórico registró el cambio (rastro de M1). Sin Kardex asociado.

## 3. `GET obtenerComparativo/{guia_id}` (guía vs compra, oráculo de saldos)

`index.php:36` → `Controller:854-894`: carga la guía y, si tiene `compra_id`, carga la compra y devuelve `itemList = Utility::obtenerComparativoItemList(productosGuia, productosCompra)` + ambas cabeceras. Sin compra vinculada → `"La orden seleccionada no tiene compra o guia vinculada con que comparar."`; id inválido → `"El identificador enviado no es valido."` Uso bot: **oráculo de coherencia guía↔compra** (cantidades/costos recibidos vs facturados por ítem) sin SQL manual. Relación: es el espejo del comparativo de OC y de compra (`OrdencompraLogisticaController:1275`, `CompraLogisticaController:3662`).

## 4. `GET obtenerUltimaGuiaPorProveedor/{proveedor_id}` (folio sugerido)

`index.php:27` → `Controller:17-30`: `GuiaLogistica::obtenerUltimasGuiasPorProveedorIdArray(prov, TODOS, ACTIVO, 1, 1)`; devuelve la última o `PARAM_TODOS` si no hay. Uso bot: apoyo a la unicidad serie/número (el bot usa `numero-Date.now()`; este endpoint sirve para verificar correlativo o detectar colisiones en depuración). Sin validaciones ni Kardex.

## 5. Verificaciones bot (tabla)

| # | Acción | Aserción |
|---|---|---|
| X1 | Importar remisión válida / de otro local | productos+local heredados / literal de permiso de local |
| X2 | Tras modificar guía, `obtenerHistoricoById` | rastro con mensajes de cambio (no `"Error al obtener..."`) |
| X3 | `obtenerComparativo` con y sin compra | `itemList` coherente / literal sin-vínculo |
| X4 | `obtenerUltimaGuiaPorProveedor` | última guía del proveedor o vacío (apoyo a folio único) |
