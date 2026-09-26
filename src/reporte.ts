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
// HTML (vista previa / entregable web)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generarHtmlReporte(reporte: FilaReporte[], resumen?: ResumenReporte): string {
  const res = resumen || resumirReporte(reporte);
  const filas = reporte
    .map((r, i) => {
      const cls = r.ok ? 'ok' : 'fail';
      const badge = r.ok ? 'Éxito' : 'Fallo';
      return (
        '      <tr class="' + cls + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="fase">' + esc(r.fase) + '</td>' +
        '<td class="paso">' + esc(r.paso) + '</td>' +
        '<td class="estado"><span class="badge ' + cls + '">' + badge + '</span></td>' +
        '<td>' + esc(r.esperado || '—') + '</td>' +
        '<td>' + esc(r.real || '—') + '</td>' +
        '<td class="error">' + esc(r.error || '') + '</td>' +
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
    '  thead th { background:#0f172a; color:#fff; text-align:left; padding:10px 8px; }\n' +
    '  tbody td { padding:8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }\n' +
    '  tr.ok { background-color:var(--green-bg); }\n' +
    '  tr.fail { background-color:var(--red-bg); }\n' +
    '  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-weight:700; font-size:11px; }\n' +
    '  .badge.ok { background:var(--green-fg); color:#fff; }\n' +
    '  .badge.fail { background:var(--red-fg); color:#fff; }\n' +
    '  .fase { white-space:nowrap; font-weight:600; }\n' +
    '  .error { color:var(--red-fg); }\n' +
    '  footer { margin-top:16px; color:var(--muted); font-size:11px; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <header><h1>Reporte E2E — Bot Logística</h1><div class="sub">Generado: ' + esc(res.fecha) + ' | Total: ' + res.total + '</div></header>\n' +
    '  <div class="cards"><div class="card ok"><b>' + res.exitosos + '</b>Éxitos</div>' +
    '<div class="card fail"><b>' + res.fallidos + '</b>Fallos</div></div>\n' +
    '  <table><thead><tr><th>N°</th><th>Fase</th><th>Paso</th><th>Estado</th><th>Esperado</th><th>Real</th><th>Error</th></tr></thead>\n' +
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
  rowPad: 5,
  fontSize: { title: 16, sub: 9, head: 8, cell: 7.5 },
  ink: '#0f172a',
  muted: '#64748b',
  greenBg: '#dcfce7',
  greenFg: '#166534',
  redBg: '#fee2e2',
  redFg: '#991b1b',
  headBg: '#0f172a',
} as const;

interface Columna {
  key: 'num' | 'fase' | 'paso' | 'estado' | 'esperado' | 'real' | 'error';
  header: string;
  width: number; // puntos (suma = ancho útil en landscape A4 ≈ 770)
}

// Orden y anchos configurables: para añadir/quitar columnas basta editar aquí.
const COLUMNAS: Columna[] = [
  { key: 'num', header: 'N°', width: 34 },
  { key: 'fase', header: 'Fase', width: 90 },
  { key: 'paso', header: 'Paso', width: 200 },
  { key: 'estado', header: 'Estado', width: 52 },
  { key: 'esperado', header: 'Esperado', width: 130 },
  { key: 'real', header: 'Real', width: 130 },
  { key: 'error', header: 'Error', width: 134 },
];

function celdaTexto(r: FilaReporte, key: Columna['key'], idx: number): string {
  if (key === 'num') return String(idx + 1);
  if (key === 'fase') return r.fase;
  if (key === 'paso') return r.paso;
  if (key === 'estado') return r.ok ? 'Éxito' : 'Fallo';
  if (key === 'esperado') return r.esperado || '—';
  if (key === 'real') return r.real || '—';
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

function dibujarFilaEncabezado(doc: PDFKit.PDFDocument, y: number): number {
  const h = 18;
  let x = PDF.margin;
  doc.save();
  doc.rect(PDF.margin, y, doc.page.width - PDF.margin * 2, h).fill(PDF.headBg);
  doc.fillColor('#ffffff').fontSize(PDF.fontSize.head).font('Helvetica-Bold');
  for (const c of COLUMNAS) {
    doc.text(c.header, x + 4, y + 5, { width: c.width - 8, ellipsis: true });
    x += c.width;
  }
  doc.restore();
  return y + h;
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
  const bg = r.ok ? PDF.greenBg : PDF.redBg;
  let x = PDF.margin;
  doc.save();
  doc.rect(PDF.margin, y, doc.page.width - PDF.margin * 2, h).fill(bg);
  doc.fillColor(PDF.ink).fontSize(PDF.fontSize.cell).font('Helvetica');
  for (const c of COLUMNAS) {
    const txt = celdaTexto(r, c.key, idx);
    if (c.key === 'estado') {
      doc.fillColor(r.ok ? PDF.greenFg : PDF.redFg).font('Helvetica-Bold');
      doc.text(txt, x + 4, y + PDF.rowPad, { width: c.width - 8 });
      doc.fillColor(PDF.ink).font('Helvetica');
    } else {
      doc.text(txt, x + 4, y + PDF.rowPad, { width: c.width - 8 });
    }
    x += c.width;
  }
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
