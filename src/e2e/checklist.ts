// checklist.ts — PDF de cobertura: procesos vs. bot (lenguaje de usuario).
// Ejecutar: npm run checklist  →  data/Checklist_Cobertura.pdf
// Solo ASCII extendido WinAnsi en celdas. Sin fecha/hora.

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

interface Fila {
  proceso: string;
  cubierto: boolean;
  detalle: string;
}

const SI: Fila[] = [
  { proceso: 'Nuevo insumo', cubierto: true, detalle: 'Se registra un insumo nuevo en el sistema para poder comprarlo y moverlo entre almacenes.' },
  { proceso: 'Nuevo consumible', cubierto: true, detalle: 'Se registra un material de empaque o uso operativo que se gasta y no se cocina.' },
  { proceso: 'Nueva receta', cubierto: true, detalle: 'Se crea un plato con su lista de ingredientes y cantidades por porcion.' },
  { proceso: 'Nueva solicitud de compra', cubierto: true, detalle: 'Un area pide mercaderia a compras. Es solo el pedido, no mueve inventario.' },
  { proceso: 'Editar solicitud de compra', cubierto: true, detalle: 'Se corrige la cantidad pedida en una solicitud antes de que se compre.' },
  { proceso: 'Nueva orden de compra', cubierto: true, detalle: 'Se pacta precio y cantidad con el proveedor. Todavia no entra mercaderia.' },
  { proceso: 'Editar orden de compra', cubierto: true, detalle: 'Se corrige el precio pactado con el proveedor antes de recibir.' },
  { proceso: 'Anular orden de compra', cubierto: true, detalle: 'Se verifica que el sistema bloquee anular una orden que ya tiene compra.' },
  { proceso: 'Canjear orden por guia de compra', cubierto: true, detalle: 'Llega la mercaderia con guia y se descuenta de la orden pactada.' },
  { proceso: 'Nueva guia de compra', cubierto: true, detalle: 'Se registra el ingreso fisico de mercaderia al almacen.' },
  { proceso: 'Editar guia de compra', cubierto: true, detalle: 'Se corrige la cantidad recibida y el sistema recalcula el costo.' },
  { proceso: 'Anular guia de compra', cubierto: true, detalle: 'Se revierte una guia registrada y el stock vuelve atras.' },
  { proceso: 'Editar compra', cubierto: true, detalle: 'Se corrige precio o cantidad de una factura y el costo se recalcula.' },
  { proceso: 'Anular compra', cubierto: true, detalle: 'Se anula la ultima compra y el costo vuelve a su valor anterior.' },
  { proceso: 'Generar nota de credito', cubierto: true, detalle: 'Se devuelve mercaderia al proveedor y el stock baja sin cambiar el costo.' },
  { proceso: 'Nuevo requerimiento de stock', cubierto: true, detalle: 'La sucursal pide mercaderia al almacen central. Es solo el pedido.' },
  { proceso: 'Nueva orden de movimiento', cubierto: true, detalle: 'El almacen central prepara y autoriza el traslado pedido.' },
  { proceso: 'Nuevo movimiento entre almacenes', cubierto: true, detalle: 'El camion se mueve: sale del central y entra a la sucursal.' },
  { proceso: 'Nueva salida de stock', cubierto: true, detalle: 'Se da de baja mercaderia por consumo, gasto o merma.' },
  { proceso: 'Cuadre manual', cubierto: true, detalle: 'Se ajusta el inventario cuando el conteo fisico no cuadra con el sistema.' },
  { proceso: 'Kardex individual (consulta)', cubierto: true, detalle: 'Se consulta el historial de movimientos y costos de un insumo.' },
];

const NO: Fila[] = [
  { proceso: 'Editar insumo', cubierto: false, detalle: 'Corregir los datos de un insumo ya creado.' },
  { proceso: 'Anular insumo', cubierto: false, detalle: 'Dar de baja un insumo del maestro.' },
  { proceso: 'Nuevo porcionable', cubierto: false, detalle: 'Registrar un insumo que se puede fraccionar.' },
  { proceso: 'Nuevo descartable', cubierto: false, detalle: 'Registrar un descartable de cocina.' },
  { proceso: 'Editar stock minimo y maximo', cubierto: false, detalle: 'Ajustar los limites de stock que disparan alertas.' },
  { proceso: 'Editar control de stock', cubierto: false, detalle: 'Activar o desactivar el control de inventario por insumo.' },
  { proceso: 'Gestion de proveedor', cubierto: false, detalle: 'Crear y mantener la ficha de proveedores.' },
  { proceso: 'Editar / anular consumible', cubierto: false, detalle: 'Corregir o dar de baja un consumible.' },
  { proceso: 'Nueva categoria', cubierto: false, detalle: 'Crear categorias para clasificar insumos.' },
  { proceso: 'Editar / anular receta', cubierto: false, detalle: 'Corregir ingredientes o dar de baja un plato.' },
  { proceso: 'Roles y capacidades', cubierto: false, detalle: 'Administrar permisos de usuarios. Fuera del alcance.' },
  { proceso: 'Aprobar / rechazar solicitud', cubierto: false, detalle: 'Aprobar o rechazar pedidos internos.' },
  { proceso: 'Canjear solicitud por orden de compra', cubierto: false, detalle: 'Convertir un pedido interno en orden al proveedor.' },
  { proceso: 'Agrupar solicitudes', cubierto: false, detalle: 'Juntar varios pedidos en uno solo.' },
  { proceso: 'Aprobar / rechazar orden de compra', cubierto: false, detalle: 'Aprobar o rechazar lo pactado con el proveedor.' },
  { proceso: 'Orden de compra por analisis de stock', cubierto: false, detalle: 'Generar ordenes automaticas por stock bajo.' },
  { proceso: 'Canjear guia por compra', cubierto: false, detalle: 'Facturar una mercaderia que llego con guia.' },
  { proceso: 'Anular nota de credito', cubierto: false, detalle: 'Revertir una devolucion al proveedor.' },
  { proceso: 'Borradores', cubierto: false, detalle: 'Guardar compras a medias para continuarlas luego.' },
  { proceso: 'Pagar compras pendientes', cubierto: false, detalle: 'Registrar pagos y cuotas a proveedores.' },
  { proceso: 'Compra rapida', cubierto: false, detalle: 'Compras menores de caja chica.' },
  { proceso: 'Orden de servicio', cubierto: false, detalle: 'Contratar servicios como mantenimiento o fumigacion.' },
  { proceso: 'Requerimientos especiales', cubierto: false, detalle: 'Pedidos por catering, menu, delivery o analisis.' },
  { proceso: 'Editar / aprobar / rechazar / anular requerimiento', cubierto: false, detalle: 'Gestionar el ciclo de un pedido entre almacenes.' },
  { proceso: 'Canjear requerimiento por movimiento', cubierto: false, detalle: 'Atender un pedido con un traslado registrado.' },
  { proceso: 'Canjear requerimiento por guia', cubierto: false, detalle: 'Atender un pedido con guia interna o de venta.' },
  { proceso: 'Guia interna (nueva / editar / anular)', cubierto: false, detalle: 'Documento interno de traslado entre locales.' },
  { proceso: 'Editar / aprobar / rechazar / anular orden de movimiento', cubierto: false, detalle: 'Gestionar la autorizacion de un traslado.' },
  { proceso: 'Canjear orden por movimiento', cubierto: false, detalle: 'Ejecutar un traslado autorizado.' },
  { proceso: 'Editar / anular movimiento', cubierto: false, detalle: 'Corregir o revertir un traslado registrado.' },
  { proceso: 'Editar / anular salida y razon', cubierto: false, detalle: 'Corregir una baja de stock o su motivo.' },
  { proceso: 'Cuadre manual ciego', cubierto: false, detalle: 'Auditoria sin mostrar el stock teorico.' },
  { proceso: 'Arqueo de inventario', cubierto: false, detalle: 'Conteo fisico y conformidad de almacen.' },
  { proceso: 'Requerimiento de produccion', cubierto: false, detalle: 'Pedir insumos para fabricar en cocina.' },
  { proceso: 'Preparar / ejecutar receta', cubierto: false, detalle: 'Cocinar y dar salida a productos terminados.' },
  { proceso: 'Abastecer requerimiento', cubierto: false, detalle: 'Atender pedidos de cocina con movimientos o guias.' },
  { proceso: 'Porcionar insumo / receta', cubierto: false, detalle: 'Fraccionar piezas o presentaciones.' },
  { proceso: 'Guia de remision (SUNAT)', cubierto: false, detalle: 'Documento tributario de traslado. Excluido a proposito.' },
  { proceso: 'Guia de venta / venta / nota de venta', cubierto: false, detalle: 'Facturacion y ventas al cliente.' },
  { proceso: 'Cambiar food cost de categoria', cubierto: false, detalle: 'Recalcular costos de toda una categoria.' },
];

const IMPORTA: Fila[] = [
  { proceso: 'Importacion de insumos (Excel)', cubierto: false, detalle: 'Carga masiva de insumos desde archivo con formato descargable.' },
  { proceso: 'Importacion de precios (Excel)', cubierto: false, detalle: 'Actualiza precios de insumos desde archivo.' },
  { proceso: 'Importacion de recetas (Excel)', cubierto: false, detalle: 'Crea platos con ingredientes desde archivo.' },
  { proceso: 'Carga masiva de ordenes (Excel)', cubierto: false, detalle: 'Valida y registra ordenes por lote con reintento.' },
  { proceso: 'Compra desde plantilla', cubierto: false, detalle: 'Reutiliza una compra guardada como modelo.' },
  { proceso: 'Compra desde canje (OC/guia)', cubierto: false, detalle: 'Arma la factura importando ordenes o guias existentes.' },
  { proceso: 'Compra desde OCR', cubierto: false, detalle: 'Genera la compra desde foto del comprobante.' },
  { proceso: 'Compra desde XML / ficheros', cubierto: false, detalle: 'Importa comprobantes electronicos y archivos a la compra.' },
  { proceso: 'Importacion de proveedores (Excel)', cubierto: false, detalle: 'Carga masiva de proveedores desde archivo.' },
  { proceso: 'Importacion de requerimientos (Excel)', cubierto: false, detalle: 'Carga pedidos entre almacenes desde archivo.' },
  { proceso: 'Importacion de ordenes de compra (Excel)', cubierto: false, detalle: 'Crea ordenes al proveedor desde archivo.' },
  { proceso: 'Importacion de ordenes de produccion (Excel)', cubierto: false, detalle: 'Carga ordenes de cocina desde archivo.' },
  { proceso: 'Preparacion manual desde archivo', cubierto: false, detalle: 'Registra preparaciones de recetas desde archivo.' },
  { proceso: 'Actualizacion masiva de recetas', cubierto: false, detalle: 'Sube archivo, valida y actualiza recetas por lote.' },
  { proceso: 'Plantillas de importacion (merma/movimiento/kardex)', cubierto: false, detalle: 'Formatos asistidos por tipo de documento.' },
  { proceso: 'Calculadora de produccion (Excel)', cubierto: false, detalle: 'Carga productos para calculo de produccion.' },
  { proceso: 'Guia de remision: importar detalle', cubierto: false, detalle: 'Completa la guia electronica con detalle importado.' },
  { proceso: 'Cuadre desde Excel', cubierto: false, detalle: 'Carga el conteo fisico desde archivo con formato catalogo.' },
  { proceso: 'Traslados desde canje', cubierto: false, detalle: 'Arma movimientos importando requerimientos, ordenes o guias.' },
  { proceso: 'Salidas desde importacion', cubierto: false, detalle: 'Genera bajas desde importaciones con control de duplicados.' },
];

function seccion(
  doc: PDFKit.PDFDocument, titulo: string, filas: Fila[],
  pos: { y: number }, colN: number, colP: number, colE: number, colD: number, baseX: number,
  amarillo = false,
): number {
  let y = pos.y;
  const W = colN + colP + colE + colD;
  const nuevaPagina = (): void => {
    doc.addPage();
    y = 36;
  };
  // Título de sección
  if (y + 30 > doc.page.height - 40) nuevaPagina();
  doc.save();
  doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold');
  doc.text(titulo + ' (' + filas.length + ')', baseX, y, { width: W });
  doc.restore();
  y += 18;
  // Encabezado
  const headH = 18;
  if (y + headH > doc.page.height - 40) nuevaPagina();
  doc.save();
  doc.rect(baseX, y, W, headH).fill('#1e293b');
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
  doc.text('N.', baseX + 4, y + 5, { width: colN - 8, align: 'center' });
  doc.text('Proceso', baseX + colN + 4, y + 5, { width: colP - 8 });
  doc.text('Bot', baseX + colN + colP + 4, y + 5, { width: colE - 8, align: 'center' });
  doc.text('Descripcion', baseX + colN + colP + colE + 4, y + 5, { width: colD - 8 });
  doc.restore();
  y += headH;
  // Filas
  let n = 1;
  for (const f of filas) {
    doc.fontSize(7.5).font('Helvetica');
    const hProc = doc.heightOfString(f.proceso, { width: colP - 8 });
    const hDet = doc.heightOfString(f.detalle, { width: colD - 8 });
    const h = Math.max(hProc, hDet, 10) + 8;
    if (y + h > doc.page.height - 40) {
      nuevaPagina();
      // repetir encabezado
      doc.save();
      doc.rect(baseX, y, W, headH).fill('#1e293b');
      doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
      doc.text('N.', baseX + 4, y + 5, { width: colN - 8, align: 'center' });
      doc.text('Proceso', baseX + colN + 4, y + 5, { width: colP - 8 });
      doc.text('Bot', baseX + colN + colP + 4, y + 5, { width: colE - 8, align: 'center' });
      doc.text('Descripcion', baseX + colN + colP + colE + 4, y + 5, { width: colD - 8 });
      doc.restore();
      y += headH;
    }
    doc.save();
    if (amarillo) {
      if (n % 2 === 0) doc.rect(baseX, y, W, h).fill('#fef9c3');
      doc.rect(baseX, y, 3, h).fill('#eab308');
    } else {
      if (n % 2 === 0) doc.rect(baseX, y, W, h).fill('#f9fafb');
      doc.rect(baseX, y, 3, h).fill(f.cubierto ? '#166534' : '#991b1b');
    }
    doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
    doc.text(String(n), baseX + 4, y + 4, { width: colN - 8, align: 'center' });
    doc.text(f.proceso, baseX + colN + 4, y + 4, { width: colP - 8 });
    doc.fillColor(f.cubierto ? '#166534' : '#991b1b').font('Helvetica-Bold');
    doc.text(f.cubierto ? 'SI' : 'NO', baseX + colN + colP + 4, y + 4, { width: colE - 8, align: 'center' });
    doc.fillColor('#334155').font('Helvetica');
    doc.text(f.detalle, baseX + colN + colP + colE + 4, y + 4, { width: colD - 8 });
    doc.restore();
    y += h;
    n++;
  }
  pos.y = y + 14;
  return pos.y;
}

async function main(): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  const out = path.resolve('data', 'Checklist_Cobertura.pdf');
  const stream = fs.createWriteStream(out);
  doc.pipe(stream);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', (e) => reject(e));
  });

  const W = doc.page.width - 72;
  const colN = 32;
  const colE = 42;
  const colD = 300;
  const colP = W - colN - colE - colD;

  doc.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold')
    .text('Cobertura RPA: procesos vs. bot', 36, 36);
  doc.fillColor('#64748b').fontSize(9).font('Helvetica')
    .text('SI = automatizado  -  NO = sin cobertura', 36, 58);

  const pos = { y: 84 };
  seccion(doc, 'Automatizados por el bot', SI, pos, colN, colP, colE, colD, 36);
  seccion(doc, 'Sin cobertura', NO, pos, colN, colP, colE, colD, 36);
  seccion(doc, 'Importaciones mapeables por el bot', IMPORTA, pos, colN, colP, colE, colD, 36, true);

  doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold')
    .text('Cubiertos: ' + SI.length + ' / ' + (SI.length + NO.length), 36, pos.y);

  doc.end();
  await done;
  console.log('PDF generado: ' + out);
}

main().catch((e) => { console.error(e); process.exit(1); });
