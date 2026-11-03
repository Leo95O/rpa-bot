// borradores.spec.ts — Bloque 9: estado «Borrador» de insumos y descartables (insumo_estado = 2).
// Ejecutar: npm run test:bloque9. No depende de otros bloques ni limpia BD.
//
// Contrato (backend docs/producto/estado-borrador-insumos.md):
//  - «Guardar como borrador» graba insumo_estado = 2 con las mismas validaciones que guardar normal.
//  - El borrador SÍ genera apertura de stock (movimientos en el Kardex); lo que importa es que no se encuentre.
//  - No aparece en los buscadores de recetas, kárdex, compras, cuadres, movimientos ni producción
//    (busquedaSensitivaSegunTipos filtra insumo_estado = ACTIVO).
//  - Publicar (GET insumo/activar/{id}) lo deja en 1 y desde ahí se encuentra.

import * as path from 'path';
import { Page } from 'playwright';
import { crearInsumo, cerrarModales } from '../bot';
import { FilaReporte } from '../types';
import { QA, EstadoSuite } from './fixtures';
import { buscarItems } from './compras/helpers';
import { generarHtmlReporte, generarPdfReporte, resumirReporte } from '../reporte';
import { logFila, abrirStandalone } from './harness';
import { promises as fs } from 'fs';

declare const angular: any;

const F = 'Bloque 9: Borradores';

async function conexion(): Promise<any> {
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logisticaaa',
  });
}

async function leerEstadoYApertura(insumoId: number): Promise<{ estado: string | null; movimientos: number }> {
  const c = await conexion();
  try {
    const [ins] = await c.query('SELECT insumo_estado AS estado FROM insumo WHERE insumo_id = ?', [insumoId]);
    const [movs] = await c.query('SELECT COUNT(*) AS n FROM movimientoalmaceninsumo WHERE insumo_id = ?', [insumoId]);
    const fila = (ins as Array<{ estado: number | null }>)[0];
    return { estado: fila && fila.estado != null ? String(fila.estado) : null, movimientos: Number((movs as Array<{ n: number }>)[0].n) };
  } finally {
    await c.end();
  }
}

/** Menú «Publicar insumo» de la lista: Insumo.activarInsumo → GET producto/insumo/activar/{id}. */
async function publicar(page: Page, insumoId: number): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (id) => {
    try {
      const Insumo = angular.element(document.body).injector().get('Insumo');
      const r = await Insumo.activarInsumo(id);
      if (Number(r.tipo) === 1) return { ok: true };
      return { ok: false, error: (r.mensajes || []).map((m: any) => (typeof m === 'string' ? m : String((m && m.data) || ''))).join('; ') || 'tipo=' + r.tipo };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, insumoId);
}

/** Crea un ítem en borrador, comprueba que no se encuentra, lo publica y comprueba que sí. */
async function cicloBorrador(page: Page, log: (f: FilaReporte) => void, etiqueta: string, nombre: string, descartable: boolean): Promise<void> {
  let id: number | undefined;
  try {
    const r = await crearInsumo(page, { nombre, stockApertura: 5, costoApertura: 10, descartable, borrador: true });
    log({ fase: F, paso: `${etiqueta}. guardar como borrador '${nombre}' (apertura 5 @10)`, ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error });
    if (!r.ok || r.id === undefined) return;
    id = r.id;
  } catch (e) {
    log({ fase: F, paso: `${etiqueta}. guardar como borrador`, ok: false, error: String(e) });
    return;
  }

  try {
    const bd = await leerEstadoYApertura(id);
    log({ fase: F, paso: `${etiqueta}. insumo_estado = 2 (borrador)`, ok: bd.estado === '2', esperado: '2', real: String(bd.estado) });
    log({ fase: F, paso: `${etiqueta}. borrador genera apertura en Kardex`, ok: bd.movimientos > 0, esperado: 'movimientos > 0', real: 'movimientos=' + bd.movimientos });
  } catch (e) { log({ fase: F, paso: `${etiqueta}. leer BD`, ok: false, error: String(e) }); }

  try {
    const general = await buscarItems(page, nombre);
    const compras = await buscarItems(page, nombre, { incluirConversionManual: true });
    const enGeneral = general.some((f) => f.itemId === id);
    const enCompras = compras.some((f) => f.itemId === id);
    log({ fase: F, paso: `${etiqueta}. buscador general (kárdex/recetas/movimientos) NO lo muestra`, ok: !enGeneral, esperado: 'ausente', real: enGeneral ? 'aparece (defecto)' : 'ausente' });
    log({ fase: F, paso: `${etiqueta}. buscador de compras/guías/OC NO lo muestra`, ok: !enCompras, esperado: 'ausente', real: enCompras ? 'aparece (defecto)' : 'ausente' });
  } catch (e) { log({ fase: F, paso: `${etiqueta}. buscadores`, ok: false, error: String(e) }); }

  try {
    const p = await publicar(page, id);
    log({ fase: F, paso: `${etiqueta}. publicar (activar)`, ok: p.ok, error: p.error });
    if (!p.ok) return;
    const bd = await leerEstadoYApertura(id);
    log({ fase: F, paso: `${etiqueta}. publicado: insumo_estado = 1`, ok: bd.estado === '1', esperado: '1', real: String(bd.estado) });
    const general = await buscarItems(page, nombre);
    const aparece = general.some((f) => f.itemId === id);
    log({ fase: F, paso: `${etiqueta}. publicado: el buscador lo muestra`, ok: aparece, esperado: 'presente', real: aparece ? 'presente' : 'ausente' });
  } catch (e) { log({ fase: F, paso: `${etiqueta}. publicar`, ok: false, error: String(e) }); }
}

export async function runBloque9(page: Page, _estado: EstadoSuite, reporte: FilaReporte[]): Promise<void> {
  const log = (f: FilaReporte): void => logFila(reporte, f);
  await cerrarModales(page);
  // Sufijo por corrida: al publicarse pasan a activos y la unicidad de nombre se compara contra activos.
  const sufijo = Date.now().toString(36).slice(-5).toUpperCase();

  // Control: el buscador sí devuelve un ítem activo con los mismos parámetros.
  try {
    const activo = await buscarItems(page, QA.insumoCarne);
    log({ fase: F, paso: `control: buscador encuentra '${QA.insumoCarne}' (activo)`, ok: activo.length > 0, esperado: 'presente', real: activo.length ? 'filas=' + activo.length : 'ausente' });
  } catch (e) { log({ fase: F, paso: 'control buscador', ok: false, error: String(e) }); }

  await cicloBorrador(page, log, '46', 'Insumo Borrador QA ' + sufijo, false);
  await cicloBorrador(page, log, '47', 'Descartable Borrador QA ' + sufijo, true);
}

/** Entrada standalone: npm run test:bloque9. */
async function main(): Promise<void> {
  const ctx = await abrirStandalone(false);
  await runBloque9(ctx.page, ctx.estado, ctx.reporte);
  const resumen = resumirReporte(ctx.reporte);
  const html = generarHtmlReporte(ctx.reporte, resumen);
  await fs.writeFile(path.resolve('data', 'Reporte_Bloque9.html'), html, 'utf8');
  await generarPdfReporte(ctx.reporte, path.resolve('data', 'Reporte_Bloque9.pdf'), resumen);
  console.log('\n== Bloque 9 ==\nExitosos: ' + resumen.exitosos + ' | Fallidos: ' + resumen.fallidos);
  await ctx.browser.close();
  process.exit(resumen.fallidos ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error('Error fatal:', e); process.exit(2); });
}
