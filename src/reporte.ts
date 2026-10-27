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
  pendientes: number;
  total: number;
  fecha: string;
}

export function resumirReporte(reporte: FilaReporte[]): ResumenReporte {
  // Los flujos stub (pendientes) NO son successes: no se ejecutaron, así que
  // no pueden inflar el verde ni contarse como fallos del ERP.
  const pendientes = reporte.filter((r) => r.pendiente).length;
  const ejecutadas = reporte.filter((r) => !r.pendiente);
  const exitosos = ejecutadas.filter((r) => r.ok).length;
  const fallidos = ejecutadas.length - exitosos;
  return { exitosos, fallidos, pendientes, total: reporte.length, fecha: new Date().toLocaleString() };
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
  // Acepta las dos convenciones: "costo_sin_imp=" (Bloques 1-8) y "sinImp=" (flujos F1-F13).
  const m = /stock=([-\d.]+);\s*costo=([-\d.]+)(?:;\s*(?:costo_sin_imp|sinImp|costosinimpuesto)=([-\d.]+))?/.exec(txt);
  return m ? { stock: m[1], costo: m[2], sinImp: m[3] ?? null } : null;
}

/**
 * Capa ejercitada por cada fila:
 *  - `FRONT->API`: el bot maneja la vista (controlador AngularJS) y la llamada
 *    llega al backend REST; el veredicto dice si el backend aceptó y calculó bien.
 *  - `API/BD`: el bot lee el estado autoritativo (endpoint `obtenerStockYCosto`
 *    o SQL) y compara contra la fórmula esperada.
 *  - `NO EJECUTADO`: flujo stub (F6-F13), sin ejecución real todavía.
 */
export function capaDe(r: FilaReporte): string {
  const p = r.paso;
  // El flag `pendiente` es la fuente de verdad (lo emite el flujo stub).
  if (r.pendiente) return 'NO EJECUTADO';
  if (/^F1[0-2]\./.test(p)) return 'NO EJECUTADO';
  if (
    /assert|validar|verificar|auditar|precondici|obtenerEstadoGlobal|kardex|baseline|c72=|c106=|flags restaurados|post-restore|OP referencia|referencia requerimiento/i.test(
      p,
    )
  ) {
    return 'API/BD';
  }
  return 'FRONT->API';
}

/** Datos de cada flujo de Compras: alimentan la columna Descripción del reporte. */
const FLUJOS_COMPRAS: Record<string, { titulo: string; detalle: string; efecto: string }> = {
  F1: { titulo: 'Solicitud → OC → Compra (canje clásico, afecto con IGV)', detalle: '50 kg de "Carne QA" a S/ 20/kg', efecto: '' },
  F2: { titulo: 'Solicitud → OC → Guía → Compra (físico anticipado)', detalle: '30 kg de "Carne QA" a S/ 22/kg', efecto: '' },
  F3: { titulo: 'OC manual → Compra (sin solicitud)', detalle: '100 kg de "Arroz QA" a S/ 4/kg', efecto: '' },
  F4: { titulo: 'Compra directa (sin documentos previos)', detalle: '50 kg de "Carne QA" a S/ 30/kg', efecto: '' },
  F5: { titulo: 'Compra exonerada (sin IGV)', detalle: '10 kg de "Verdura QA" a S/ 10/kg', efecto: '' },
  F6: {
    titulo: 'Nota de Crédito por cantidad (devolución)',
    detalle: '10 kg sobre la compra de F4',
    efecto: 'SÍ mueve el stock: SALIDA_NOTA_CREDITO_COMPRA, Central 130 -> 120 kg con el PPP congelado en 24.308.',
  },
  F7: {
    titulo: 'Nota de Crédito por precio (rebaja)',
    detalle: '10 kg de "Verdura QA" con descuento',
    efecto: 'NO mueve el stock: clona la línea con nuevoCosto 8.00 y marca el origen como fueeliminado; el stock queda en 10 kg con PPP 8.000.',
  },
  F8: {
    titulo: 'Modificar compra (hacia adelante)',
    detalle: 'la compra de F3 (100 kg de Arroz QA)',
    efecto: 'SÍ cambia el costo: la cantidad no se mueve (100 kg) pero el PPP se re-promedia hacia adelante (4.000 -> 5.000) y los impuestos se re-desgravan.',
  },
  F9: {
    titulo: 'Anular compra (LIFO, con devolución de stock)',
    detalle: 'la compra modificada en F8',
    efecto: 'SÍ mueve el stock: contra-salidas que devuelven las 100 kg de Arroz QA y restauran el PPP previo; además desvincula la OC (queda APROBADO) y anula sus NC.',
  },
  F10: {
    titulo: 'OC distribuida multi-local',
    detalle: 'una OC y dos destinos',
    efecto: 'SÍ mueve el stock: la guía de cada local prorratea la cantidad y el precio (round(importe/cant x cantLocal)), generando entradas en los dos almacenes.',
  },
  F11: {
    titulo: 'Crédito + cuotas + amortización',
    detalle: 'Arroz 200 kg a S/ 4/kg al crédito',
    efecto: 'NO mueve el stock (solo CxP, cuotas y límite de crédito del proveedor).',
  },
  F12: {
    titulo: 'Compra de servicio + compra rápida (sin Kardex)',
    detalle: 'intangible + caja chica',
    efecto: 'NO debe mover el stock: cero ENTRADA_* en el Kardex; solo egreso/CxP y el detalle de la compra manual.',
  },
  F13: {
    titulo: 'Consumible y producto de reventa',
    detalle: 'Caja de Empaque 200 u @ 0.5 y Gaseosa',
    efecto: 'SÍ mueve el stock: el consumible va a la tabla espejo (0 -> 200 u, PPP 0.500; la salida de 50 lo deja en 150 con el costo congelado); el producto Pack x 6 convierte 12 packs a 72 unidades; el producto sin control de stock no genera movimiento.',
  },
  F14: {
    titulo: 'Calculadora de produccion (sin Kardex)',
    detalle: 'genera OC desde los faltantes de MRP',
    efecto: 'NO mueve el stock: exige local de produccion y un faltante real (stock bajo el minimo o requerimiento MRP con cantidadFaltante > 0).',
  },
  F15: {
    titulo: 'Compra multi-documento (2 OCs + 1 guia parcial)',
    detalle: 'una sola compra consolida 2 OCs y una guia parcial',
    efecto: 'SÍ mueve el stock: consolida en un solo documento con precio promedio ponderado (round(total/cant,4)) y deja las OCs en PROCESADA/ENPROCESO.',
  },
  F16: {
    titulo: 'Canjes parciales (guia parcial + compra del saldo)',
    detalle: 'OC de 100 kg: guia de 40 y compra de 60',
    efecto: 'SÍ mueve el stock: la guia parcial deja la OC en ENPROCESO y la compra del saldo la cierra en PROCESADA; la suma de lo canjeado (40 + 60 = 100) cierra contra el importe de la OC.',
  },
  F17: {
    titulo: 'Cargos y descuentos (flete, ICBPer, percepcion)',
    detalle: 'Arroz 100 kg @ 4 con descuento de item, global y flete 50',
    efecto: 'SÍ cambia el costo: el flete entra al costo (y al PPP) pero NO al costo sin impuestos (bug F30-1); la percepcion no suma al total y la retencion resta al pagable.',
  },
  F18: {
    titulo: 'Multi-moneda (compra en dolares)',
    detalle: '100 kg a 2.00 USD/kg con TC 3.80',
    efecto: 'SÍ mueve el stock: el Kardex se valora en soles (costoTC = 2.00 x 3.80 = 7.60) y el ultimo precio por moneda no se mezcla con el de soles.',
  },
  F19: {
    titulo: 'Precio neto (impuestos NO incluidos en el precio)',
    detalle: '50 kg de "Carne QA" a 16.949 neto',
    efecto: 'SÍ cambia el costo: el backend genera el IGV encima del precio neto (847.45 + 18% = 1000.00) y el Kardex se valoriza con el precio bruto (20.00).',
  },
  F20: {
    titulo: 'Pago mixito + caja + retenciones',
    detalle: 'contado parcial + credito, efectivo y tarjeta',
    efecto: 'NO mueve el stock: asienta egresos, cuotas y retenciones; al anular se revierten los egresos (ingreso reverso).',
  },
  F21: {
    titulo: 'Merma automatica al comprar (Pollo QA 5%)',
    detalle: '100 kg a 10 con merma automatica del 5%',
    efecto: 'SÍ mueve el stock: el backend encarece el costo (1000 / 95 = 10.5263), registra la ENTRADA de 100 kg y una SALIDA de merma de 5 kg, y el PPP promedia sobre las unidades NETAS (denominador S+95).',
  },
  F22: {
    titulo: 'Fusion de solicitudes (3 solicitudes -> 1 OC)',
    detalle: 'tres solicitudes del mismo item y proveedor',
    efecto: 'NO mueve el stock: consolida las cantidades en una OC (precio re-escrito al ultimo de compra) con el pivote de trazabilidad de las 3 solicitudes.',
  },
  F23: {
    titulo: 'Fusion de OCs (3 OCs -> 1 guia/compra)',
    detalle: 'OC-A 20@20 + OC-B 30@22 + OC-C 40@4',
    efecto: 'SÍ mueve el stock: consolida las 3 OCs con precio promedio ponderado (Carne 50 u a 21.20) y deja las OCs en PROCESADA.',
  },
  F24: {
    titulo: 'OC en dolares y su compra',
    detalle: 'OC de 50 kg a 2.00 USD con TC 3.80',
    efecto: 'SÍ mueve el stock: el Kardex se valora en soles (costoTC 7.60, sinTC 6.441) y el importe de la OC queda en dolares (100 USD).',
  },
  F25: {
    titulo: 'Mismo insumo en soles y dolares',
    detalle: '50 kg a 7.60 soles y luego 50 kg a 2.00 USD',
    efecto: 'SÍ mueve el stock: el PPP promedia ambas monedas en soles y el ultimo precio por moneda NO se mezcla entre monedas.',
  },
  F26: {
    titulo: 'Flete + tipo de cambio combinados',
    detalle: '100 kg a 2.00 USD con flete de 76 soles',
    efecto: 'SÍ cambia el costo: costoFinal = 7.60 + 0.76 = 8.36 y el sin-impuestos NO incluye el flete (bug F30-1).',
  },
};

/** Explicación de un paso de los flujos de Compras (F1-F13). */
function describirFlujoCompras(p: string, r: FilaReporte): string | null {
  const m = /^F(\d+)\.([a-z]+)$/.exec(p);
  if (!m) return null;
  const fid = 'F' + m[1];
  const acc = m[2];
  const f = FLUJOS_COMPRAS[fid];
  const titulo = f ? f.titulo : 'Flujo de Compras';
  const detalle = f ? f.detalle : '';
  const id = num(r.real, /id=(\d+)/);

  // Solo si el flujo viene marcado como pendiente (stub) se anuncia como tal.
  if (r.pendiente) {
    return (
      'PENDIENTE (stub): el flujo ' + fid + ' (' + titulo + ') tiene el análisis matemático implementado en ' +
      'src/e2e/compras/analisis/, pero aún no se ejecuta contra la app, así que NO hay verificación de stock ni de costo. ' +
      'Lo que debe comprobar: ' + (f ? f.efecto : 'el efecto sobre el Kardex y el PPP.') +
      (id ? ' Referencia del documento: id=' + id + '.' : '')
    );
  }
  switch (fid) {
    case 'F6':
      if (acc === 'nc') {
        return 'Se registra la Nota de Crédito POR CANTIDAD sobre la compra de F4: 10 kg de "Carne QA"' +
          (id ? ' (NC id=' + id + ')' : '') + '. El backend genera la SALIDA_NOTA_CREDITO_COMPRA: baja el stock y CONGELA el PPP (una salida no promedia).';
      }
      break;
    case 'F7':
      if (acc === 'nc') {
        return 'Se registra la Nota de Crédito POR PRECIO (rebaja de S/ 2 por unidad) sobre la compra de F5: 10 kg de "Verdura QA"' +
          (id ? ' (NC id=' + id + ')' : '') + '. El backend clona la ENTRADA_COMPRA origen con nuevoCosto 8.00 y la marca fueeliminado: NO sale stock, el costo baja.';
      }
      break;
    case 'F8':
      if (acc === 'modificar') {
        return 'Se modifica la compra de F3 (100 kg de "Arroz QA" de S/ 4 a S/ 5 por unidad)' +
          (id ? ' (compra id=' + id + ')' : '') + ': la cantidad no se mueve, el PPP se re-promedia hacia adelante y los impuestos se re-desgravan.';
      }
      break;
    case 'F9':
      if (acc === 'anular') {
        return 'Se anula (LIFO) la compra modificada en F8 con devolución de stock' +
          (id ? ' (compra id=' + id + ')' : '') + ': el stock vuelve al valor previo y el PPP se restaura; la OC queda desvinculada (APROBADO).';
      }
      break;
    case 'F10':
      if (acc === 'distribuida') {
        return 'Se canjean juntas dos solicitudes (10 kg del local 1 y 20 kg del local 2) con "Activar distribución por local" = SÍ' +
          (id ? ' (OC id=' + id + ')' : '') + ': el backend crea 1 OC consolidada de 30 kg y una fila de distribución por local (10 + 20); la guía de cada local prorratea cantidad y precio.';
      }
      break;
    case 'F11':
      if (acc === 'credito') {
        return 'Se registra la compra AL CRÉDITO de 200 kg de "Arroz QA" (S/ 800) en 2 cuotas de S/ 400' +
          (id ? ' (compra id=' + id + ')' : '') + ': la mercadería entra igual al stock, pero el backend genera el CxP (una fila por cuota) y descuenta el límite de crédito del proveedor.';
      }
      break;
    case 'F12':
      if (acc === 'servicio') {
        return 'Se registra una compra de SERVICIO (intangible, "Fumigación QA" a S/ 100 con un producto de reventa)' +
          (id ? ' (compra id=' + id + ')' : '') + ': el backend nunca llama ENTRADA_COMPRA, así que el servicio NO debe mover el Kardex (solo el consumo de sus consumibles, vía SALIDA_COMPRA_SERVICIO).';
      }
      break;
    case 'F13':
      if (acc === 'consumible') {
        return 'Consumible y producto de reventa: el consumible se compra a través de la TABLA ESPEJO del Kardex (200 u a S/ 0.5) y sale 50 u (queda en 150 con el costo congelado); el producto de reventa compra 12 packs (Pack x6 = 72 unidades) y el producto sin control de stock no genera movimiento.';
      }
      break;
    default:
      break;
  }
  switch (acc) {
    case 'solicitud':
      return 'Se crea la Solicitud de Compra de ' + detalle + ' (documento de intención: no mueve inventario)' + (id ? ' (id=' + id + ')' : '') + '.';
    case 'oc':
      return 'Se pacta la Orden de Compra de ' + detalle + (id ? ' (id=' + id + ')' : '') + ': la OC no mueve stock, solo fija el compromiso.';
    case 'guia':
      return 'Se registra la Guía de Compra de ' + detalle + (id ? ' (guía id=' + id + ')' : '') + ': la guía sí ingresa la mercadería al Kardex (ENTRADA_GUIA).';
    case 'compra':
      return 'Se registra la Compra de ' + detalle + (id ? ' (compra id=' + id + ')' : '') + ': es el documento contable (desgravación de IGV, CxP) y el que hace la entrada de stock cuando no hay guía.';
    case 'nc':
      return 'Nota de crédito de ' + detalle + ': descuenta cantidad (congelando el PPP) o clona la línea con costo rebajado.';
    case 'modificar':
      return 'Se modifica ' + detalle + ': el ERP re-proyecta el PPP hacia adelante y re-desgrava los impuestos.';
    case 'anular':
      return 'Se anula ' + detalle + ': contra-saldas que devuelven el stock y restauran el PPP previo.';
    case 'distribuida':
      return 'OC distribuida: una sola OC reparte cantidades entre varios locales y genera una fila por destino.';
    case 'credito':
      return 'Compra al crédito con cuotas: genera CxP, amortiza y afecta el límite de crédito del proveedor.';
    case 'servicio':
      return 'Compra de servicio (intangible) y compra rápida: asientan egreso/CxP sin tocar el Kardex.';
    case 'consumible':
      return 'Consumible (tabla espejo de Kardex) y producto de reventa: se verifica la doble vía del stock.';
    default:
      return 'Paso del flujo ' + fid + ' (' + titulo + ').';
  }
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

  // --- Flujos de Compras (F1-F13) -------------------------------------------
  const flujoCompras = describirFlujoCompras(p, r);
  if (flujoCompras) return flujoCompras;
  if (tiene('assertUltimaSalida(')) {
    return 'Se verifica que la última movimiento del Kardex sea la SALIDA de la nota de crédito (tipo 0, la cantidad devuelta y costo 0): una salida no promedia, congela el PPP.';
  }
  if (tiene('assertSinMovimientosVivos(')) {
    return 'Se verifica el efecto real de la anulación con devolución de stock: la entrada de la compra queda marcada fueeliminado=SI y no sobreviven movimientos vivos (el backend regulariza los saldos).';
  }
  if (tiene('assertSinMovimientoProducto(')) {
    return 'Se verifica que el producto SIN control de stock no generó movimiento en el Kardex: el backend corta el ingreso (early return) aunque la compra sí queda registrada.';
  }
  if (tiene('F8.desgravacion')) {
    return 'Se audita la desgravación del detalle modificado: el costo sin IGV se recalcula con el precio nuevo (5/1.18) y el subtotal sin impuestos debe cuadrar.';
  }
  if (tiene('F9.ocDesvinculada')) {
    return 'Se verifica que la OC quedara desvinculada de la compra anulada (compra_id vacío) y en estado APROBADO, es decir recanjeable.';
  }
  if (tiene('F13.espejo200')) {
    return 'Se comprueba en la TABLA ESPEJO (movimientoalmacenconsumible) que el consumible "Caja Empaque QA" tenga 200 unidades a S/ 0.5 tras la compra.';
  }
  if (tiene('F13.espejo150')) {
    return 'Se comprueba en la tabla espejo que la salida de 50 unidades deje el consumible en 150 con el costo congelado en S/ 0.5 (la salida no promedia).';
  }
  if (tiene('F13.producto72')) {
    return 'Se verifica la conversión de la presentación de compra del producto: 12 packs × 6 unidades = 72 unidades en UM base y el costo unitario es el precio del pack dividido entre 6 (3.00/6 = 0.5).';
  }
  if (tiene('F13.compraSinControl')) {
    return 'Se registra la compra del producto SIN control de stock: el documento se crea pero el inventario no debe moverse.';
  }
  if (tiene('F13.salida50')) {
    return 'Sale el consumible como gasto operativo (merma): 50 unidades del Almacén Principal con el costo congelado.';
  }
  if (tiene('F13.compraConsumible')) {
    return 'Se compra el consumible "Caja Empaque QA": 200 unidades a S/ 0.5 con el Kardex en la tabla espejo.';
  }
  if (tiene('F13.compraProducto')) {
    return 'Se compra el producto de reventa "Gaseosa QA" en su presentación Pack.';
  }
  if (tiene('assertStock(')) {
    const n = num(p, /assertStock\("([^"]+)"/) || 'insumo';
    const donde = almacen ? ' en el almacén ' + almacen : '';
    if (esp) {
      const eSin = esp.sinImp !== null ? ' y S/ ' + esp.sinImp + ' sin impuestos' : '';
      const rSin = real && real.sinImp !== null ? ' y S/ ' + real.sinImp + ' sin impuestos' : '';
      return 'Se verifica que "' + n + '"' + donde + ' tenga ' + esp.stock + ' kg a S/ ' + esp.costo + ' de costo promedio' + eSin + (real ? '; el Kardex devuelve ' + real.stock + ' kg a S/ ' + real.costo + rSin : '') + '.';
    }
    return 'Se verifica el stock y costo de "' + n + '"' + donde + '.';
  }
  if (tiene('assertTotales(')) {
    const c = num(p, /assertTotales\(compra=(\d+)\)/);
    return 'Se auditan los totales de la compra (subtotal / IGV / total) contra la fórmula del bot' + (c ? ' (compra id=' + c + ')' : '') + '.';
  }
  if (tiene('assertKardex(')) {
    const c = num(p, /assertKardex\(insumo=(\d+), alm=(\d+)\)/);
    return 'Se audita la última fila del Kardex del ítem' + (c ? ' (insumo id=' + c[1] + ', almacén id=' + c[2] + ')' : '') + ': stock anterior, cantidad, costo operación, PPP y nuevo saldo.';
  }

  if (tiene('obtenerEstadoGlobal')) return 'Se consulta el estado global del Kardex para fijar el punto de partida de la validación del bloque.';
  if (tiene('precondición')) return 'Se verifica que el bloque anterior dejó el estado exacto que este bloque necesita antes de operar.';
  if (tiene('precondición existencia')) return 'Se verifica que existen los maestros Carne QA, Exonerado QA y Caja de Empaque QA para el contraste.';
  if (tiene('36. baseline')) return 'Se captura el baseline del entorno (configs 72 y 106) como referencia para los toggles y la restauración.';
  if (tiene('37. c72=1')) return 'Con display sin-impuestos activo, se verifica que el campo costo refleja el valor sin impuestos' + (real ? ' (' + real + ')' : '') + '.';
  if (tiene('38. c106=1: costo==última-compra')) return 'Con display de última compra activo, se verifica que el campo costo refleja la última entrada' + (real ? ' (' + real + ')' : '') + '.';
  if (tiene('38. c106=1: sin-imp sigue expuesto')) return 'Se verifica que el costo sin impuestos sigue exponiéndose en paralelo aunque cambie el display.';
  if (tiene('39. flags restaurados')) return 'Se restauran los flags 72/106 a su baseline en bloque finally, garantizando un entorno consistente.';
  if (tiene('40. editarCompra importado')) return 'Se edita el precio de la compra del importado (80@15 → 80@18): al ser entrada única, el PPP queda en S/ 18 exacto.';
  if (tiene('41. editarGuia-2')) return 'Se edita la cantidad de la guía-2 (30@22 → 20@22): el sistema revierte la entrada y la re-aplica, recalculando el PPP hacia adelante.';
  if (tiene('42. editarOC-2')) return 'Se edita el precio pactado de la OC-2 (22 → 25): solo cambia el pacto, sin tocar stock ni Kardex.';
  if (tiene('42. auditarOC')) return 'Se verifica que el pacto actualizado quedó persistido (importe S/ 750) en el detalle de la OC.';
  if (tiene('43. editarSolicitud')) return 'Se edita la cantidad de la solicitud (50 → 40 kg): documento sin Kardex, solo cambia el pedido.';
  if (tiene('43. verificarSolicitud')) return 'Se relee la solicitud y se confirma la cantidad actualizada' + (real ? ' (' + real + ')' : '') + '.';
  if (tiene('44. editarCompra cantidad 0')) return 'Se intenta editar una compra con cantidad cero: el sistema debe bloquearla por validación de detalle, sin mover stock.';
  if (tiene('45. editarCompra anulada')) return 'Se intenta editar una compra ya anulada: el sistema debe bloquearla por estado, sin mover stock.';
  if (tiene('post-restore')) return 'Tras restaurar, se confirma que el display volvió a los valores del baseline.';
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

/**
 * Descripción final de la fila: capa ejercitada (frente vs API/BD) + la
 * explicación del paso + los valores crudos que no son de stock (totales de
 * compra, ids de documento, literales de bloqueo).
 */
export function descripcionFila(r: FilaReporte): string {
  const base = describirPaso(r);
  const crudo: string[] = [];
  if (r.esperado && !stockCosto(r.esperado) && base.indexOf(r.esperado) < 0) {
    crudo.push('esperado: ' + r.esperado);
  }
  if (r.real && !stockCosto(r.real) && base.indexOf(r.real) < 0) {
    crudo.push('real: ' + r.real);
  }
  const extra = crudo.length ? ' [' + crudo.join(' | ') + ']' : '';
  return '[' + capaDe(r) + '] ' + base + extra;
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

/** Parte un "stock=X; costo=Y[; sinImp=Z]" en celdas; si no parsea, deja las 3 vacías. */
function celdasStock(txt: string | undefined): [string, string, string] {
  const v = stockCosto(txt);
  if (!v) return ['—', '—', '—'];
  return [v.stock, v.costo, v.sinImp ?? '—'];
}

/** Agrupa las filas por fase (flujo/bloque) conservando el orden de ejecución. */
export function agruparPorFase(reporte: FilaReporte[]): Array<{ fase: string; filas: FilaReporte[] }> {
  const grupos: Array<{ fase: string; filas: FilaReporte[] }> = [];
  for (const r of reporte) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fase === r.fase) ultimo.filas.push(r);
    else grupos.push({ fase: r.fase, filas: [r] });
  }
  return grupos;
}

export function generarHtmlReporte(reporte: FilaReporte[], resumen?: ResumenReporte): string {
  const res = resumen || resumirReporte(reporte);
  const filas = reporte
    .map((r, i) => {
      const cls = r.pendiente ? 'pend' : r.ok ? 'ok' : 'fail';
      const badge = r.pendiente ? 'Pendiente' : r.ok ? 'Éxito' : 'Fallo';
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
        '<td class="desc">' + esc(descripcionFila(r)) + '</td>' +
        '</tr>'
      );
    })
    .join('\n');

  // Resumen por flujo: una fila por fase con su propio conteo.
  const resumenFlujos = agruparPorFase(reporte)
    .map((g) => {
      const pend = g.filas.filter((f) => f.pendiente).length;
      const ok = g.filas.filter((f) => f.ok && !f.pendiente).length;
      const fail = g.filas.length - ok - pend;
      const cls = fail > 0 ? 'fail' : 'ok';
      return (
        '      <tr class="' + cls + '">' +
        '<td class="fase">' + esc(g.fase) + '</td>' +
        '<td class="num">' + g.filas.length + '</td>' +
        '<td class="num">' + ok + '</td>' +
        '<td class="num">' + fail + '</td>' +
        '<td class="num">' + pend + '</td>' +
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
    '  :root { --green-bg:#dcfce7; --green-fg:#166534; --red-bg:#fee2e2; --red-fg:#991b1b; --amber-bg:#fef3c7; --amber-fg:#92400e; --ink:#0f172a; --muted:#64748b; }\n' +
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
    '  .card.pend { background:var(--amber-bg); color:var(--amber-fg); }\n' +
    '  table { width:100%; border-collapse:collapse; font-size:12px; }\n' +
    '  thead th { background:#1e293b; color:#fff; text-align:center; padding:12px 8px; font-weight:700; }\n' +
    '  thead th.group { letter-spacing:1px; font-size:11px; border-bottom:1px solid #334155; }\n' +
    '  tbody td { padding:12px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; color:#334155; }\n' +
    '  tbody tr:nth-child(even) { background-color:#f9fafb; }\n' +
    '  tbody tr.ok { border-left:4px solid var(--green-fg); }\n' +
    '  tbody tr.fail { border-left:4px solid var(--red-fg); }\n' +
    '  .badge { font-weight:700; font-size:11px; white-space:nowrap; }\n' +
    '  .badge.ok { color:var(--green-fg); }\n' +
    '  .badge.pend { color:var(--amber-fg); }\n' +
    '  tbody tr.pend { border-left:4px solid var(--amber-fg); }\n' +
    '  .badge.fail { color:var(--red-fg); }\n' +
    '  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }\n' +
    '  h2 { font-size:14px; margin:22px 0 8px; text-transform:uppercase; letter-spacing:1px; color:#334155; }\n' +
    '  table.resumen { width:auto; min-width:420px; margin-bottom:8px; }\n' +
    '  table.resumen td.fase { font-weight:600; }\n' +
    '  table.resumen tr.fail td { color:var(--red-fg); font-weight:600; }\n' +
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
    '<div class="card fail"><b>' + res.fallidos + '</b>Fallos</div>' +
    '<div class="card pend"><b>' + res.pendientes + '</b>Pendientes</div></div>\n' +
    '  <h2>Resumen por flujo</h2>\n' +
    '  <table class="resumen"><thead><tr><th>Flujo / Bloque</th><th>Verificaciones</th><th>OK</th><th>Fallos</th><th>Pendientes</th></tr></thead>\n' +
    '  <tbody>\n' + resumenFlujos + '\n  </tbody></table>\n' +
    '  <h2>Detalle</h2>\n' +
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
  amberFg: '#92400e',
  headBg: '#1e293b',
} as const;

const NUMERICAS = new Set(['num', 'eStock', 'eCosto', 'eSin', 'rStock', 'rCosto', 'rSin']);

interface Columna {
  key: 'num' | 'fase' | 'paso' | 'estado' | 'eStock' | 'eCosto' | 'eSin' | 'rStock' | 'rCosto' | 'rSin' | 'error' | 'desc';
  header: string;
  width: number; // puntos (suma = ancho útil en landscape A4 ≈ 770)
}

// Orden y anchos configurables: para añadir/quitar columnas basta editar aquí.
// El PDF NO lleva columna "Fase": cada flujo/bloque abre con una banda con su
// nombre y su subtotal, así que la columna se dedicaba a repetir (y a hacer
// crecer cada fila a 3 líneas). Ese espacio va a la Descripción.
const COLUMNAS: Columna[] = [
  { key: 'num', header: 'N°', width: 24 },
  { key: 'paso', header: 'Paso', width: 100 },
  { key: 'estado', header: 'Est.', width: 36 },
  { key: 'eStock', header: 'Stk.E', width: 42 },
  { key: 'eCosto', header: 'Csto.E', width: 50 },
  { key: 'eSin', header: 'S/ImpE', width: 54 },
  { key: 'rStock', header: 'Stk.R', width: 42 },
  { key: 'rCosto', header: 'Csto.R', width: 50 },
  { key: 'rSin', header: 'S/ImpR', width: 54 },
  { key: 'error', header: 'Error', width: 74 },
  { key: 'desc', header: 'Descripción', width: 244 },
];

/**
 * Helvetica (WinAnsi) no trae → ni × (salen como mojibake en el PDF).
 * Se sanean solo aquí; el HTML conserva el Unicode original.
 */
function sanearPDF(s: string): string {
  return s
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/✓/g, 'OK');
}

function celdaTexto(r: FilaReporte, key: Columna['key'], idx: number): string {
  if (key === 'num') return String(idx + 1);
  if (key === 'desc') return sanearPDF(descripcionFila(r));
  if (key === 'fase') return r.fase;
  if (key === 'paso') return r.paso;
  if (key === 'estado') return r.pendiente ? 'Pend.' : r.ok ? 'Éxito' : 'Fallo';
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
  const simple = ['num', 'paso', 'estado'];
  const label: Record<string, string> = { num: 'N°', paso: 'Paso', estado: 'Est.' };
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
  doc.rect(PDF.margin, y, 3, h).fill(r.pendiente ? PDF.amberFg : r.ok ? PDF.greenFg : PDF.redFg);
  doc.fillColor(PDF.cellInk).fontSize(PDF.fontSize.cell).font('Helvetica');
  for (const c of COLUMNAS) {
    const txt = sanearPDF(celdaTexto(r, c.key, idx));
    const align = NUMERICAS.has(c.key) ? 'right' : 'left';
    if (c.key === 'estado') {
      doc.fillColor(r.pendiente ? PDF.amberFg : r.ok ? PDF.greenFg : PDF.redFg).font('Helvetica-Bold');
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
  // El pie se escribe POR DEBAJO del margen inferior: sin anular el margen
  // (solo en esta página) PDFKit abre una página nueva por cada pie y el
  // reporte terminaba con autantas páginas en blanco como filas tiene.
  const margenInferior = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fillColor(PDF.muted).fontSize(8).font('Helvetica')
    .text('logisticaview-rpa-bot · npm run test:e2e · pág. ' + doc.bufferedPageRange().count, PDF.margin, y);
  doc.page.margins.bottom = margenInferior;
}

/**
 * Banda de sección: una por flujo/bloque, con el subtotal de sus verificaciones.
 * Permite leer el PDF "por flujos" y ver de un vistazo dónde falla cada uno.
 */
function dibujarBandaFase(
  doc: PDFKit.PDFDocument,
  fase: string,
  ok: number,
  fail: number,
  pend: number,
  y: number,
): number {
  const h = 16;
  const totalW = doc.page.width - PDF.margin * 2;
  doc.save();
  doc.rect(PDF.margin, y, totalW, h).fill(PDF.headBg);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
    .text(fase, PDF.margin + 5, y + 4.5, { width: totalW * 0.6, lineBreak: false });
  const partes: string[] = [];
  if (ok) partes.push(ok + ' OK');
  if (fail) partes.push(fail + ' FALLO');
  if (pend) partes.push(pend + ' PEND');
  const txt = partes.length ? partes.join(' / ') + ' de ' + (ok + fail + pend) : (ok + fail + pend) + ' verificaciones';
  doc.font('Helvetica').fontSize(7.5)
    .fillColor(fail > 0 ? '#fca5a5' : pend > 0 ? '#fde68a' : '#a7f3d0')
    .text(txt, PDF.margin + totalW * 0.6, y + 5, { width: totalW * 0.4 - 5, align: 'right', lineBreak: false });
  doc.restore();
  return y + h;
}

/** Genera el PDF del reporte. No usa navegador: funciona en cualquier entorno. */
export async function generarPdfReporte(reporte: FilaReporte[], pdfPath: string, resumen?: ResumenReporte): Promise<void> {
  const res = resumen || resumirReporte(reporte);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PDF.margin, bufferPages: true });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  dibujarCabecera(doc, res);
  let y = dibujarFilaEncabezado(doc, PDF.margin + PDF.headerH);

  let idx = 0;
  for (const grupo of agruparPorFase(reporte)) {
    const bandaH = 16;
    if (y + bandaH > doc.page.height - 40) {
      doc.addPage();
      dibujarCabecera(doc, res);
      y = dibujarFilaEncabezado(doc, PDF.margin + PDF.headerH);
    }
    const ok = grupo.filas.filter((f) => f.ok && !f.pendiente).length;
    const pend = grupo.filas.filter((f) => f.pendiente).length;
    y = dibujarBandaFase(doc, grupo.fase, ok, grupo.filas.length - ok - pend, pend, y);
    for (const r of grupo.filas) {
      const h = alturaFila(doc, r, idx);
      if (y + h > doc.page.height - 40) {
        doc.addPage();
        dibujarCabecera(doc, res);
        y = dibujarFilaEncabezado(doc, PDF.margin + PDF.headerH);
      }
      dibujarFila(doc, r, y, h, idx);
      y += h;
      idx++;
    }
  }

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
