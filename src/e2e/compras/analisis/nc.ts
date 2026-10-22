// nc.ts — Análisis de Nota de Crédito (cantidad y precio)
import { Page } from 'playwright';

const TOLERANCIA = 0.02;

export interface NCAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export async function analizarNCCantidad(
  page: Page,
  compraId: number,
  insumoId: number,
  almacenId: number,
  ctx: { stockAntes: number; stockDespues: number; pppAntes: number; pppDespues: number; cantidadDevuelta: number },
): Promise<NCAnalisis> {
  const paso = `ncCantidad(compra=${compraId}, devuelta=${ctx.cantidadDevuelta})`;
  const stockEsperado = ctx.stockAntes - ctx.cantidadDevuelta;
  const ok = Math.abs(ctx.stockDespues - stockEsperado) < TOLERANCIA;
  const esperado = `stock=${stockEsperado}; ppp=${ctx.pppAntes} (congelado)`;
  const real = `stock=${ctx.stockDespues}; ppp=${ctx.pppDespues}`;
  return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en NC cantidad' };
}

export async function analizarNCPrecio(
  page: Page,
  compraId: number,
  insumoId: number,
  almacenId: number,
  ctx: { stockAntes: number; stockDespues: number; pppAntes: number; pppDespues: number; descuento: number; cantidad: number },
): Promise<NCAnalisis> {
  const paso = `ncPrecio(compra=${compraId}, desc=${ctx.descuento})`;
  const nuevoCosto = (ctx.stockAntes * ctx.pppAntes - ctx.descuento * ctx.cantidad) / ctx.cantidad;
  const ok = Math.abs(ctx.pppDespues - nuevoCosto) < TOLERANCIA;
  const esperado = `stock=${ctx.stockAntes} (sin cambio); ppp=${nuevoCosto.toFixed(3)}`;
  const real = `stock=${ctx.stockDespues}; ppp=${ctx.pppDespues}`;
  return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en NC precio' };
}
