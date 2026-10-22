// cxp.ts — Análisis de Cuentas por Pagar
import { Page } from 'playwright';

const TOLERANCIA = 0.02;

export interface CxPAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export async function analizarCuotas(
  page: Page,
  compraId: number,
  ctx: { cuotasEsperadas: number; totalCredito: number; limiteAntes: number; limiteDespues: number },
): Promise<CxPAnalisis> {
  const paso = `cuotas(compra=${compraId}, n=${ctx.cuotasEsperadas})`;
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
        'SELECT COUNT(*) AS n, SUM(comprasporpagar_totalcuota) AS total FROM comprasporpagar WHERE compra_id = ?',
        [compraId],
      );
      const list = rows as Array<{ n: number; total: number }>;
      const c = list[0];
      const ok = Number(c.n) === ctx.cuotasEsperadas && Math.abs(Number(c.total) - ctx.totalCredito) < TOLERANCIA;
      const esperado = `cuotas=${ctx.cuotasEsperadas}; total=${ctx.totalCredito}; limite=${ctx.limiteAntes}→${ctx.limiteDespues}`;
      const real = `cuotas=${Number(c.n)}; total=${Number(c.total)}`;
      return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en cuotas' };
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { paso, ok: false, esperado: 'cuotas', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function analizarAmortizacion(
  page: Page,
  compraId: number,
  ctx: { cuotaId: number; montoAbono: number; saldoAntes: number; saldoDespues: number; limiteAntes: number; limiteDespues: number },
): Promise<CxPAnalisis> {
  const paso = `amortizacion(cuota=${ctx.cuotaId}, abono=${ctx.montoAbono})`;
  const saldoEsperado = ctx.saldoAntes - ctx.montoAbono;
  const limiteEsperado = ctx.limiteAntes + ctx.montoAbono;
  const ok = Math.abs(ctx.saldoDespues - saldoEsperado) < TOLERANCIA && Math.abs(ctx.limiteDespues - limiteEsperado) < TOLERANCIA;
  const esperado = `saldo=${saldoEsperado}; limite=${limiteEsperado}`;
  const real = `saldo=${ctx.saldoDespues}; limite=${ctx.limiteDespues}`;
  return { paso, ok, esperado, real, error: ok ? undefined : 'Divergencia en amortización' };
}
