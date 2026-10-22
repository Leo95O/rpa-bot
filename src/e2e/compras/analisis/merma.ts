// merma.ts — Análisis de merma automática en compra
import { Page } from 'playwright';

const TOLERANCIA = 0.02;

export interface MermaAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export function analizarMerma(
  cantidad: number,
  costo: number,
  mermaPct: number,
  stockAnterior: number,
  pppAnterior: number,
  igvPct: number,
): MermaAnalisis {
  const paso = `merma(cant=${cantidad}, costo=${costo}, merma=${mermaPct}%)`;
  const merma = (cantidad * mermaPct) / 100;
  const costoEncarecido = cantidad - merma === 0 ? 0 : (cantidad * costo) / (cantidad - merma);
  const cantidadNeta = cantidad - merma;
  const ppp = (stockAnterior * pppAnterior + cantidadNeta * costoEncarecido) / (stockAnterior + cantidadNeta);
  const divisor = 1 + igvPct / 100;
  const sinEncarecido = costoEncarecido / divisor;

  const esperado = `merma=${merma}; costoEncarecido=${costoEncarecido.toFixed(3)}; cantNeta=${cantidadNeta}; ppp=${ppp.toFixed(3)}; sinEncarecido=${sinEncarecido.toFixed(3)}`;
  return { paso, ok: true, esperado, real: esperado };
}

export async function verificarMermaEnBD(
  page: Page,
  compraId: number,
  insumoId: number,
  almacenId: number,
  ctx: { mermaEsperada: number; detalleCompraMermaid: number | null },
): Promise<MermaAnalisis> {
  const paso = `mermaBD(compra=${compraId})`;
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
        'SELECT detallemerma_cantidad AS cant, detallemerma_costo AS costo FROM detallemerma WHERE detallemerma_detallemotivoid IN (SELECT detallecompra_id FROM detallecompra WHERE compra_id = ? AND insumo_id = ?)',
        [compraId, insumoId],
      );
      const list = rows as Array<{ cant: number; costo: number }>;
      if (!list.length) return { paso, ok: false, esperado: 'merma en BD', error: 'Sin merma registrada' };
      const m = list[0];
      const ok = Math.abs(Number(m.cant) - ctx.mermaEsperada) < TOLERANCIA && Number(m.costo) === 0;
      const esperado = `cant=${ctx.mermaEsperada}; costo=0`;
      const real = `cant=${Number(m.cant)}; costo=${Number(m.costo)}`;
      return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en merma BD' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'merma BD', error: e instanceof Error ? e.message : String(e) };
  }
}
