import * as ExcelJS from 'exceljs';
import {
  InsumoAgrupado,
  InsumoCabecera,
  InsumoPresentacion,
  InsumoInventario,
  InsumoEquivalencia,
  CompraAgrupada,
  CompraCabecera,
  CompraDetalle,
} from './types';

export interface DatosExcel {
  insumos: InsumoAgrupado[];
  compras: CompraAgrupada[];
}

export async function leerExcel(ruta: string): Promise<DatosExcel> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);

  const hojaInsumos = wb.getWorksheet('INSUMOS');
  const hojaCompras = wb.getWorksheet('COMPRAS');

  if (!hojaInsumos && !hojaCompras) {
    throw new Error(
      'El archivo no contiene las hojas "INSUMOS" ni "COMPRAS". Hojas encontradas: ' +
        wb.worksheets.map((w) => w.name).join(', '),
    );
  }

  return {
    insumos: hojaInsumos ? parseInsumos(hojaInsumos) : [],
    compras: hojaCompras ? parseCompras(hojaCompras) : [],
  };
}

function parseInsumos(hoja: ExcelJS.Worksheet): InsumoAgrupado[] {
  const header = buildHeaderMap(hoja.getRow(1));
  const grupos = new Map<string, InsumoAgrupado>();
  const orden: string[] = [];

  hoja.eachRow((row, n) => {
    if (n === 1) return;
    const tipo = str(row, header, 'TIPO_FILA').toUpperCase();
    const id = str(row, header, 'ID_OPERACION');
    if (!tipo || !id) return;

    if (!grupos.has(id)) {
      grupos.set(id, {
        idOperacion: id,
        cabecera: null as unknown as InsumoCabecera,
        presentaciones: [],
        inventario: [],
        equivalencia: undefined,
      });
      orden.push(id);
    }
    const g = grupos.get(id)!;

    if (tipo === 'CABECERA') {
      g.cabecera = parseInsumoCabecera(row, header);
    } else if (tipo === 'PRESENTACION') {
      g.presentaciones.push(parsePresentacion(row, header));
    } else if (tipo === 'INVENTARIO') {
      g.inventario.push(parseInventario(row, header));
    } else if (tipo === 'EQUIVALENCIA') {
      g.equivalencia = parseEquivalencia(row, header);
    }
  });

  const resultado = orden.map((id) => grupos.get(id)!);
  for (const g of resultado) {
    if (!g.cabecera) throw new Error(`Insumo "${g.idOperacion}" sin fila CABECERA.`);
    if (!g.cabecera.nombre) throw new Error(`Insumo "${g.idOperacion}" sin NOMBRE.`);
    if (g.presentaciones.length === 0) throw new Error(`Insumo "${g.idOperacion}" sin filas PRESENTACION.`);
  }
  return resultado;
}

function parseCompras(hoja: ExcelJS.Worksheet): CompraAgrupada[] {
  const header = buildHeaderMap(hoja.getRow(1));
  const grupos = new Map<string, CompraAgrupada>();
  const orden: string[] = [];

  hoja.eachRow((row, n) => {
    if (n === 1) return;
    const tipo = str(row, header, 'TIPO_FILA').toUpperCase();
    const id = str(row, header, 'ID_OPERACION');
    if (!tipo || !id) return;

    if (!grupos.has(id)) {
      grupos.set(id, {
        idOperacion: id,
        cabecera: null as unknown as CompraCabecera,
        detalle: [],
      });
      orden.push(id);
    }
    const g = grupos.get(id)!;

    if (tipo === 'CABECERA') {
      g.cabecera = parseCompraCabecera(row, header);
    } else if (tipo === 'DETALLE') {
      g.detalle.push(parseDetalle(row, header));
    }
  });

  const resultado = orden.map((id) => grupos.get(id)!);
  for (const g of resultado) {
    if (!g.cabecera) throw new Error(`Compra "${g.idOperacion}" sin fila CABECERA.`);
    if (!g.cabecera.proveedor) throw new Error(`Compra "${g.idOperacion}" sin PROVEEDOR.`);
    if (g.detalle.length === 0) throw new Error(`Compra "${g.idOperacion}" sin filas DETALLE.`);
  }
  return resultado;
}

function parseInsumoCabecera(row: ExcelJS.Row, header: Map<string, number>): InsumoCabecera {
  return {
    codigo: str(row, header, 'CODIGO'),
    codigoInterno: str(row, header, 'CODIGO_INTERNO'),
    nombre: str(row, header, 'NOMBRE'),
    unidadMedida: str(row, header, 'UNIDAD_MEDIDA'),
    categoria: str(row, header, 'CATEGORIA'),
    clasificacionAbc: str(row, header, 'CLASIFICACION_ABC'),
    proveedor: str(row, header, 'PROVEEDOR') || undefined,
    margenGanancia: num(row, header, 'MARGEN_GANANCIA'),
    mermaCompra: num(row, header, 'MERMA_COMPRA'),
    permiteConversion: bool(row, header, 'PERMITE_CONVERSION'),
    impuestos: lista(str(row, header, 'IMPUESTOS')),
  };
}

function parsePresentacion(row: ExcelJS.Row, header: Map<string, number>): InsumoPresentacion {
  return {
    nombre: str(row, header, 'PRES_NOMBRE'),
    cantidad: num(row, header, 'PRES_CANTIDAD', 1),
    unidadMedida: str(row, header, 'PRES_UM'),
    costo: num(row, header, 'PRES_COSTO'),
    precioMinimo: num(row, header, 'PRES_PRECIO_MIN'),
    precioMaximo: num(row, header, 'PRES_PRECIO_MAX'),
    unidadControl: bool(row, header, 'PRES_U_CONTROL'),
    seVende: bool(row, header, 'PRES_SE_VENDE'),
    precioVenta: num(row, header, 'PRES_PRECIO_VENTA'),
    esEstandar: bool(row, header, 'PRES_ES_ESTANDAR'),
    activa: bool(row, header, 'PRES_ACTIVA'),
  };
}

function parseInventario(row: ExcelJS.Row, header: Map<string, number>): InsumoInventario {
  return {
    almacen: str(row, header, 'ALMACEN'),
    controlarStock: bool(row, header, 'CONTROLAR_STOCK'),
    stockApertura: num(row, header, 'STOCK_APERTURA'),
    costoApertura: num(row, header, 'COSTO_APERTURA'),
    stockMinimo: num(row, header, 'STOCK_MIN'),
    stockMaximo: num(row, header, 'STOCK_MAX'),
  };
}

function parseEquivalencia(row: ExcelJS.Row, header: Map<string, number>): InsumoEquivalencia {
  return {
    cantidad: num(row, header, 'EQUIV_CANTIDAD'),
    unidadMedida: str(row, header, 'EQUIV_UM'),
  };
}

function parseCompraCabecera(row: ExcelJS.Row, header: Map<string, number>): CompraCabecera {
  return {
    local: str(row, header, 'LOCAL') || undefined,
    proveedor: str(row, header, 'PROVEEDOR'),
    moneda: str(row, header, 'MONEDA') || undefined,
    tipoComprobante: str(row, header, 'TIPO_COMPROBANTE'),
    serie: str(row, header, 'SERIE'),
    numero: str(row, header, 'NUMERO'),
    fechaCompra: fecha(str(row, header, 'FECHA_COMPRA')),
    fechaTributacion: fecha(str(row, header, 'FECHA_TRIBUTACION')) || fecha(str(row, header, 'FECHA_COMPRA')),
    almacen: str(row, header, 'ALMACEN') || undefined,
    notas: str(row, header, 'NOTAS'),
    impuestosIncluidos: bool(row, header, 'IMPUESTOS_INCLUIDOS', true),
    descuentoGlobal: num(row, header, 'DESCUENTO_GLOBAL'),
  };
}

function parseDetalle(row: ExcelJS.Row, header: Map<string, number>): CompraDetalle {
  return {
    tipoItem: str(row, header, 'TIPO_ITEM') || 'INSUMO',
    itemCodigo: str(row, header, 'ITEM_CODIGO'),
    itemNombre: str(row, header, 'ITEM_NOMBRE'),
    cantidad: num(row, header, 'CANTIDAD', 1),
    precio: num(row, header, 'PRECIO'),
    descuento: num(row, header, 'DESCUENTO_ITEM'),
    afectoIgv: bool(row, header, 'AFECTO_IGV', true),
    presentacion: str(row, header, 'PRESENTACION') || undefined,
    almacen: str(row, header, 'ALMACEN_DETALLE') || undefined,
    numLote: str(row, header, 'NUM_LOTE') || undefined,
    fechaCaducidad: fechaCorta(row, header, 'FECHA_CADUCIDAD') || undefined,
  };
}

function buildHeaderMap(headerRow: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = String(cell.value ?? '').trim().toUpperCase();
    if (h) map.set(h, col);
  });
  return map;
}

function str(row: ExcelJS.Row, header: Map<string, number>, name: string): string {
  const col = header.get(name);
  if (col === undefined) return '';
  const v = row.getCell(col).value;
  if (v == null) return '';
  if (v instanceof Date) return formatoFechaLocal(v);
  if (typeof v === 'object') {
    if ('result' in v && v.result != null) return String((v as { result: unknown }).result).trim();
    if ('richText' in v) {
      const rt = (v as { richText: Array<{ text: string }> }).richText;
      if (rt && rt.length) return rt.map((r) => r.text).join('');
    }
    if ('text' in v) return String((v as { text: unknown }).text).trim();
    return String(v).trim();
  }
  return String(v).trim();
}

function num(row: ExcelJS.Row, header: Map<string, number>, name: string, def = 0): number {
  const s = str(row, header, name);
  if (s === '') return def;
  const n = Number(s);
  return Number.isNaN(n) ? def : n;
}

function bool(row: ExcelJS.Row, header: Map<string, number>, name: string, def = false): boolean {
  const s = str(row, header, name);
  if (s === '') return def;
  return ['SI', 'S', '1', 'TRUE', 'X', 'YES', 'Y'].includes(s.toUpperCase());
}

function lista(s: string): string[] {
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function fecha(s: string): string {
  if (!s) return '';
  return s;
}

function fechaCorta(row: ExcelJS.Row, header: Map<string, number>, name: string): string {
  const col = header.get(name);
  if (col === undefined) return '';
  const v = row.getCell(col).value;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(v.getDate())}/${p(v.getMonth() + 1)}/${v.getFullYear()}`;
  }
  if (v == null) return '';
  return String(v).trim();
}

function formatoFechaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
