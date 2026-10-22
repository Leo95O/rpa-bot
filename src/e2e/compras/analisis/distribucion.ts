// distribucion.ts — Análisis de distribución multi-local
import { Page } from 'playwright';

const TOLERANCIA = 0.02;

export interface DistribucionAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export async function analizarDistribucion(
  page: Page,
  ordenCompraId: number,
  ctx: { detalleId: number; localId: number; cantidadLocal: number; cantidadTotal: number; precioOriginal: number },
): Promise<DistribucionAnalisis> {
  const paso = `distribucion(oc=${ordenCompraId}, local=${ctx.localId})`;
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
        'SELECT distribucionordencompra_cantidad AS cant, distribucionordencompra_direccion AS dir FROM distribucionordencompra WHERE detalleordencompra_id = ? AND local_id = ?',
        [ctx.detalleId, ctx.localId],
      );
      const list = rows as Array<{ cant: number; dir: string }>;
      if (!list.length) return { paso, ok: false, esperado: 'fila distribución', error: 'Sin fila de distribución' };
      const d = list[0];
      const precioProrrateado = (ctx.precioOriginal / ctx.cantidadTotal) * ctx.cantidadLocal;
      const ok = Math.abs(Number(d.cant) - ctx.cantidadLocal) < TOLERANCIA;
      const esperado = `cant=${ctx.cantidadLocal}; precioProrrateado=${precioProrrateado.toFixed(2)}`;
      const real = `cant=${Number(d.cant)}; dir=${d.dir}`;
      return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en distribución' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'distribución', error: e instanceof Error ? e.message : String(e) };
  }
}
