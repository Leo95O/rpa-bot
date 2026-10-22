// tipos.ts — Tipos compartidos del módulo de Compras (SOLID: Single Responsibility)

export interface Maestro {
  id: number;
  nombre: string;
  tipo: 'insumo' | 'consumible' | 'producto';
  afecto: boolean;
  um: string;
  presentaciones: Presentacion[];
  controlStock: { almacenId: number; controlar: boolean; stockMin: number; stockMax: number }[];
}

export interface Presentacion {
  id: number;
  nombre: string;
  cantidad: number;
  estandar: boolean;
  precioMin: number;
  precioMax: number;
}

export interface Configuracion {
  id: number;
  localId: number;
  valor: string;
  aux1?: string;
  aux2?: string;
}

export interface ResultadoOperacion {
  ok: boolean;
  id?: number;
  error?: string;
  raw?: { tipo: string; mensajes: string[]; data: unknown };
}

export interface EstadoSuite {
  maestros: Map<string, number>;
  solicitudes: Map<string, number>;
  ordenes: Map<string, number>;
  compras: Map<string, number>;
  guias: Map<string, number>;
  nc: Map<string, number>;
  /**
   * Estado del Kardex ANTES de un flujo (stock, PPP y PPP sin impuestos).
   * Lo guarda cada flujo para que los flujos que anulan una compra (F9)
   * puedan afirmar contra el estado previo real y no contra un supuesto.
   */
  preEstados?: Map<string, { stock: number; costo: number; sinImp: number }>;
}

export interface ContextoCompra {
  page: import('playwright').Page;
  estado: EstadoSuite;
  localId: number;
  almacenId: number;
  monedaId: number;
  tipoCambio: number;
  proveedorId: number;
  igv: number;
}

export interface LineaDetalle {
  itemTipo: 1 | 2;
  itemId: number;
  presentacionId?: number;
  cantidad: number;
  costo: number;
  almacenId: number;
  afecto: boolean;
  descripcion?: string;
}

export interface TotalesCompra {
  subtotal: number;
  igv: number;
  total: number;
  flete: number;
  icbper: number;
  percepcion: number;
  retencion: number;
}

export interface KardexFila {
  stockAnterior: number;
  cantidad: number;
  costo: number;
  costoOp: number;
  ppp: number;
  nuevoStock: number;
  valorizado: number;
  sinImp: number;
}
