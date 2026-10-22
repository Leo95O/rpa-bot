export type TipoFilaInsumo = 'CABECERA' | 'PRESENTACION' | 'INVENTARIO' | 'EQUIVALENCIA';
export type TipoFilaCompra = 'CABECERA' | 'DETALLE';

export interface InsumoCabecera {
  codigo: string;
  codigoInterno: string;
  nombre: string;
  unidadMedida: string;
  categoria: string;
  clasificacionAbc: string;
  proveedor?: string;
  margenGanancia: number;
  mermaCompra: number;
  permiteConversion: boolean;
  impuestos: string[];
}

export interface InsumoPresentacion {
  nombre: string;
  cantidad: number;
  unidadMedida: string;
  costo: number;
  precioMinimo: number;
  precioMaximo: number;
  unidadControl: boolean;
  seVende: boolean;
  precioVenta: number;
  esEstandar: boolean;
  activa: boolean;
}

export interface InsumoInventario {
  almacen: string;
  controlarStock: boolean;
  stockApertura: number;
  costoApertura: number;
  stockMinimo: number;
  stockMaximo: number;
}

export interface InsumoEquivalencia {
  cantidad: number;
  unidadMedida: string;
}

export interface IngredienteReceta {
  insumoId: number;
  cantidad: number;
  umId: number;
}

export interface InsumoAgrupado {
  idOperacion: string;
  cabecera: InsumoCabecera;
  presentaciones: InsumoPresentacion[];
  inventario: InsumoInventario[];
  equivalencia?: InsumoEquivalencia;
  /** Si se define, se registra como RECETA (1 plato = `genera` con estos ingredientes). */
  receta?: { ingredientes: IngredienteReceta[]; genera: number };
}

export interface CompraCabecera {
  local?: string;
  proveedor: string;
  moneda?: string;
  tipoComprobante: string;
  serie: string;
  numero: string;
  fechaCompra: string;
  fechaTributacion: string;
  almacen?: string;
  notas: string;
  impuestosIncluidos: boolean;
  descuentoGlobal: number;
  /**
   * Campos crudos a forzar sobre `compraNueva` antes del POST (ver
   * `EstadoForzadoCompra` en compras.ts). Solo tipos serializables por
   * `page.evaluate`. `bot.ts` los aplica con `Object.assign` AL FINAL para
   * que tengan precedencia sobre lo resuelto del $scope.
   */
  extra?: CamposExtraCompra;
}

/** Valores serializables que `page.evaluate` puede transportar al navegador. */
export type CamposExtraCompra = Record<string, string | number | boolean | null>;

export interface CompraDetalle {
  tipoItem: string;
  itemCodigo: string;
  itemNombre: string;
  cantidad: number;
  precio: number;
  descuento: number;
  afectoIgv: boolean;
  presentacion?: string;
  almacen?: string;
  numLote?: string;
  fechaCaducidad?: string;
}

export interface CompraAgrupada {
  idOperacion: string;
  cabecera: CompraCabecera;
  detalle: CompraDetalle[];
}

export interface ResultadoOperacion {
  ok: boolean;
  idOperacion: string;
  tipo: 'insumo' | 'compra';
  error?: string;
  detalle?: string;
  idGenerado?: number;
}

export interface FilaReporte {
  fase: string;
  paso: string;
  ok: boolean;
  /** true = la verificación NO se ejecutó (flujo stub): no cuenta como éxito ni como fallo. */
  pendiente?: boolean;
  esperado?: string;
  real?: string;
  error?: string;
}
