-- =====================================================================
-- seed_compras.sql — Estado inicial para el bot E2E de Compras
-- Idempotente. Verificado contra logisticaaa (2026-10-20).
-- USO: C:\xampp\mysql\bin\mysql.exe -u root logisticaaa < data/seed_compras.sql
-- OJO: los flags char(1) se escriben como '1'/'0' (SI/NO del ERP: definitions.php:42-43).
--       Escribir 'SI'/'NO' los trunca a 'S'/'N' y el backend los lee como NO (p.ej. producto_controlstock).
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. LOCAL 1 (CD Logístico) — NO recrear; solo asegurar nombre de la suite
-- ---------------------------------------------------------------------
INSERT INTO local (local_id, razonsocial_id, local_monedaestandarid, local_descripcion, local_direccion, local_telefono, local_encargado, local_estado)
VALUES (1, 1, 1, 'CD Logístico', 'Calle 2 N° 136 Urb. La Calerita- Surquillo- Lima', '-', '-', '1')
ON DUPLICATE KEY UPDATE local_descripcion = 'CD Logístico', local_esproduccion = '1';

INSERT INTO local (local_id, razonsocial_id, local_monedaestandarid, local_descripcion, local_direccion, local_telefono, local_encargado, local_estado)
VALUES (2, 1, 1, 'Lima', 'Av. Lima 200', '-', '-', '1')
ON DUPLICATE KEY UPDATE local_descripcion = 'Lima';

-- Local 1 = productivo (requerido por F14 calculadora).
UPDATE local SET local_esproduccion = '1' WHERE local_id = 1;

-- ---------------------------------------------------------------------
-- 2. ALMACENES
-- ---------------------------------------------------------------------
INSERT INTO almacen (almacen_id, local_id, almacen_descripcion, almacen_estado, almacen_controlstock, almacen_deabastecimiento, almacen_dedespacho)
VALUES (1, 1, 'Almacen Principal', '1', '1', '1', '1')
ON DUPLICATE KEY UPDATE almacen_descripcion = 'Almacen Principal', almacen_deabastecimiento = '1', almacen_dedespacho = '1';

INSERT INTO almacen (almacen_id, local_id, almacen_descripcion, almacen_estado, almacen_controlstock, almacen_deabastecimiento, almacen_dedespacho)
VALUES (18, 1, 'Producción', '1', '1', '0', '0')
ON DUPLICATE KEY UPDATE almacen_descripcion = 'Producción', almacen_deabastecimiento = '0', almacen_dedespacho = '0';

-- ---------------------------------------------------------------------
-- 3. UNIDADES DE MEDIDA
-- ---------------------------------------------------------------------
INSERT INTO unidadmedidainsumo (unidadmedidainsumo_id, unidadmedidainsumo_descripcion, unidadmedidainsumo_sigla, unidadmedidainsumo_tipo, unidadmedidainsumo_estado)
VALUES (1, 'Kilogramo', 'KG', 'PESO', 1)
ON DUPLICATE KEY UPDATE unidadmedidainsumo_descripcion = 'Kilogramo', unidadmedidainsumo_sigla = 'KG';

INSERT INTO unidadmedidainsumo (unidadmedidainsumo_id, unidadmedidainsumo_descripcion, unidadmedidainsumo_sigla, unidadmedidainsumo_tipo, unidadmedidainsumo_estado)
VALUES (2, 'Unidad', 'UNIDAD', 'CONTEO', 1)
ON DUPLICATE KEY UPDATE unidadmedidainsumo_descripcion = 'Unidad', unidadmedidainsumo_sigla = 'UNIDAD';

-- ---------------------------------------------------------------------
-- 4. CATEGORÍA INSUMO
-- ---------------------------------------------------------------------
INSERT INTO categoriainsumo (categoriainsumo_id, categoriainsumo_descripcion, categoriainsumo_estado)
VALUES (1, 'Categoria uno', 1)
ON DUPLICATE KEY UPDATE categoriainsumo_descripcion = 'Categoria uno', categoriainsumo_estado = 1;

-- ---------------------------------------------------------------------
-- 5. MONEDAS
-- ---------------------------------------------------------------------
INSERT INTO moneda (moneda_id, moneda_descripcion, moneda_simbolo, moneda_tipocambio, moneda_tipocambio_compra, local_id, moneda_checksum)
VALUES (1, 'Soles', 'PEN', 1.0000, 1.0000, 1, '')
ON DUPLICATE KEY UPDATE moneda_descripcion = 'Soles', moneda_tipocambio_compra = 1.0000;

INSERT INTO moneda (moneda_id, moneda_descripcion, moneda_simbolo, moneda_tipocambio, moneda_tipocambio_compra, local_id, moneda_checksum)
VALUES (2, 'Dólares', 'USD', 3.8000, 3.8000, 1, '')
ON DUPLICATE KEY UPDATE moneda_descripcion = 'Dólares', moneda_tipocambio_compra = 3.8000;

-- ---------------------------------------------------------------------
-- 6. IGV
-- ---------------------------------------------------------------------
INSERT INTO igv (igv_id, igv_porcentajeigv, igv_nombre, igv_estado, igv_fiscalizado, local_id)
VALUES (1, 18.00, 'IGV 18%', '1', '1', 1)
ON DUPLICATE KEY UPDATE igv_porcentajeigv = 18.00, igv_fiscalizado = '1';

-- ---------------------------------------------------------------------
-- 7. PROVEEDORES
-- ---------------------------------------------------------------------
INSERT INTO proveedor (proveedor_id, proveedor_razonsocial, proveedor_ruc, proveedor_direccion, proveedor_direccion2, proveedor_telefono, proveedor_email, proveedor_contacto, proveedor_ncuentacorriente, proveedor_adiciones, proveedor_estado, proveedor_limitecredito)
VALUES (1, 'MAKRO QA', '20123456789', '-', '-', '-', '-', '-', '-', '-', '1', 10000)
ON DUPLICATE KEY UPDATE proveedor_razonsocial = 'MAKRO QA', proveedor_limitecredito = 10000;

INSERT INTO proveedor (proveedor_id, proveedor_razonsocial, proveedor_ruc, proveedor_direccion, proveedor_direccion2, proveedor_telefono, proveedor_email, proveedor_contacto, proveedor_ncuentacorriente, proveedor_adiciones, proveedor_estado)
VALUES (2, 'MAKRO-Dólares', '20987654321', '-', '-', '-', '-', '-', '-', '-', '1')
ON DUPLICATE KEY UPDATE proveedor_razonsocial = 'MAKRO-Dólares';

-- ---------------------------------------------------------------------
-- 8. CONFIGURACIONES (local 1) — todas OFF salvo 160 (default ON)
-- ---------------------------------------------------------------------
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (72, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (106, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (65, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (157, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (119, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (121, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (64, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (123, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (160, 1, '1', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='1';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (174, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (189, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (73, 1, '1', '3', '3') ON DUPLICATE KEY UPDATE configuracionlocal_valor='1', configuracionlocal_valoraux1='3', configuracionlocal_valoraux2='3';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (95, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (190, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (109, 1, '1', '100', NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='1', configuracionlocal_valoraux1='100';
INSERT INTO configuracionlocal (configuracion_id, local_id, configuracionlocal_valor, configuracionlocal_valoraux1, configuracionlocal_valoraux2) VALUES (115, 1, '0', NULL, NULL) ON DUPLICATE KEY UPDATE configuracionlocal_valor='0';

-- ---------------------------------------------------------------------
-- 9. LIMPIEZA DE TRANSACCIONALES + DUPLICADOS DE CONFIGURACION
-- ---------------------------------------------------------------------
-- Limpiar duplicados de configuracionlocal (mantener solo el primero por configuracion_id + local_id)
DELETE c1 FROM configuracionlocal c1 INNER JOIN configuracionlocal c2 WHERE c1.configuracionlocal_id > c2.configuracionlocal_id AND c1.configuracion_id = c2.configuracion_id AND c1.local_id = c2.local_id;
DELETE FROM detallecompra WHERE detallecompra_id > 0;
DELETE FROM compra WHERE compra_id > 0;
DELETE FROM detalleguia WHERE detalleguia_id > 0;
DELETE FROM guia WHERE guia_id > 0;
DELETE FROM detalleordencompra WHERE detalleordencompra_id > 0;
DELETE FROM ordencompra WHERE ordencompra_id > 0;
DELETE FROM detallerequerimientocompra WHERE detallerequerimientocompra_id > 0;
DELETE FROM requerimientocompra WHERE requerimientocompra_id > 0;
DELETE FROM notacreditocompra WHERE notacreditocompra_id > 0;
DELETE FROM detallenotacreditocompra WHERE detallenotacreditocompra_id > 0;
DELETE FROM movimientoalmaceninsumo WHERE movimientoalmaceninsumo_id > 0;
DELETE FROM movimientoalmacenconsumible WHERE movimientoalmacenconsumible_id > 0;
DELETE FROM almacenproductoinsumo WHERE almacenproductoinsumo_id > 0;
DELETE FROM presentacioninsumo WHERE presentacioninsumo_id > 0;
DELETE FROM presentacioncompraproducto WHERE presentacioncompraproducto_id > 0;
DELETE FROM almacenproductoinsumo WHERE producto_id >= 2000;
DELETE FROM insumo WHERE insumo_id > 0;
DELETE FROM producto WHERE producto_id >= 2000;
DELETE FROM insumoproducto WHERE insumoproducto_id > 0;
DELETE FROM distribucionordencompra WHERE distribucionordencompra_id > 0;
DELETE FROM ordenrequerimientocompra WHERE ordenrequerimientocompra_id > 0;
DELETE FROM comprasporpagar WHERE comprasporpagar_id > 0;
DELETE FROM detallecomprasporpagar WHERE detallecomprasporpagar_id > 0;
DELETE FROM egreso WHERE egreso_id > 0;
DELETE FROM ingreso WHERE ingreso_id > 0;
DELETE FROM merma WHERE merma_id > 0;
DELETE FROM detallemerma WHERE detallemerma_id > 0;
DELETE FROM detallecompramanual WHERE detallecompramanual_id > 0;
DELETE FROM avancecompra WHERE avancecompra_id > 0;
DELETE FROM detalleavancecompra WHERE detalleavancecompra_id > 0;
DELETE FROM detalleordenproduccion WHERE detalleordenproduccion_id > 0;
DELETE FROM ordenproduccion WHERE ordenproduccion_id > 0;
DELETE FROM requerimientomovimiento WHERE requerimientomovimiento_id > 0;
DELETE FROM detallesolitudmovimiento WHERE detallesolitudmovimiento_id > 0;
DELETE FROM solitudmovimiento WHERE solitudmovimiento_id > 0;
DELETE FROM cierrecaja WHERE cierrecaja_checksum LIKE 'QABOT-%';
DELETE FROM historicocambio WHERE historicocambio_id > 0;
DELETE FROM eventologistica WHERE eventologistica_id > 0;

-- ---------------------------------------------------------------------
-- 10. MAESTROS (6 altas + Carne QA que crea el Bloque 1)
-- ---------------------------------------------------------------------
-- Categoría mínima para productos
INSERT INTO categoria (categoria_id, local_id, categoria_descripcion, categoria_estado, categoria_checksum, categoria_escategoriaprincipalselfservice)
VALUES (1, 1, 'Categoría QA', '1', '', '1')
ON DUPLICATE KEY UPDATE categoria_descripcion = 'Categoría QA';

-- I1 Carne QA (afecto, KG)
-- NO se crea aquí: la da de alta el Bloque 1 (crearInsumo) para que el maestro
-- nazca limpio y sin duplicar el nombre. El Bloque 1 lo registra con control de
-- stock en Almacen Principal (1) y Produccion (18), igual que esta semilla.
-- INSERT INTO insumo (insumo_id, categoriainsumo_id, insumo_codigo, insumo_nombre, insumo_descripcion, unidadmedidainsumo_id, insumo_afectoigv, insumo_consumible, insumo_mermaporcentaje, insumo_mermaautomaticaalcomprar, insumo_estado)
-- VALUES (1001, 1, 'CAR-QA', 'Carne QA', 'Carne de res para pruebas', 1, '1', '0', 0, '0', '1')
-- ON DUPLICATE KEY UPDATE insumo_nombre = 'Carne QA';

-- I2 Verdura QA (exonerada, KG)
INSERT INTO insumo (insumo_id, categoriainsumo_id, insumo_codigo, insumo_nombre, insumo_descripcion, unidadmedidainsumo_id, insumo_afectoigv, insumo_consumible, insumo_mermaporcentaje, insumo_mermaautomaticaalcomprar, insumo_estado)
VALUES (1002, 1, 'VER-QA', 'Verdura QA', 'Verduras para pruebas', 1, '0', '0', 0, '0', '1')
ON DUPLICATE KEY UPDATE insumo_nombre = 'Verdura QA';

-- I3 Pollo QA (afecto, KG, merma 5%)
INSERT INTO insumo (insumo_id, categoriainsumo_id, insumo_codigo, insumo_nombre, insumo_descripcion, unidadmedidainsumo_id, insumo_afectoigv, insumo_consumible, insumo_mermaporcentaje, insumo_mermaautomaticaalcomprar, insumo_estado, proveedor_id)
VALUES (1003, 1, 'POL-QA', 'Pollo QA', 'Pollo entero para pruebas', 1, '1', '0', 5, '1', '1', 1)
ON DUPLICATE KEY UPDATE insumo_nombre = 'Pollo QA', insumo_mermaporcentaje = 5, insumo_mermaautomaticaalcomprar = '1', proveedor_id = 1;

-- I4 Arroz QA (afecto, KG)
INSERT INTO insumo (insumo_id, categoriainsumo_id, insumo_codigo, insumo_nombre, insumo_descripcion, unidadmedidainsumo_id, insumo_afectoigv, insumo_consumible, insumo_mermaporcentaje, insumo_mermaautomaticaalcomprar, insumo_estado)
VALUES (1004, 1, 'ARR-QA', 'Arroz QA', 'Arroz para pruebas', 1, '1', '0', 0, '0', '1')
ON DUPLICATE KEY UPDATE insumo_nombre = 'Arroz QA';

-- C1 Caja Empaque QA (consumible, UNIDAD)
INSERT INTO insumo (insumo_id, categoriainsumo_id, insumo_codigo, insumo_nombre, insumo_descripcion, unidadmedidainsumo_id, insumo_afectoigv, insumo_consumible, insumo_mermaporcentaje, insumo_mermaautomaticaalcomprar, insumo_estado)
VALUES (1005, 1, 'CAJ-QA', 'Caja Empaque QA', 'Cajas de empaque', 2, '1', '1', 0, '0', '1')
ON DUPLICATE KEY UPDATE insumo_nombre = 'Caja Empaque QA', insumo_consumible = '1';

-- P1 Gaseosa QA (producto, controlstock=1)
INSERT INTO producto (producto_id, categoria_id, producto_codigo, producto_descripcion, producto_descripcioncorta, producto_stockminimo, producto_unidadmedida, producto_costo, producto_utilidad, producto_precio, producto_urlimagen, producto_puntos, producto_comision, producto_descripcionplato, producto_presentacion, producto_cantidadum, um_id, producto_esbuffet, producto_esmenu, producto_ventaalpeso, producto_checksum, producto_controlstock, producto_estado)
VALUES (2001, 1, 'GAS-QA', 'Gaseosa QA', 'Gaseosa QA', 12, 'UNIDAD', 2, 50, 3, '', 0, 0, '', 'UNIDAD', 1, 2, 0, 0, 0, 'QASEED2001', '1', '1')
ON DUPLICATE KEY UPDATE producto_descripcion = 'Gaseosa QA', producto_controlstock = '1';

-- P2 Gaseosa Sin Control QA (producto, controlstock=0)
INSERT INTO producto (producto_id, categoria_id, producto_codigo, producto_descripcion, producto_descripcioncorta, producto_stockminimo, producto_unidadmedida, producto_costo, producto_utilidad, producto_precio, producto_urlimagen, producto_puntos, producto_comision, producto_descripcionplato, producto_presentacion, producto_cantidadum, um_id, producto_esbuffet, producto_esmenu, producto_ventaalpeso, producto_checksum, producto_controlstock, producto_estado)
VALUES (2002, 1, 'GAS2-QA', 'Gaseosa Sin Control QA', 'Gaseosa Sin Control QA', 12, 'UNIDAD', 2, 50, 3, '', 0, 0, '', 'UNIDAD', 1, 2, 0, 0, 0, 'QASEED2002', '0', '1')
ON DUPLICATE KEY UPDATE producto_descripcion = 'Gaseosa Sin Control QA', producto_controlstock = '0';

-- ---------------------------------------------------------------------
-- 11. PRESENTACIONES
-- ---------------------------------------------------------------------
-- Carne QA: lo crea el Bloque 1 (presentaciones y control de stock nacen con
-- el maestro, no con la semilla).
-- INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
-- VALUES (101, 1001, 1, 'Base', 1, 15, 40, '1', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Base', presentacioninsumo_cantidad = 1;
-- INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
-- VALUES (102, 1001, 1, 'Mayorista', 10, 15, 40, '0', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Mayorista', presentacioninsumo_cantidad = 10;
-- Verdura QA
INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
VALUES (103, 1002, 1, 'Base', 1, 3, 12, '1', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Base', presentacioninsumo_cantidad = 1;
-- Pollo QA
INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
VALUES (104, 1003, 1, 'Base', 1, 8, 25, '1', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Base', presentacioninsumo_cantidad = 1;
-- Arroz QA
INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
VALUES (105, 1004, 1, 'Base', 1, 2, 8, '1', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Base', presentacioninsumo_cantidad = 1;
INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
VALUES (106, 1004, 1, 'Saco', 50, 2, 8, '0', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Saco', presentacioninsumo_cantidad = 50;
-- Caja Empaque QA
INSERT INTO presentacioninsumo (presentacioninsumo_id, insumo_id, unidadmedidainsumo_id, presentacioninsumo_nombre, presentacioninsumo_cantidad, presentacioninsumo_preciominimo, presentacioninsumo_preciomaximo, presentacioninsumo_estandar, presentacioninsumo_estado)
VALUES (107, 1005, 2, 'Base', 1, 0.3, 1.0, '1', '1') ON DUPLICATE KEY UPDATE presentacioninsumo_nombre = 'Base', presentacioninsumo_cantidad = 1;
-- Gaseosa QA
INSERT INTO presentacioncompraproducto (presentacioncompraproducto_id, producto_id, unidadmedidainsumo_id, presentacioncompraproducto_nombre, presentacioncompraproducto_cantidad, presentacioncompraproducto_estado)
VALUES (201, 2001, 2, 'UNIDAD', 1, '1') ON DUPLICATE KEY UPDATE presentacioncompraproducto_nombre = 'UNIDAD', presentacioncompraproducto_cantidad = 1;
INSERT INTO presentacioncompraproducto (presentacioncompraproducto_id, producto_id, unidadmedidainsumo_id, presentacioncompraproducto_nombre, presentacioncompraproducto_cantidad, presentacioncompraproducto_estado)
VALUES (202, 2001, 2, 'Pack', 6, '1') ON DUPLICATE KEY UPDATE presentacioncompraproducto_nombre = 'Pack', presentacioncompraproducto_cantidad = 6;
-- Gaseosa Sin Control QA
INSERT INTO presentacioncompraproducto (presentacioncompraproducto_id, producto_id, unidadmedidainsumo_id, presentacioncompraproducto_nombre, presentacioncompraproducto_cantidad, presentacioncompraproducto_estado)
VALUES (203, 2002, 2, 'UNIDAD', 1, '1') ON DUPLICATE KEY UPDATE presentacioncompraproducto_nombre = 'UNIDAD', presentacioncompraproducto_cantidad = 1;

-- ---------------------------------------------------------------------
-- 12. CONTROL STOCK POR ALMACÉN
-- ---------------------------------------------------------------------
-- Control de stock por almacen. Carne QA (1001) NO aparece: su maestro lo
-- crea el Bloque 1, que lo registra con control en Almacen Principal (1) y
-- Produccion (18) (los Bloques 3-8 necesitan ambos almacenes).
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (3, 1, 1002, '1', 5, 300) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (4, 18, 1002, '1', 5, 300) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (5, 1, 1003, '1', 5, 300) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (6, 1, 1004, '1', 10, 1000) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (7, 18, 1004, '1', 10, 1000) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, insumo_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (8, 1, 1005, '1', 50, 5000) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';
INSERT INTO almacenproductoinsumo (almacenproductoinsumo_id, almacen_id, producto_id, almacenproductoinsumo_controlar, almacenproductoinsumo_stockminimo, almacenproductoinsumo_stockmaximo) VALUES (9, 1, 2001, '1', 12, 600) ON DUPLICATE KEY UPDATE almacenproductoinsumo_controlar = '1';

-- Restaurar FK checks al final (todos los inserts corrieron con FKs off)
SET FOREIGN_KEY_CHECKS = 1;

-- Verificación
SELECT '=== SEED COMPRAS ===' AS status;
SELECT COUNT(*) AS locales FROM local WHERE local_id IN (1, 2);
SELECT COUNT(*) AS almacenes FROM almacen WHERE almacen_id IN (1, 18);
SELECT COUNT(*) AS configs FROM configuracionlocal WHERE local_id = 1 AND configuracion_id IN (64,65,72,73,95,106,109,115,119,121,123,157,160,174,189,190);
SELECT COUNT(*) AS proveedores FROM proveedor WHERE proveedor_id IN (1, 2);
SELECT COUNT(*) AS igv FROM igv WHERE igv_fiscalizado = '1' AND local_id = 1;

