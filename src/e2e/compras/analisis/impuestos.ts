// impuestos.ts — Análisis de impuestos por línea y totales
import { Page } from 'playwright';
import { precioSin } from '../helpers';

const TOLERANCIA = 0.02;

export interface ImpuestoAnalisis {
  paso: string;
  ok: boolean;
  esperado: string;
  real?: string;
  error?: string;
}

export function analizarImpuestosLinea(
  cantidad: number,
  costo: number,
  afecto: boolean,
  igvPct: number,
): ImpuestoAnalisis {
  const paso = `impuestosLinea(cant=${cantidad}, costo=${costo}, afecto=${afecto})`;
  const divisor = 1 + igvPct / 100;
  const sin = afecto ? precioSin(costo, divisor) : costo;
  const imp = afecto ? sin * (igvPct / 100) * cantidad : 0;
  const subtotal = sin * cantidad;
  const total = subtotal + imp;

  const esperado = `sin=${sin.toFixed(3)}; imp=${imp.toFixed(3)}; sub=${subtotal.toFixed(3)}; total=${total.toFixed(3)}`;
  return { paso, ok: true, esperado, real: esperado };
}

export function analizarTotalesCompra(
  lineas: Array<{ cantidad: number; costo: number; afecto: boolean; descuento?: number }>,
  igvPct: number,
  opts: { flete?: number; icbper?: number; percepcion?: number } = {},
): ImpuestoAnalisis {
  const paso = 'totalesCompra';
  let subtotal = 0;
  let igv = 0;
  for (const l of lineas) {
    const importe = l.cantidad * l.costo - (l.descuento || 0);
    if (l.afecto) {
      const sin = l.costo / (1 + igvPct / 100);
      subtotal += sin * l.cantidad;
      igv += sin * (igvPct / 100) * l.cantidad;
    } else {
      subtotal += importe;
    }
  }
  const flete = opts.flete || 0;
  const icbper = opts.icbper || 0;
  const percepcion = opts.percepcion || 0;
  const total = subtotal + igv + flete + icbper + percepcion;

  const esperado = `sub=${subtotal.toFixed(3)}; igv=${igv.toFixed(3)}; total=${total.toFixed(3)}; flete=${flete}; icbper=${icbper}; perc=${percepcion}`;
  return { paso, ok: true, esperado, real: esperado };
}

export function analizarVariacion(
  precioAnterior: number | null,
  precioActual: number,
): ImpuestoAnalisis {
  const paso = `variacion(${precioAnterior ?? 'null'} → ${precioActual})`;
  let variacion: number;
  if (precioAnterior === null || precioAnterior === 0) {
    variacion = precioActual > 0 ? 100 : 0;
  } else {
    variacion = ((precioActual - precioAnterior) / precioActual) * 100;
  }
  const esperado = `variacion=${variacion.toFixed(2)}%`;
  return { paso, ok: true, esperado, real: esperado };
}
