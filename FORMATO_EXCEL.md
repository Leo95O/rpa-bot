# Formato del Excel para el bot RPA

Este documento explica cómo debe estar estructurado el archivo `.xlsx` que lee el
bot (por defecto `data/Datos_Bot.xlsx`). El archivo contiene **dos hojas**:

| Hoja      | Propósito                                            |
|-----------|------------------------------------------------------|
| `INSUMOS` | Crear insumos (productos de compra) y su inventario. |
| `COMPRAS` | Registrar compras a proveedores.                     |

Ambas hojas usan el mismo patrón: la **primera fila es la cabecera** con los
nombres exactos de columna (en mayúsculas) y las filas siguientes se agrupan por
`ID_OPERACION` + `TIPO_FILA`.

> Importante: los nombres de las columnas deben escribirse **exactamente** como
> se indican (el parser los normaliza a mayúsculas, pero no tolera espacios ni
> nombres distintos).

---

## 1. Hoja `INSUMOS`

### Columnas (orden exacto)

| # | Columna             | Tipo    | Descripción                                                              |
|---|---------------------|---------|--------------------------------------------------------------------------|
| 1 | `TIPO_FILA`         | texto   | `CABECERA`, `PRESENTACION`, `INVENTARIO` o `EQUIVALENCIA`.               |
| 2 | `ID_OPERACION`      | texto   | Identificador único del insumo (agrupa todas sus filas).                 |
| 3 | `CODIGO`            | texto   | Código del insumo.                                                       |
| 4 | `CODIGO_INTERNO`    | texto   | Código interno alternativo.                                              |
| 5 | `NOMBRE`            | texto   | Nombre del insumo (obligatorio).                                         |
| 6 | `UNIDAD_MEDIDA`     | texto   | Unidad de medida base (ver [tabla de referencia](#unidades-de-medida)).  |
| 7 | `CATEGORIA`         | texto   | Categoría de insumo (ver [categorías](#categorías)).                     |
| 8 | `CLASIFICACION_ABC` | texto   | `A`, `B` o `C`.                                                          |
| 9 | `PROVEEDOR`         | texto   | Proveedor por defecto (ver [proveedores](#proveedores)). Opcional.       |
| 10 | `MARGEN_GANANCIA`   | número  | Porcentaje de margen de venta.                                           |
| 11 | `MERMA_COMPRA`      | número  | Porcentaje de merma por compra.                                          |
| 12 | `PERMITE_CONVERSION`| `SI`/`NO` | Si permite equivalencia de unidades (requiere fila `EQUIVALENCIA`).   |
| 13 | `IMPUESTOS`         | texto   | Impuestos separados por `;` o `,` (ver [impuestos](#impuestos)).         |
| 14 | `PRES_NOMBRE`       | texto   | Nombre de la presentación.                                               |
| 15 | `PRES_CANTIDAD`     | número  | Cantidad que representa la presentación (default `1`).                   |
| 16 | `PRES_UM`           | texto   | Unidad de la presentación.                                               |
| 17 | `PRES_COSTO`        | número  | Costo aproximado.                                                        |
| 18 | `PRES_PRECIO_MIN`   | número  | Precio mínimo.                                                           |
| 19 | `PRES_PRECIO_MAX`   | número  | Precio máximo.                                                           |
| 20 | `PRES_U_CONTROL`    | `SI`/`NO` | Presentación que agrupa/controla el stock.                             |
| 21 | `PRES_SE_VENDE`     | `SI`/`NO` | Si la presentación se usa para venta.                                    |
| 22 | `PRES_PRECIO_VENTA` | número  | Precio de venta (si `PRES_SE_VENDE = SI`).                               |
| 23 | `PRES_ES_ESTANDAR`  | `SI`/`NO` | Si es la presentación estándar.                                          |
| 24 | `PRES_ACTIVA`       | `SI`/`NO` | Si la presentación está activa/buscable.                                 |
| 25 | `ALMACEN`           | texto   | Almacén para el inventario (ver [almacenes](#almacenes)).                |
| 26 | `CONTROLAR_STOCK`   | `SI`/`NO` | Si controla stock en ese almacén.                                        |
| 27 | `STOCK_APERTURA`    | número  | Stock inicial.                                                           |
| 28 | `COSTO_APERTURA`    | número  | Costo del stock inicial.                                                 |
| 29 | `STOCK_MIN`         | número  | Stock mínimo.                                                            |
| 30 | `STOCK_MAX`         | número  | Stock máximo.                                                            |
| 31 | `EQUIV_CANTIDAD`    | número  | Cantidad de la equivalencia (solo fila `EQUIVALENCIA`).                  |
| 32 | `EQUIV_UM`          | texto   | Unidad de la equivalencia (solo fila `EQUIVALENCIA`).                    |

### Tipos de fila

| `TIPO_FILA`     | Columnas que se usan                                                  | Cantidad |
|-----------------|------------------------------------------------------------------------|----------|
| `CABECERA`      | `CODIGO`…`IMPUESTOS` (columnas 3 a 13)                                 | 1        |
| `PRESENTACION`  | `PRES_*` (columnas 14 a 24)                                            | 1 o más  |
| `INVENTARIO`    | `ALMACEN`…`STOCK_MAX` (columnas 25 a 30)                               | 1 o más  |
| `EQUIVALENCIA`  | `EQUIV_CANTIDAD`, `EQUIV_UM` (columnas 31 y 32)                        | 0 o 1    |

Reglas:
- Todo insumo requiere **1 fila `CABECERA`** y **al menos 1 `PRESENTACION`**.
- `PERMITE_CONVERSION = SI` requiere una fila `EQUIVALENCIA`.
- `INVENTARIO` se repite una vez por cada almacén.

---

## 2. Hoja `COMPRAS`

### Columnas (orden exacto)

| # | Columna             | Tipo    | Descripción                                                          |
|---|---------------------|---------|----------------------------------------------------------------------|
| 1 | `TIPO_FILA`         | texto   | `CABECERA` o `DETALLE`.                                              |
| 2 | `ID_OPERACION`      | texto   | Identificador único de la compra.                                    |
| 3 | `LOCAL`             | texto   | Local (ver [locales](#locales)). Opcional.                           |
| 4 | `PROVEEDOR`         | texto   | Proveedor (obligatorio).                                             |
| 5 | `MONEDA`            | texto   | Moneda (ver [moneda](#moneda)). Opcional.                            |
| 6 | `TIPO_COMPROBANTE`  | texto   | Comprobante (ver [comprobantes](#comprobantes)).                     |
| 7 | `SERIE`             | texto   | Serie del documento.                                                 |
| 8 | `NUMERO`            | texto   | Número del documento.                                                |
| 9 | `FECHA_COMPRA`      | texto   | Fecha de compra (formato `YYYY-MM-DD`).                              |
| 10 | `FECHA_TRIBUTACION` | texto   | Fecha de tributación (opcional; si no, usa `FECHA_COMPRA`).          |
| 11 | `ALMACEN`           | texto   | Almacén por defecto de la compra. Opcional.                          |
| 12 | `NOTAS`             | texto   | Observaciones.                                                       |
| 13 | `IMPUESTOS_INCLUIDOS` | `SI`/`NO` | Si los precios incluyen impuesto (default `SI`).                  |
| 14 | `DESCUENTO_GLOBAL`  | número  | Descuento global de la compra.                                       |
| 15 | `TIPO_ITEM`         | texto   | `INSUMO` (default) o `PRODUCTO`.                                     |
| 16 | `ITEM_CODIGO`       | texto   | Código del item (coincide con `CODIGO` del insumo).                  |
| 17 | `ITEM_NOMBRE`       | texto   | Nombre del item.                                                     |
| 18 | `CANTIDAD`          | número  | Cantidad.                                                            |
| 19 | `PRECIO`            | número  | Precio unitario.                                                     |
| 20 | `DESCUENTO_ITEM`    | número  | Descuento por línea.                                                 |
| 21 | `AFECTO_IGV`        | `SI`/`NO` | Si el item está afecto a IGV (default `SI`).                        |
| 22 | `PRESENTACION`      | texto   | Presentación a comprar (coincide con `PRES_NOMBRE`).                 |
| 23 | `ALMACEN_DETALLE`   | texto   | Almacén de la línea (opcional; si no, usa el de la cabecera).        |
| 24 | `NUM_LOTE`          | texto   | Número de lote (opcional).                                           |
| 25 | `FECHA_CADUCIDAD`   | texto   | Fecha de caducidad (opcional).                                       |

### Tipos de fila

| `TIPO_FILA` | Columnas que se usan                               | Cantidad |
|-------------|----------------------------------------------------|----------|
| `CABECERA`  | `LOCAL`…`DESCUENTO_GLOBAL` (columnas 3 a 14)        | 1        |
| `DETALLE`   | `TIPO_ITEM`…`FECHA_CADUCIDAD` (columnas 15 a 25)    | 1 o más  |

Reglas:
- Toda compra requiere **1 fila `CABECERA`** y **al menos 1 `DETALLE`**.
- `ITEM_CODIGO` y `ITEM_NOMBRE` deben referirse a un insumo/producto ya existente
  (el bot crea primero los insumos de la hoja `INSUMOS` y luego las compras).

---

## 3. Datos de referencia (extraídos de `restaurant.sql`)

### Locales
| `local_id` | `local_descripcion` |
|-----------|---------------------|
| 1         | `CD Logistico`      |
| 2         | `Mall Del Sur`      |
| 3         | `Minka`             |

> El bot usa el local **`CD Logistico`** (`local_id = 1`).

### Almacenes del local `CD Logistico`
| `almacen_id` | `almacen_descripcion` |
|-------------|------------------------|
| 1           | `Almacen Principal`    |
| 18          | `Producción`           |

### Unidades de medida
`UNIDAD` (UN), `KILOS` (KG), `GRAMOS` (GR), `LITRO` (L), `MILILITRO` (ML),
`LIBRAS` (LB), `ONZAS` (OZ), entre otras.

### Moneda
`Soles` (símbolo `S/`, ISO `PEN`). El valor de la columna `MONEDA` debe coincidir
con `moneda_descripcion` (por eso se usa **`Soles`**).

### Comprobantes de compra
`Factura`, `Boleta`, `Nota de Venta`, `Recibo por Honorario`.

### Proveedores (ejemplos)
| `proveedor_razonsocial`                                   | RUC          |
|-----------------------------------------------------------|--------------|
| `GRUPO SEVEN SEAS SAC`                                    | 20515506251  |
| `TIERRA DORADA & SERVICIOS GASTRONOMICOS E.I.R.L.`        | 20608103245  |
| `INVERSIONES GUI GUE E.I.R.L.`                            | 20535134091  |
| `GRUPO AGUIRRE LUQUE E.I.R.L.`                            | 20601149967  |

> En la columna `PROVEEDOR` se usa la **razón social** (así lo busca
> `obtenerProveedorPorBusqueda`).

### Categorías
Las categorías de insumo se cargan en tiempo de ejecución desde la aplicación.
En este proyecto se usa la categoría **`Categoria uno`**.

### Impuestos
Los impuestos de compra se cargan en tiempo de ejecución. En este proyecto se
usa **`IGV`** (coincide con `impuestocompra_nombre`).

---

## 4. Ejemplo incluido

El archivo `data/Datos_Bot.xlsx` ya viene con un ejemplo funcional:

- **3 insumos** (`INS-001` a `INS-003`) en categoría `Categoria uno`, proveedor
  `TIERRA DORADA & SERVICIOS GASTRONOMICOS E.I.R.L.` y almacén `Almacen Principal`.
- **1 compra** (`COM-001`) a ese proveedor en el local `CD Logistico`, con
  comprobante `Factura`, moneda `Soles`, y 3 líneas de detalle que referencian
  los insumos recién creados.

Puedes duplicar filas (manteniendo el mismo `ID_OPERACION` y `TIPO_FILA`
correcto) para agregar más insumos o compras.
