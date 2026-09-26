-- =====================================================================
-- limpieza_bd.sql — Limpieza del entorno para el bot E2E (insumos → compras → guías → kardex)
-- Generado a partir del modelo real C:\xampp\htdocs\restaurant.sql (535 tablas, 414 con FK).
--
-- CÓMO USAR: lo ejecuta src/db.ts (limpiarBaseDatos) statement por statement.
-- No ejecutar a mano en producción: borra datos transaccionales.
--
-- DECISIONES DE DISEÑO (ver BLUEPRINT §6):
--  1. SET FOREIGN_KEY_CHECKS = 0/1 envolviendo todo. Es OBLIGATORIO, no opcional:
--     el grafo tiene CICLOS reales (insumo ↔ producto ↔ productogeneral,
--     más auto-referencias en insumo, producto y movimientoalmaceninsumo),
--     así que ningún orden topológico puro es posible (Kahn deja 66 tablas
--     en ciclo). El orden hijos-primero se mantiene igual por higiene,
--     locks y velocidad, pero la seguridad la da el FK_CHECKS.
--  2. Deduplicado: la lista original traía ~15 sentencias repetidas
--     (detalleguia x3, detallleprocesostock x3, impuestocompracategoria x3,
--     impuestodetallecompra x3, detalleavancecompra x2, productogeneralmodificador x2,
--     categorialocal x2, etc.). Aquí cada tabla aparece UNA vez.
--  3. WHERE con PK en todas (la lista original dejaba 4 DELETE sin WHERE:
--     detalleplantillacuadre, detalleplantillaordenproduccion, destacadoporalmacen,
--     detallenotacreditocompra). Funcionalmente igual con FK_CHECKS=0, pero el
--     WHERE documenta la PK y evita wipes accidentales si se reutiliza el archivo.
--  4. CABECERAS agregadas (la lista original solo borraba DETALLES): sin borrar
--     `compra`, `guia` y `notacreditocompra` quedan comprobantes residuales que
--     disparan `existeCompra/existeGuia` ("el numero de documento ya existe")
--     y movimientos huérfanos en Kardex. Van DESPUÉS de sus detalles.
--  5. MAESTROS EXCLUIDOS: la lista original borraba `categoria`, `productogeneral`,
--     `caracteristica`, `categoriainsumo (!=1)`, etc. Eso destruye el catálogo que
--     la app necesita (unidades, categorías, modificadores). El bot NO los toca.
--     Si algún día hace falta, está el BLOQUE B (comentado) con filtro por nombre
--     de prueba en vez de wipe total.
--  6. Self-referencias (insumo_derivadoinsumoid, producto padre, movimiento padre):
--     con FK_CHECKS=0 no hace falta nulificar; se dejan los UPDATE originales
--     como cinturón extra antes de borrar insumo/movimiento.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- FASE 1: Detalles transaccionales del flujo (hijos primero)
-- ---------------------------------------------------------------------
DELETE FROM detallenotacreditoimpuesto WHERE detallenotacreditoimpuesto_id > 0;
DELETE FROM detallenotacredito WHERE detallenotacredito_id > 0;
DELETE FROM detalleventaimpuesto WHERE detalleventaimpuesto_id > 0;
DELETE FROM detalleventa WHERE detalleventa_id > 0;
DELETE FROM impuestodetallecompra WHERE impuestodetallecompra_id > 0;
DELETE FROM detallecompra WHERE detallecompra_id > 0;
DELETE FROM detallenotacreditocompra WHERE detallenotacreditocompra_id > 0;
DELETE FROM detalleguia WHERE detalleguia_id > 0;
DELETE FROM detalleordencompra WHERE detalleordencompra_id > 0;
DELETE FROM detallerequerimientocompra WHERE detallerequerimientocompra_id > 0;
DELETE FROM detalleavancecompra WHERE detalleavancecompra_id > 0;
DELETE FROM detalledespachorequerimiento WHERE detalledespachorequerimiento_id > 0;
DELETE FROM despachorequerimientomovimiento WHERE despachorequerimientomovimiento_id > 0;
DELETE FROM detallerequerimiento WHERE detallerequerimiento_id > 0;
DELETE FROM detallearqueoinventario WHERE detallearqueoinventario_id > 0;
DELETE FROM detallecuadremanual WHERE detallecuadremanual_id > 0;
DELETE FROM detalleplantillaarqueoinventario WHERE detalleplantillaarqueoinventario_id > 0;
DELETE FROM detalleplantillacuadre WHERE detalleplantillacuadre_id > 0;
DELETE FROM detalleplantillaordenproduccion WHERE detalleplantillaordenproduccion_id > 0;
DELETE FROM detalleplantillarequerimiento WHERE detalleplantillarequerimiento_id > 0;
DELETE FROM detallemerma WHERE detallemerma_id > 0;
DELETE FROM detallemovimiento WHERE detallemovimiento_id > 0;
DELETE FROM detalleavancemovimiento WHERE detalleavancemovimiento_id > 0;
DELETE FROM detallesolitudmovimiento WHERE detallesolitudmovimiento_id > 0;
DELETE FROM detalleguiaremision WHERE detalleguiaremision_id > 0;
DELETE FROM detalleordenguiaremision WHERE detalleordenguiaremision_id > 0;
DELETE FROM detallereservastock WHERE detallereservastock_id > 0;
DELETE FROM detalleordenproduccion WHERE detalleordenproduccion_id > 0;
DELETE FROM detallepreparacionreceta WHERE detallepreparacionreceta_id > 0;
DELETE FROM detalleresultantepreparacionreceta WHERE detalleresultantepreparacionreceta_id > 0;
DELETE FROM detallleprocesostock WHERE detallleprocesostock_id > 0;
DELETE FROM distribucionordencompra WHERE distribucionordencompra_id > 0;
DELETE FROM previsualizacion WHERE previsualizacion_id > 0;
DELETE FROM entradamovimientoinsumoproducto WHERE entradamovimientoinsumoproducto_id > 0;
DELETE FROM descartablepresentacionresultantereceta WHERE descartablepresentacionresultantereceta_id > 0;
DELETE FROM historicoreceta WHERE historicoreceta_id > 0;
DELETE FROM presentacionresultantereceta WHERE presentacionresultantereceta_id > 0;
DELETE FROM preparacionreceta WHERE preparacionreceta_id > 0;
DELETE FROM insumoequivalencia WHERE insumoequivalencia_id > 0;
DELETE FROM insumodescartable WHERE insumodescartable_id > 0;
DELETE FROM insumoproducto WHERE insumoproducto_id > 0;
DELETE FROM impuestocompraproductogeneralinsumo WHERE impuestocompraproductogeneralinsumo_id > 0;
DELETE FROM ventainsumolocal WHERE ventainsumolocal_id > 0;
DELETE FROM seleccioninsumo WHERE seleccioninsumo_id > 0;
DELETE FROM receta WHERE receta_id > 0;
DELETE FROM menudeldia WHERE menudeldia_id > 0;
DELETE FROM oferta WHERE oferta_id > 0;
DELETE FROM preciolocalproductomoneda WHERE preciolocalproductomoneda_id > 0;
DELETE FROM preciolocalproducto WHERE preciolocalproducto_id > 0;
DELETE FROM logmodificacionproducto WHERE logmodificacionproducto_id > 0;
DELETE FROM productointegracion WHERE productointegracion_id > 0;
DELETE FROM metaporperiodoproducto WHERE metaporperiodoproducto_id > 0;
DELETE FROM programaciondiasmenu WHERE programaciondiasmenu_id > 0;
DELETE FROM promocionsorteoproducto WHERE promocionsorteoproducto_id > 0;
DELETE FROM productofase WHERE productofase_id > 0;
DELETE FROM productocombo WHERE productocombo_id > 0;
DELETE FROM adicionalcombo WHERE adicionalcombo_id > 0;
DELETE FROM alternativacombo WHERE alternativacombo_id > 0;
DELETE FROM impuestocompracategoria WHERE impuestocompracategoria_id > 0;
DELETE FROM destacadoporalmacen WHERE destacadoporalmacen_id > 0;
DELETE FROM stockminimoalmacen WHERE stockminimoalmacen_id > 0;
DELETE FROM almacenproductoinsumo WHERE almacenproductoinsumo_id > 0;
DELETE FROM caracteristicaproducto WHERE caracteristicaproducto_id > 0;
DELETE FROM detallecaracteristicagrupo WHERE detallecaracteristicagrupo_id > 0;
DELETE FROM caracteristicadefault WHERE caracteristicadefault_id > 0;

-- ---------------------------------------------------------------------
-- FASE 2: Movimientos de Kardex (después de todos los detalles que los originan)
-- ---------------------------------------------------------------------
UPDATE movimientoalmaceninsumo SET movimientoalmaceninsumo_loteid = NULL WHERE movimientoalmaceninsumo_id > 0;
DELETE FROM movimientoalmaceninsumo WHERE movimientoalmaceninsumo_id > 0;

-- ---------------------------------------------------------------------
-- FASE 3: Cabeceras del flujo (después de sus detalles)
-- ---------------------------------------------------------------------
DELETE FROM notacreditocompra WHERE notacreditocompra_id > 0;
DELETE FROM guia WHERE guia_id > 0;
DELETE FROM compra WHERE compra_id > 0;

-- ---------------------------------------------------------------------
-- FASE 4: Presentaciones y maestros creados por el bot (padres al final)
-- ---------------------------------------------------------------------
DELETE FROM presentacioncompraproducto WHERE presentacioncompraproducto_id > 0;
DELETE FROM presentacioninsumo WHERE presentacioninsumo_id > 0;
UPDATE insumo SET insumo_derivadoinsumoid = NULL WHERE insumo_id > 0;
DELETE FROM insumo WHERE insumo_id > 0;
DELETE FROM producto WHERE producto_id > 0;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- BLOQUE B (COMENTADO — solo si el entorno de pruebas lo exige):
-- Maestros de catálogo. NO borrar a ciegas: la app los necesita para operar.
-- Si el bot crea categorías de prueba, borrar SOLO esas por nombre:
--   DELETE FROM categoriainsumo WHERE categoriainsumo_id != 1 AND categoriainsumo_descripcion LIKE 'TEST%';
--   DELETE FROM categoria WHERE categoria_descripcion LIKE 'TEST%';
--   DELETE FROM productogeneral WHERE productogeneral_descripcion LIKE 'TEST%';
-- Nunca: DELETE FROM categoria / productogeneral / caracteristica sin filtro.
-- =====================================================================
