// reporte.ts — Generación del entregable (Excel ya existe en test-e2e.ts).
// Aquí viven el HTML visual y el PDF 100% Node (PDFKit, sin navegador).
// Diseño escalable: constantes de estilo + columnas configurables +
// render de tabla con salto de página automático.

import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import { FilaReporte } from './types';

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export interface ResumenReporte {
  exitosos: number;
  fallidos: number;
  total: number;
  fecha: string;
}

export function resumirReporte(reporte: FilaReporte[]): ResumenReporte {
  const exitosos = reporte.filter((r) => r.ok).length;
  const fallidos = reporte.filter((r) => !r.ok).length;
  return { exitosos, fallidos, total: reporte.length, fecha: new Date().toLocaleString() };
}

// ---------------------------------------------------------------------------
// Descripción explicativa por paso (columna del PDF/HTML).
// Cada texto se construye con los datos propios de la fila (fase, paso,
// esperado, real): cantidades, costos, almacenes e IDs. Sin genéricos.
// ---------------------------------------------------------------------------

function num(txt: string | undefined, re: RegExp): string | null {
  if (!txt) return null;
  const m = re.exec(txt);
  return m ? m[1] : null;
}

function stockCosto(txt: string | undefined): { stock: string; costo: string; sinImp: string | null } | null {
  if (!txt) return null;
  const m = /stock=([-\d.]+);\s*costo=([-\d.]+)(;\s*costo_sin_imp=([-\d.]+))?/.exec(txt);
  return m ? { stock: m[1], costo: m[2], sinImp: m[4] ?? null } : null;
}

/** Explicación clara y específica del paso, con sus valores y su resultado. */
export function describirPaso(r: FilaReporte): string {
  const p = r.paso;
  const esp = stockCosto(r.esperado);
  const real = stockCosto(r.real);
  const id = num(r.real, /id=(\d+)/);
  const alm = num(p, /@ (.+?)\)?\s*$/) || num(p, /@ (.+)$/);
  const almacen = alm ? alm.replace(/\)$/, '') : null;
  const tiene = (s: string): boolean => p.indexOf(s) >= 0;

  if (tiene('obtenerEstadoGlobal')) return 'Se consulta el estado global del Kardex para fijar el punto de partida de la validación del bloque.';
  if (tiene('precondición')) return 'Se verifica que el bloque anterior dejó el estado exacto que este bloque necesita antes de operar.';
  if (tiene('abortado')) return 'Se aborta el bloque porque la precondición falló; no se ejecuta ningún caso para no contaminar la cadena.';
  if (tiene("crearInsumo('Carne QA')")) return 'Se da de alta el insumo "Carne QA" con 0 kg en el Almacén Principal' + (id ? ', generándose con id=' + id : '') + '. Es el insumo que se seguirá en toda la matriz.';
  if (tiene("crearInsumo('Importado QA')") || tiene("crearInsumo('Insumo Importado QA')")) return 'Se da de alta el insumo "Insumo Importado QA" con 0 kg en el Almacén Principal' + (id ? ' (id=' + id + ')' : '') + ', para probar el desvío externo.';
  if (tiene('crearConsumible')) return 'Se da de alta el consumible "Caja de Empaque QA" (insumo_consumible=1) con 0 unidades' + (id ? ' (id=' + id + ')' : '') + '. Su Kardex vivirá en la tabla espejo.';
  if (tiene('crearReceta')) {
    const nombre = num(p, /crearReceta\('([^']+)'\)/) || 'Plato QA';
    return 'Se registra la receta "' + nombre + '" 1:1 en UNIDAD (1 plato consume 1 kg), insumo base de la explosión MRP' + (id ? ' (id=' + id + ')' : '') + '.';
  }
  if (tiene('validarStockConsumible')) {
    const n = num(p, /validarStockConsumible\("([^"]+)"\)/) || 'consumible';
    if (esp) {
      const eSin = esp.sinImp !== null ? ' y S/ ' + esp.sinImp + ' sin impuestos' : '';
      const rSin = real && real.sinImp !== null ? ' y S/ ' + real.sinImp + ' sin impuestos' : '';
      return 'Se comprueba en la tabla espejo movimientoalmacenconsumible que "' + n + '" tenga ' + esp.stock + ' unidades a S/ ' + esp.costo + eSin + (real ? '; el sistema devuelve ' + real.stock + ' a S/ ' + real.costo + rSin : '') + '.';
    }
    return 'Se comprueba el stock del consumible "' + n + '" en la tabla espejo.';
  }
  if (tiene('validarStock')) {
    const n = num(p, /validarStock\("([^"]+)"\)/) || 'insumo';
    const donde = almacen ? ' en el almacén ' + almacen : '';
    if (esp) {
      const eSin = esp.sinImp !== null ? ' y S/ ' + esp.sinImp + ' sin impuestos' : '';
      const rSin = real && real.sinImp !== null ? ' y S/ ' + real.sinImp + ' sin impuestos' : '';
      return 'Se verifica que "' + n + '"' + donde + ' tenga ' + esp.stock + ' kg a S/ ' + esp.costo + ' de costo promedio' + eSin + (real ? '; el Kardex devuelve ' + real.stock + ' kg a S/ ' + real.costo + rSin : '') + '.';
    }
    return 'Se verifica el stock y costo de "' + n + '"' + donde + '.';
  }
  if (tiene('registrarSolicitud(')) {
    const cant = num(p, /registrarSolicitud\((\d+)kg\)/) || num(p, /solicitud\((\d+)kg\)/);
    return 'Se registra la Solicitud de Compra por ' + (cant || '?') + ' kg de "Carne QA" (documento de intención, no mueve inventario)' + (id ? ' con id=' + id : '') + '.';
  }
  if (tiene('registrarOC(')) {
    const m = /registrarOC\((\d+)kg@([\d.]+)\)/.exec(p);
    return 'Se pacta la Orden de Compra por ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg (total S/ ' + (Number(m[1]) * Number(m[2])).toFixed(2) + ')' : 'mercadería') + ' con el proveedor' + (id ? ' (id=' + id + ')' : '') + '. No mueve stock todavía.';
  }
  if (tiene('registrarCompra canje OC')) {
    const m = /canje OC \((\d+)@([\d.]+)\)/.exec(p);
    return 'Se recibe la mercadería canjeando la OC: ingresan ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'las unidades') + ' al Almacén Principal' + (id ? ' (compra id=' + id + ')' : '') + '. Primera entrada real al Kardex.';
  }
  if (tiene('registrarCompra (')) {
    const m = /registrarCompra \((\d+)@([\d.]+)\)/.exec(p);
    return 'Se registra una compra directa de ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'mercadería') + ' en el Almacén Principal' + (id ? ' (id=' + id + ')' : '') + ', que recalcula el costo promedio ponderado.';
  }
  if (tiene('registrarCompra consumible')) {
    const m = /consumible \((\d+)@([\d.]+)\)/.exec(p);
    return 'Se compra el consumible: ' + (m ? m[1] + ' unidades a S/ ' + m[2] + ' c/u' : 'mercadería') + ' en el Almacén Principal' + (id ? ' (id=' + id + ')' : '') + ', con Kardex en la tabla espejo.';
  }
  if (tiene('notaCredito')) {
    const cant = num(p, /devuelve (\d+)/);
    return 'Se devuelve ' + (cant || '?') + ' kg al proveedor con Nota de Crédito: descuenta cantidad pero congela el costo promedio' + (id ? ' (id=' + id + ')' : '') + '.';
  }
  if (tiene('anularCompra')) return 'Se anula la última compra (LIFO): el sistema revierte su entrada vía contra-movimiento y el costo vuelve al valor anterior.';
  if (tiene('anularOC')) return 'Se intenta anular la Orden de Compra con su compra vigente: el sistema debe bloquear la operación por documento hijo activo, sin tocar el stock.';
  if (tiene('salidaDirecta consumible')) {
    const cant = num(p, /consumible \((\d+)u\)/);
    return 'Sale el consumible como gasto operativo: se retiran ' + (cant || '?') + ' unidades del Almacén Principal' + (id ? ' (merma id=' + id + ')' : '') + ', con el costo congelado.';
  }
  if (tiene('requerimientoStock(')) {
    const cant = num(p, /requerimientoStock\((\d+)kg\)/);
    return 'La Sucursal solicita ' + (cant || '?') + ' kg de "Carne QA" al Central (intención de pedido)' + (id ? ' con id=' + id : '') + '. No mueve inventario.';
  }
  if (tiene('ordenMovimiento(')) {
    const cant = num(p, /ordenMovimiento\((\d+)kg\)/);
    return 'El Central aprueba el requerimiento y prepara ' + (cant || '?') + ' kg (picking)' + (id ? ' con id=' + id : '') + '. Las unidades siguen en origen.';
  }
  if (tiene('movimientoInterno(')) {
    const cant = num(p, /movimientoInterno\((\d+)kg\)/);
    return 'El traslado descuenta ' + (cant || '?') + ' kg del Central y los suma en Sucursal en un solo asiento doble vía, heredando el costo' + (id ? ' (id=' + id + ')' : '') + '.';
  }
  if (tiene('guiaInterna')) return 'Se deja constancia documentaria del traslado (relectura del movimiento): no altera stock ni costo.';
  if (tiene('emularExceso(')) {
    const cant = num(p, /emularExceso\((\d+)kg\)/);
    return 'Se simula (sin guardar) un traslado de ' + (cant || '?') + ' kg superando el disponible: el emulador debe marcar operacionRestringidaPorStockNegativo y la operación no se envía.';
  }
  if (tiene('salidaSucursal(')) {
    const cant = num(p, /salidaSucursal\((\d+)kg\)/);
    return 'La cocina consume ' + (cant || '?') + ' kg en Sucursal como gasto (merma)' + (id ? ' con id=' + id : '') + ', con el costo congelado.';
  }
  if (tiene('cuadreFaltante')) return 'La auditoría en Central declara menos físico que el sistema: se registra el faltante de 5 kg (pérdida S/ 125.00)' + (id ? ' con id=' + id : '') + ', quedando 45 kg a costo congelado.';
  if (tiene('cuadreSobrante')) return 'La auditoría en Sucursal declara más físico (8 vs 5): ingresan 3 kg con costo digitado S/ 30' + (id ? ' con id=' + id : '') + ', que revaloriza todo el stock a S/ 30.';
  if (tiene('crearOP(')) {
    const m = /crearOP\((\d+)kg\)/.exec(p) || /crearOP importado\((\d+)kg\)/.exec(p);
    return 'Se crea la Orden de Producción por ' + (m ? m[1] + ' platos' : 'platos') + ' en el almacén Producción' + (id ? ' (id=' + id + ')' : '') + ', con encargado BOT QA.';
  }
  if (tiene('sin faltantes')) return 'Se evalúa la OP de 5 platos contra 8 kg disponibles: no hay faltantes ni desvíos; el stock queda intacto.';
  if (tiene('faltante 12kg')) {
    const det = real ? ' (sistema: ' + real.stock + ' kg)' : '';
    return 'Se evalúa la OP de 20 platos contra 8 kg disponibles: se detecta un faltante de 12 kg de "Carne QA"' + det + ', que origina el desvío interno.';
  }
  if (tiene('faltante 80kg')) return 'Se evalúa la OP de 80 platos importados contra stock 0: se detecta un faltante total de 80 kg, que origina el desvío externo.';
  if (tiene('desvioInterno')) return 'Se genera la Orden de Movimiento del desvío (12 kg Central→Sucursal) a partir de la OP' + (id ? ' con id=' + id : '') + '. Activa el freno hasta su llegada.';
  if (tiene('bloquea preparación')) return 'Con la OP todavía pendiente, el sistema bloquea ejecutar la preparación: ningún insumo se descuenta.';
  if (tiene('movimientoDesvio(')) {
    const cant = num(p, /movimientoDesvio\((\d+)kg\)/);
    return 'Se ejecuta el traslado del desvío: ' + (cant || '?') + ' kg del Central a Sucursal' + (id ? ' (id=' + id + ')' : '') + ', recalculando el PPP del destino.';
  }
  if (tiene('aprobarOP')) return 'Se aprueba la Orden de Producción: pasa a estado APROBADA y libera el freno de seguridad.';
  if (tiene('freno liberado')) {
    const est = num(r.real, /estado=(\d+)/);
    return 'Se confirma la OP en estado ' + (est || 'APROBADA') + ': queda habilitada para ejecutarse (la transformación queda fuera de alcance).';
  }
  if (tiene('desvioExterno solicitud(')) {
    const cant = num(p, /solicitud\((\d+)kg\)/);
    return 'Ante el faltante sin cobertura interna, se genera la Solicitud de Compra por ' + (cant || '?') + ' kg del importado' + (id ? ' (id=' + id + ')' : '') + '. Activa el freno.';
  }
  if (tiene('OC importado(')) {
    const m = /OC importado\((\d+)@([\d.]+)\)/.exec(p);
    return 'Se pacta la OC del importado: ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'mercadería') + (id ? ' (id=' + id + ')' : '') + '.';
  }
  if (tiene('compra importado(')) {
    const m = /compra importado\((\d+)@([\d.]+)\)/.exec(p);
    return 'Se recepciona el importado: ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'mercadería') + ' en el Central' + (id ? ' (id=' + id + ')' : '') + ', liberando el freno.';
  }
  if (tiene('registrarOC-2(')) {
    const m = /OC-2\((\d+)@([\d.]+)\)/.exec(p);
    return 'Se abre la segunda OC (OC-2): ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'mercadería') + (id ? ' (id=' + id + ')' : '') + ', que se canjeará por guía.';
  }
  if (tiene('guiaCanjeOC-2(')) {
    const m = /OC-2\((\d+)@([\d.]+)\)/.exec(p);
    return 'La mercadería llega con Guía de Compra (factura después): ingresan ' + (m ? m[1] + ' kg a S/ ' + m[2] + '/kg' : 'unidades') + ' al Central' + (id ? ' (guía id=' + id + ')' : '') + ', canjeando la OC-2.';
  }
  if (tiene('trasladoLote2(')) {
    const cant = num(p, /trasladoLote2\((\d+)kg\)/);
    return 'Se traslada el segundo lote: ' + (cant || '?') + ' kg del Central a Sucursal' + (id ? ' (id=' + id + ')' : '') + ', recalculando ambos costos.';
  }
  if (tiene('requerimientoProd(')) {
    const cant = num(p, /requerimientoProd\((\d+)kg\)/);
    return 'La cocina pide ' + (cant || '?') + ' kg para preparar "Plato QA"' + (id ? ' con id=' + id : '') + ' (no para reabastecer). Sin movimiento de stock.';
  }
  if (tiene('OP canjeReq(')) {
    const cant = num(p, /canjeReq\((\d+)platos\)/);
    return 'Con stock suficiente (30 kg), el requerimiento se canjea directo en Orden de Producción por ' + (cant || '?') + ' platos' + (id ? ' (id=' + id + ')' : '') + '.';
  }
  if (tiene('OP referencia requerimiento')) {
    const req = num(r.real, /reqMovId=(\d+)/);
    return 'Se verifica que la OP quedó vinculada al requerimiento (requerimientomovimiento_id=' + (req || '?') + '). Cierra la matriz sin mover stock.';
  }
  return p;
}

// ---------------------------------------------------------------------------
// HTML (vista previa / entregable web)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parte un "stock=X; costo=Y[; costo_sin_imp=Z]" en celdas; si no parsea, va crudo a la 1.ª. */
function celdasStock(txt: string | undefined): [string, string, string] {
  const v = stockCosto(txt);
  if (!v) return [txt || '—', '—', '—'];
  return [v.stock, v.costo, v.sinImp ?? '—'];
}

export function generarHtmlReporte(reporte: FilaReporte[], resumen?: ResumenReporte): string {
  const res = resumen || resumirReporte(reporte);
  const filas = reporte
    .map((r, i) => {
      const cls = r.ok ? 'ok' : 'fail';
      const badge = r.ok ? 'Éxito' : 'Fallo';
      const e = celdasStock(r.esperado);
      const v = celdasStock(r.real);
      return (
        '      <tr class="' + cls + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="fase">' + esc(r.fase) + '</td>' +
        '<td class="paso">' + esc(r.paso) + '</td>' +
        '<td class="estado"><span class="badge ' + cls + '">' + badge + '</span></td>' +
        '<td class="num">' + esc(e[0]) + '</td>' +
        '<td class="num">' + esc(e[1]) + '</td>' +
        '<td class="num">' + esc(e[2]) + '</td>' +
        '<td class="num">' + esc(v[0]) + '</td>' +
        '<td class="num">' + esc(v[1]) + '</td>' +
        '<td class="num">' + esc(v[2]) + '</td>' +
        '<td class="error">' + esc(r.error || '') + '</td>' +
        '<td class="desc">' + esc(describirPaso(r)) + '</td>' +
        '</tr>'
      );
    })
    .join('\n');

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="es">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<style>\n' +
    '  :root { --green-bg:#dcfce7; --green-fg:#166534; --red-bg:#fee2e2; --red-fg:#991b1b; --ink:#0f172a; --muted:#64748b; }\n' +
    '  * { box-sizing:border-box; }\n' +
    '  body { font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif; color:var(--ink); margin:32px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }\n' +
    '  header { border-bottom:3px solid #0f172a; padding-bottom:12px; margin-bottom:16px; }\n' +
    '  h1 { font-size:22px; margin:0; }\n' +
    '  .sub { color:var(--muted); font-size:12px; margin-top:4px; }\n' +
    '  .cards { display:flex; gap:12px; margin:16px 0; }\n' +
    '  .card { flex:1; border-radius:12px; padding:12px 16px; background:#f1f5f9; }\n' +
    '  .card b { font-size:22px; display:block; }\n' +
    '  .card.ok { background:var(--green-bg); color:var(--green-fg); }\n' +
    '  .card.fail { background:var(--red-bg); color:var(--red-fg); }\n' +
    '  table { width:100%; border-collapse:collapse; font-size:12px; }\n' +
    '  thead th { background:#1e293b; color:#fff; text-align:center; padding:12px 8px; font-weight:700; }\n' +
    '  thead th.group { letter-spacing:1px; font-size:11px; border-bottom:1px solid #334155; }\n' +
    '  tbody td { padding:12px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; color:#334155; }\n' +
    '  tbody tr:nth-child(even) { background-color:#f9fafb; }\n' +
    '  tbody tr.ok { border-left:4px solid var(--green-fg); }\n' +
    '  tbody tr.fail { border-left:4px solid var(--red-fg); }\n' +
    '  .badge { font-weight:700; font-size:11px; white-space:nowrap; }\n' +
    '  .badge.ok { color:var(--green-fg); }\n' +
    '  .badge.fail { color:var(--red-fg); }\n' +
    '  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }\n' +
    '  td.desc, td.paso { text-align:left; }\n' +
    '  td.pre, .pre { text-align:left; word-break:break-word; font-size:11px; }\n' +
    '  pre.data { text-align:left; word-break:break-word; white-space:pre-wrap; font-size:11px; margin:0; font-family:inherit; }\n' +
    '  .fase { white-space:nowrap; font-weight:600; }\n' +
    '  .error { color:var(--red-fg); }\n' +
    '  footer { margin-top:16px; color:var(--muted); font-size:11px; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <header><h1>Reporte E2E — Bot Logística</h1><div class="sub">Generado: ' + esc(res.fecha) + ' | Total: ' + res.total + '</div></header>\n' +
    '  <div class="cards"><div class="card ok"><b>' + res.exitosos + '</b>Éxitos</div>' +
    '<div class="card fail"><b>' + res.fallidos + '</b>Fallos</div></div>\n' +
    '  <table><thead>' +
    '<tr><th rowspan="2">N°</th><th rowspan="2">Fase</th><th rowspan="2">Paso</th><th rowspan="2">Estado</th>' +
    '<th colspan="3" class="group">ESPERADO</th>' +
    '<th colspan="3" class="group">REAL</th>' +
    '<th rowspan="2">Error</th><th rowspan="2">Descripción</th></tr>' +
    '<tr><th>Stock</th><th>Costo</th><th>Sin Imp.</th>' +
    '<th>Stock</th><th>Costo</th><th>Sin Imp.</th></tr></thead>\n' +
    '  <tbody>\n' + filas + '\n  </tbody></table>\n' +
    '  <footer>logisticaview-rpa-bot · npm run test:e2e</footer>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

// ---------------------------------------------------------------------------
// PDF con PDFKit (sin navegador): misma data, colores verde/rojo por fila
// ---------------------------------------------------------------------------

const PDF = {
  title: 'Reporte E2E — Bot Logística',
  margin: 36,
  headerH: 64,
  rowPad: 6,
  fontSize: { title: 16, sub: 9, head: 7.5, cell: 7.5 },
  ink: '#0f172a',
  cellInk: '#334155',
  muted: '#64748b',
  zebra: '#f9fafb',
  greenFg: '#166534',
  redFg: '#991b1b',
  headBg: '#1e293b',
} as const;

const NUMERICAS = new Set(['num', 'eStock', 'eCosto', 'eSin', 'rStock', 'rCosto', 'rSin']);

interface Columna {
  key: 'num' | 'fase' | 'paso' | 'estado' | 'eStock' | 'eCosto' | 'eSin' | 'rStock' | 'rCosto' | 'rSin' | 'error' | 'desc';
  header: string;
  width: number; // puntos (suma = ancho útil en landscape A4 ≈ 770)
}

// Orden y anchos configurables: para añadir/quitar columnas basta editar aquí.
const COLUMNAS: Columna[] = [
  { key: 'num', header: 'N°', width: 28 },
  { key: 'fase', header: 'Fase', width: 60 },
  { key: 'paso', header: 'Paso', width: 110 },
  { key: 'estado', header: 'Est.', width: 42 },
  { key: 'eStock', header: 'Stk.E', width: 45 },
  { key: 'eCosto', header: 'Csto.E', width: 55 },
  { key: 'eSin', header: 'S/ImpE', width: 60 },
  { key: 'rStock', header: 'Stk.R', width: 45 },
  { key: 'rCosto', header: 'Csto.R', width: 55 },
  { key: 'rSin', header: 'S/ImpR', width: 60 },
  { key: 'error', header: 'Error', width: 80 },
  { key: 'desc', header: 'Descripción', width: 130 },
];

function celdaTexto(r: FilaReporte, key: Columna['key'], idx: number): string {
  if (key === 'num') return String(idx + 1);
  if (key === 'desc') return describirPaso(r);
  if (key === 'fase') return r.fase;
  if (key === 'paso') return r.paso;
  if (key === 'estado') return r.ok ? 'Éxito' : 'Fallo';
  if (key === 'eStock') return celdasStock(r.esperado)[0];
  if (key === 'eCosto') return celdasStock(r.esperado)[1];
  if (key === 'eSin') return celdasStock(r.esperado)[2];
  if (key === 'rStock') return celdasStock(r.real)[0];
  if (key === 'rCosto') return celdasStock(r.real)[1];
  if (key === 'rSin') return celdasStock(r.real)[2];
  return r.error || '';
}

function dibujarCabecera(doc: PDFKit.PDFDocument, res: ResumenReporte): void {
  doc.fillColor(PDF.ink).fontSize(PDF.fontSize.title).font('Helvetica-Bold').text(PDF.title, PDF.margin, PDF.margin);
  doc.fillColor(PDF.muted).fontSize(PDF.fontSize.sub).font('Helvetica')
    .text('Generado: ' + res.fecha + '   |   Total: ' + res.total + '   |   Éxitos: ' + res.exitosos + '   |   Fallos: ' + res.fallidos,
      PDF.margin, PDF.margin + 22);
  doc.moveTo(PDF.margin, PDF.margin + 38).lineTo(doc.page.width - PDF.margin, PDF.margin + 38)
    .strokeColor(PDF.ink).lineWidth(1.5).stroke();
}

/**
 * Doble encabezado: fila superior con grupos fusionados (ESPERADO/REAL) y
 * fila inferior con etiquetas limpias (Stock/Costo/Sin Imp.).
 */
function dibujarFilaEncabezado(doc: PDFKit.PDFDocument, y: number): number {
  const h1 = 15;
  const h2 = 15;
  const totalW = doc.page.width - PDF.margin * 2;
  doc.save();
  doc.rect(PDF.margin, y, totalW, h1 + h2).fill(PDF.headBg);
  doc.fillColor('#ffffff').font('Helvetica-Bold');
  // Fila superior: simples + grupos.
  let x = PDF.margin;
  const simple = ['num', 'fase', 'paso', 'estado'];
  const label: Record<string, string> = { num: 'N°', fase: 'Fase', paso: 'Paso', estado: 'Est.' };
  doc.fontSize(PDF.fontSize.head);
  for (const key of simple) {
    const c = COLUMNAS.find((col) => col.key === key)!;
    doc.text(label[key], x + 4, y + 4, { width: c.width - 8 });
    x += c.width;
  }
  const wGrupo = COLUMNAS.filter((c) => ['eStock', 'eCosto', 'eSin'].includes(c.key)).reduce((a, c) => a + c.width, 0);
  doc.text('ESPERADO', x, y + 4, { width: wGrupo, align: 'center' });
  x += wGrupo;
  doc.text('REAL', x, y + 4, { width: wGrupo, align: 'center' });
  x += wGrupo;
  for (const key of ['error', 'desc']) {
    const c = COLUMNAS.find((col) => col.key === key)!;
    doc.text(key === 'error' ? 'Error' : 'Descripción', x + 4, y + 4, { width: c.width - 8 });
    x += c.width;
  }
  // Fila inferior: etiquetas de las 6 columnas de valores.
  x = PDF.margin;
  doc.fontSize(PDF.fontSize.head);
  for (const c of COLUMNAS) {
    const sub: Record<string, string> = {
      eStock: 'Stock', eCosto: 'Costo', eSin: 'Sin Imp.',
      rStock: 'Stock', rCosto: 'Costo', rSin: 'Sin Imp.',
    };
    if (sub[c.key]) doc.text(sub[c.key], x + 4, y + h1 + 4, { width: c.width - 8, align: 'center' });
    x += c.width;
  }
  doc.restore();
  return y + h1 + h2;
}

function alturaFila(doc: PDFKit.PDFDocument, r: FilaReporte, idx: number): number {
  doc.fontSize(PDF.fontSize.cell).font('Helvetica');
  let max = 14;
  for (const c of COLUMNAS) {
    const h = doc.heightOfString(celdaTexto(r, c.key, idx), { width: c.width - 8 });
    if (h > max) max = h;
  }
  return max + PDF.rowPad * 2;
}

function dibujarFila(doc: PDFKit.PDFDocument, r: FilaReporte, y: number, h: number, idx: number): void {
  const totalW = doc.page.width - PDF.margin * 2;
  let x = PDF.margin;
  doc.save();
  // Zebra: blanco / gris ultra claro. Estado solo como borde izquierdo sutil.
  if (idx % 2 === 1) {
    doc.rect(PDF.margin, y, totalW, h).fill(PDF.zebra);
  }
  doc.rect(PDF.margin, y, 3, h).fill(r.ok ? PDF.greenFg : PDF.redFg);
  doc.fillColor(PDF.cellInk).fontSize(PDF.fontSize.cell).font('Helvetica');
  for (const c of COLUMNAS) {
    const txt = celdaTexto(r, c.key, idx);
    const align = NUMERICAS.has(c.key) ? 'right' : 'left';
    if (c.key === 'estado') {
      doc.fillColor(r.ok ? PDF.greenFg : PDF.redFg).font('Helvetica-Bold');
      doc.text(txt, x + 4, y + PDF.rowPad, { width: c.width - 8, align });
      doc.fillColor(PDF.cellInk).font('Helvetica');
    } else {
      doc.text(txt, x + 4, y + PDF.rowPad, { width: c.width - 8, align, lineBreak: true });
    }
    x += c.width;
  }
  // Línea divisoria tenue.
  doc.strokeColor('#e2e8f0').lineWidth(0.5)
    .moveTo(PDF.margin, y + h).lineTo(PDF.margin + totalW, y + h).stroke();
  doc.restore();
}

function dibujarPie(doc: PDFKit.PDFDocument): void {
  const y = doc.page.height - 28;
  doc.fillColor(PDF.muted).fontSize(8).font('Helvetica')
    .text('logisticaview-rpa-bot · npm run test:e2e · pág. ' + doc.bufferedPageRange().count, PDF.margin, y);
}

/** Genera el PDF del reporte. No usa navegador: funciona en cualquier entorno. */
export async function generarPdfReporte(reporte: FilaReporte[], pdfPath: string, resumen?: ResumenReporte): Promise<void> {
  const res = resumen || resumirReporte(reporte);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PDF.margin, bufferPages: true });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  dibujarCabecera(doc, res);
  let y = dibujarFilaEncabezado(doc, PDF.margin + PDF.headerH);

  reporte.forEach((r, i) => {
    const h = alturaFila(doc, r, i);
    if (y + h > doc.page.height - 40) {
      doc.addPage();
      dibujarCabecera(doc, res);
      y = dibujarFilaEncabezado(doc, PDF.margin + PDF.headerH);
    }
    dibujarFila(doc, r, y, h, i);
    y += h;
  });

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    dibujarPie(doc);
  }
  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', (e) => reject(e));
  });
}
