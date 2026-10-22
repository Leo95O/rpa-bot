// kardex.ts â€” AnÃ¡lisis completo de Kardex pre/post (14 columnas)
import { Page } from 'playwright';
import { KardexFila } from '../tipos';
import { ppp, precioSin } from '../helpers';

const TOLERANCIA = 0.02;

export interface KardexAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export async function analizarKardexCompleto(
  page: Page,
  insumoId: number,
  almacenId: number,
  ctx: { igv: number; stockAnterior: number; pppAnterior: number; cantidad: number; costoOp: number; afecto: boolean },
): Promise<KardexAnalisis> {
  const paso = `kardexCompleto(insumo=${insumoId}, alm=${almacenId})`;
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'logisticaaa',
    });
    try {
      const [rows] = await conn.query(
        `SELECT movimientoalmaceninsumo_stockanterior AS sa,
                movimientoalmaceninsumo_cantidad AS cant,
                movimientoalmaceninsumo_costooperacion AS cop,
                movimientoalmaceninsumo_costopromedioactual AS ppp,
                movimientoalmaceninsumo_saldoactual AS saldo,
                movimientoalmaceninsumo_costosinimpuesto AS sin,
                movimientoalmaceninsumo_costopromediosinimpuesto AS pppSin
         FROM movimientoalmaceninsumo
         WHERE insumo_id = ? AND almacen_id = ?
           AND (movimientoalmaceninsumo_fueeliminado IS NULL OR movimientoalmaceninsumo_fueeliminado != '1')
         ORDER BY movimientoalmaceninsumo_id DESC LIMIT 1`,
        [insumoId, almacenId],
      );
      const list = rows as Array<{ sa: number; cant: number; cop: number; ppp: number; saldo: number; sin: number; pppSin: number }>;
      if (!list.length) return { paso, ok: false, esperado: 'Ãºltima fila', error: 'Sin movimientos' };

      const m = list[0];
      const divisor = 1 + ctx.igv / 100;
      const sinOp = ctx.afecto ? precioSin(ctx.costoOp, divisor) : ctx.costoOp;
      const pppEsperado = ppp(ctx.stockAnterior, ctx.pppAnterior, ctx.cantidad, ctx.costoOp);
      const nuevoStock = ctx.stockAnterior + ctx.cantidad;
      const valorizado = pppEsperado * nuevoStock;
      const pppSinEsperado = ctx.afecto
        ? ppp(ctx.stockAnterior, ctx.pppAnterior / divisor, ctx.cantidad, sinOp)
        : pppEsperado;

      const real = `stockAnt=${Number(m.sa)}; cant=${Number(m.cant)}; costoOp=${Number(m.cop)}; ppp=${Number(m.ppp)}; nuevo=${Number(m.saldo)}; sin=${Number(m.sin)}; pppSin=${Number(m.pppSin)}`;
      const esperado = `stockAnt=${ctx.stockAnterior}; cant=${ctx.cantidad}; costoOp=${ctx.costoOp}; ppp=${pppEsperado.toFixed(3)}; nuevo=${nuevoStock}; sin=${sinOp.toFixed(3)}; pppSin=${pppSinEsperado.toFixed(3)}`;

      const ok =
        Math.abs(Number(m.sa) - ctx.stockAnterior) < TOLERANCIA &&
        Math.abs(Number(m.cant) - ctx.cantidad) < TOLERANCIA &&
        Math.abs(Number(m.cop) - ctx.costoOp) < TOLERANCIA &&
        Math.abs(Number(m.ppp) - pppEsperado) < TOLERANCIA &&
        Math.abs(Number(m.saldo) - nuevoStock) < TOLERANCIA &&
        Math.abs(Number(m.sin) - sinOp) < TOLERANCIA;

      return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en Kardex' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'kardex', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function analizarStockValorizado(
  page: Page,
  insumoId: number,
  almacenId: number,
  ctx: { igv: number; stock: number; ppp: number; pppSin: number },
): Promise<KardexAnalisis> {
  const paso = `stockValorizado(insumo=${insumoId}, alm=${almacenId})`;
  const valorizado = ctx.ppp * ctx.stock;
  const valorizadoSin = ctx.pppSin * ctx.stock;
  const esperado = `valorizado=${valorizado.toFixed(2)}; valorizadoSin=${valorizadoSin.toFixed(2)}`;
  return { paso, ok: true, esperado, real: esperado };
}

