// fixtures.ts — Datos y estado compartido de la suite E2E masiva (35 casos).
// Los specs acumulan estado aquí porque la matriz es secuencial sin limpieza intermedia.

export const TOLERANCIA = 0.02;

export const QA = {
  insumoCarne: 'Carne QA',
  proveedor: 'GRUPO SEVEN SEAS SAC',
  almacenCentral: 'Almacen Principal',
  local: 'CD Logistico',
  moneda: 'Soles',
  // Solicitud / OC (casos 2-3)
  solicitudCantidad: 50,
  ocCantidad: 50,
  ocCosto: 20,
  // Compras (casos 4-8)
  compra1: { cantidad: 50, precio: 20 },
  compra2: { cantidad: 50, precio: 30 },
  ncDevolucion: 10, // caso 6, sobre compra2
  compra3: { cantidad: 20, precio: 50 }, // caso 7, se anula en caso 8
} as const;

/** IDs generados durante la corrida; cada spec los arrastra al siguiente. */
export interface EstadoSuite {
  insumoId?: number;
  exoneradoId?: number;
  solicitudId?: number;
  ordenCompraId?: number;
  compra1?: number;
  compra2?: number;
  compra3?: number;
  consumibleId?: number;
  mermaId?: number;
  reqStockId?: number;
  ordenMovId?: number;
  movimientoId?: number;
  op1?: number;
  op2?: number;
  opImportado?: number;
  importadoId?: number;
  platoId?: number;
  platoImportadoId?: number;
  solicitudImportadoId?: number;
  ocImportadoId?: number;
  compraImportadoId?: number;
  oc2Id?: number;
  guia2Id?: number;
  req2Id?: number;
  om2Id?: number;
  mov2Id?: number;
  reqProdId?: number;
  opReqId?: number;
}

// Casos 29-35 (precondición: cierre del Bloque 5).
export const QA_CANJES = {
  oc2: { cantidad: 30, costo: 22 },
  req2Cantidad: 10,
  traslado2Cantidad: 10,
  reqProdCantidad: 15,
  guiaSerie: 'G002',
} as const;

export const QA_MRP = {
  plato: 'Plato QA',
  platoImportado: 'Plato Importado QA',
  encargado: 'BOT QA',
  importado: 'Insumo Importado QA',
  op1Cantidad: 5, // caso 21: cabe en Sucursal (8kg)
  op2Cantidad: 20, // caso 22: faltante 12kg
  importadoCantidad: 80,
  importadoCosto: 15,
} as const;

export const QA_CUADRE = {
  razonFaltante: 'Auditoría QA faltante',
  razonSobrante: 'Auditoría QA sobrante',
  centralFisico: 45, // sistema 50 → faltante 5
  sucursalFisico: 8, // sistema 5 → sobrante 3
  sobranteCosto: 30, // costoNuevo digitado (matriz nota 5)
} as const;

// Casos 13-18. Sucursal (Cocina) = almacén 18 "Producción" (local 1 solo tiene
// el 1 Principal y el 18; matriz nota 3: un solo hilo de stock por almacén).
export const QA_TRASLADO = {
  almacenCentral: 'Almacen Principal',
  almacenCentralId: 1,
  almacenSucursal: 'Producci',
  almacenSucursalId: 18,
  cantidad: 40,
  cantidadExceso: 200, // caso 17: solo emulación, jamás se envía
  salidaSucursal: 35, // caso 18
} as const;

export const QA_CONSUMIBLE = {
  nombre: 'Caja de Empaque QA',
  almacenId: 1, // Almacén Principal (ver DIAG de Bloque 1)
  compra: { cantidad: 200, precio: 0.5 },
  salida: 50,
  razon: 'Consumo operativo QA',
} as const;

export function ppp(stockAnt: number, costoAnt: number, cant: number, costo: number): number {
  const den = stockAnt + cant;
  if (den <= 0) return 0;
  return (stockAnt * costoAnt + cant * costo) / den;
}

/**
 * Divisor de desgravación, leído de la BD al inicio de la suite (no hardcodeado):
 * `igv` con fiscalizado=1 del local 1 (Igv::getIgvFiscalizado), fallback 18
 * (mismo default del backend). Refleja CalculoLogistica.php:144.
 */
import mysql from 'mysql2/promise';

let divisorIgv = 1.18;

export function getDivisorIgv(): number {
  return divisorIgv;
}

export async function cargarIgvFiscalizado(): Promise<number> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logisticaaa',
  });
  try {
    const [rows] = await conn.query(
      'SELECT igv_porcentajeigv AS pct FROM igv WHERE igv_fiscalizado = 1 AND local_id = 1 LIMIT 1',
    );
    const list = rows as Array<{ pct: number }>;
    let pct = 18;
    if (list.length && Number(list[0].pct) > 0) pct = Number(list[0].pct);
    if (pct === 10) pct = 18; // mismo forzado del backend (getPorcentajeIgvFiscalizadoCompra)
    divisorIgv = Math.round((1 + pct / 100) * 1000) / 1000;
  } catch {
    divisorIgv = 1.18;
  } finally {
    await conn.end();
  }
  return divisorIgv;
}

/** PPP sin impuestos: misma fórmula, vía paralela (precisión 3 decimales). */
export function pppSin(stockAnt: number, costoSinAnt: number, cant: number, costoSin: number): number {
  const v = ppp(stockAnt, costoSinAnt, cant, costoSin);
  return Math.round(v * 1000) / 1000;
}

/** Desgravación unitaria esperada (afecto=true) o identidad (exonerado). */
export function precioSin(precioCon: number, afecto: boolean): number {
  const v = afecto ? precioCon / getDivisorIgv() : precioCon;
  return Math.round(v * 1000) / 1000;
}

// Insumo de contraste sin impuestos (exonerado): costo con y sin impuestos idénticos.
export const QA_EXONERADO = {
  nombre: 'Insumo Exonerado QA',
  compra: { cantidad: 10, precio: 10 },
} as const;
