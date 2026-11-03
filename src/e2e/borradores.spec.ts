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
  const tipo = descartable ? 'un descartable' : 'un insumo';
  let id: number | undefined;
  try {
    const r = await crearInsumo(page, { nombre, stockApertura: 5, costoApertura: 10, descartable, borrador: true });
    log({ fase: F, paso: `${etiqueta}. guardar como borrador '${nombre}' (apertura 5 @10)`, ok: r.ok, real: r.id !== undefined ? 'id=' + r.id : undefined, error: r.error,
      descripcion: `Se registra ${tipo} con el botón «Guardar como borrador» (con 5 unidades de apertura a S/ 10): queda guardado pero no debe poder usarse hasta publicarlo.` });
    if (!r.ok || r.id === undefined) return;
    id = r.id;
  } catch (e) {
    log({ fase: F, paso: `${etiqueta}. guardar como borrador`, ok: false, error: String(e) });
    return;
  }

  try {
    const bd = await leerEstadoYApertura(id);
    log({ fase: F, paso: `${etiqueta}. insumo_estado = 2 (borrador)`, ok: bd.estado === '2', esperado: '2', real: String(bd.estado),
      descripcion: 'En la BD el borrador queda con insumo_estado = 2 (1 = activo, 0 = anulado).' });
    log({ fase: F, paso: `${etiqueta}. borrador genera apertura en Kardex`, ok: bd.movimientos > 0, esperado: 'movimientos > 0', real: 'movimientos=' + bd.movimientos,
      descripcion: 'Por diseño el borrador sí genera la apertura de stock en el Kárdex; lo que debe impedirse es encontrarlo y usarlo.' });
  } catch (e) { log({ fase: F, paso: `${etiqueta}. leer BD`, ok: false, error: String(e) }); }

  try {
    const general = await buscarItems(page, nombre);
    const compras = await buscarItems(page, nombre, { incluirConversionManual: true });
    const kardex = await buscarItems(page, nombre, { agruparInsumo: true });
    const enGeneral = general.some((f) => f.itemId === id);
    const enCompras = compras.some((f) => f.itemId === id);
    const enKardex = kardex.some((f) => f.itemId === id);
    log({ fase: F, paso: `${etiqueta}. buscador general (kárdex/recetas/movimientos) NO lo muestra`, ok: !enGeneral, esperado: 'ausente', real: enGeneral ? 'aparece (defecto)' : 'ausente',
      descripcion: 'El buscador de ítems (una fila por presentación) que usan recetas, movimientos, cuadres y producción no debe mostrar el borrador.' });
    log({ fase: F, paso: `${etiqueta}. buscador del Kárdex (agrupado) NO lo muestra`, ok: !enKardex, esperado: 'ausente', real: enKardex ? 'aparece (defecto)' : 'ausente',
      descripcion: 'El buscador agrupado por insumo (Kárdex individual, ingredientes de receta, filtros de reportes) tampoco debe mostrar el borrador.' });
    log({ fase: F, paso: `${etiqueta}. buscador de compras/guías/OC NO lo muestra`, ok: !enCompras, esperado: 'ausente', real: enCompras ? 'aparece (defecto)' : 'ausente',
      descripcion: 'El buscador de compras, guías y órdenes de compra no debe ofrecer el borrador: no se puede comprar algo que no está publicado.' });
  } catch (e) { log({ fase: F, paso: `${etiqueta}. buscadores`, ok: false, error: String(e) }); }

  try {
    const p = await publicar(page, id);
    log({ fase: F, paso: `${etiqueta}. publicar (activar)`, ok: p.ok, error: p.error,
      descripcion: 'Se publica el borrador desde el menú «Publicar insumo» de la lista (GET insumo/activar).' });
    if (!p.ok) return;
    const bd = await leerEstadoYApertura(id);
    log({ fase: F, paso: `${etiqueta}. publicado: insumo_estado = 1`, ok: bd.estado === '1', esperado: '1', real: String(bd.estado),
      descripcion: 'Publicado, el ítem pasa a insumo_estado = 1 (activo).' });
    const general = await buscarItems(page, nombre);
    const aparece = general.some((f) => f.itemId === id);
    log({ fase: F, paso: `${etiqueta}. publicado: el buscador lo muestra`, ok: aparece, esperado: 'presente', real: aparece ? 'presente' : 'ausente',
      descripcion: 'Ya publicado, el buscador debe mostrarlo como cualquier ítem activo.' });
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
    log({ fase: F, paso: `control: buscador encuentra '${QA.insumoCarne}' (activo)`, ok: activo.length > 0, esperado: 'presente', real: activo.length ? 'filas=' + activo.length : 'ausente',
      descripcion: 'Control del bloque: con los mismos parámetros el buscador sí encuentra un insumo activo, así que una ausencia del borrador no se debe a la búsqueda.' });
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
