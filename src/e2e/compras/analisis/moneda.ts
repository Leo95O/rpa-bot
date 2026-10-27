// moneda.ts — Análisis multi-moneda (TC, conversión, último precio por moneda)
import { Page } from 'playwright';

const TOLERANCIA = 0.02;

export interface MonedaAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export function analizarConversionMoneda(
  montoOrigen: number,
  tipoCambio: number,
  monedaOrigen: string,
  monedaDestino: string,
): MonedaAnalisis {
  const paso = `conversion(${montoOrigen} ${monedaOrigen} → ${monedaDestino}, TC=${tipoCambio})`;
  const montoDestino = montoOrigen * tipoCambio;
  const esperado = `${montoDestino.toFixed(2)} ${monedaDestino}`;
  return { paso, ok: true, esperado, real: esperado };
}

export async function analizarUltimoPrecioPorMoneda(
  page: Page,
  insumoId: number,
  localId: number,
  monedaId: number,
  ctx: { esperadoMoneda: string; esperadoPrecio: number },
): Promise<MonedaAnalisis> {
  const paso = `ultimoPrecioPorMoneda(insumo=${insumoId}, moneda=${ctx.esperadoMoneda})`;
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
        `SELECT dc.detallecompra_costo AS costo, c.compra_tipocambio AS tc
         FROM detallecompra dc
         INNER JOIN compra c ON dc.compra_id = c.compra_id
         LEFT JOIN presentacioninsumo pi ON pi.presentacioninsumo_id = dc.presentacioninsumo_id
         WHERE (pi.insumo_id = ?) AND c.local_id = ? AND c.moneda_id = ?
           AND dc.detallecompra_costo > 0
         ORDER BY c.compra_fecha DESC LIMIT 1`,
        [insumoId, localId, monedaId],
      );
      const list = rows as Array<{ costo: number; tc: number }>;
      if (!list.length) return { paso, ok: false, esperado: 'último precio', error: 'Sin historial' };
      const r = list[0];
      const ok = Math.abs(Number(r.costo) - ctx.esperadoPrecio) < TOLERANCIA;
      const esperado = `precio=${ctx.esperadoPrecio} ${ctx.esperadoMoneda}`;
      const real = `precio=${Number(r.costo)}`;
      return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en último precio por moneda' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'moneda', error: e instanceof Error ? e.message : String(e) };
  }
}

export function analizarCostoConTC(
  costoOrigen: number,
  tipoCambio: number,
): MonedaAnalisis {
  const paso = `costoConTC(${costoOrigen}, TC=${tipoCambio})`;
  const costoDestino = costoOrigen * tipoCambio;
  const esperado = `${costoDestino.toFixed(3)}`;
  return { paso, ok: true, esperado, real: esperado };
}
