// helpers.ts — Operaciones reutilizables del módulo de Compras (SOLID: Open/Closed, DRY)
import { Page } from 'playwright';
import { ContextoCompra, LineaDetalle, ResultadoOperacion, TotalesCompra } from './tipos';

declare const angular: any;

export function hoyMas(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

export function fechaHora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function serieUnica(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export async function navegar(page: Page, estado: string, params?: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (a) => {
      const injector = angular.element(document.body).injector();
      injector.get('$state').go(a.estado, a.params);
    },
    { estado, params },
  );
}

export async function esperarRespuesta(page: Page, urlPart: string, timeout = 60000): Promise<import('playwright').Response> {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(urlPart),
    { timeout },
  );
}

export async function inyectarSolicitud(
  page: Page,
  ctx: ContextoCompra,
  lineas: LineaDetalle[],
  fechaEntrega: string,
): Promise<ResultadoOperacion> {
  const resp = await page.evaluate(
    async (args) => {
      const injector = angular.element(document.body).injector();
      const Requerimientocompra = injector.get('Requerimientocompra');
      const payload = {
        local_id: args.localId,
        almacen_id: args.almacenId,
        usuario_id: 1,
        requerimientocompra_fechaentrega: args.fechaEntrega,
        detallerequerimientocompraList: args.lineas.map((l) => ({
          detallerequerimientocompra_descripcion: l.descripcion || '',
          detallerequerimientocompra_cantidad: l.cantidad,
          requerimientocompra_id: '-1',
          tipo: l.itemTipo,
          insumo_id: l.itemTipo === 1 ? l.itemId : null,
          producto_id: l.itemTipo === 2 ? l.itemId : null,
          presentacioninsumo_id: l.itemTipo === 1 ? l.presentacionId : null,
          presentacioncompraproducto_id: l.itemTipo === 2 ? l.presentacionId : null,
          almacen_id: l.almacenId,
        })),
      };
      try {
        const r = await Requerimientocompra.registrar(payload);
        return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    { localId: ctx.localId, almacenId: ctx.almacenId, fechaEntrega, lineas },
  );
  return resp;
}

export async function inyectarOrdenCompra(
  page: Page,
  ctx: ContextoCompra,
  lineas: LineaDetalle[],
  fechaVencimiento: string,
  distribucion: boolean,
  solicitudIds?: number[],
): Promise<ResultadoOperacion> {
  const resp = await page.evaluate(
    async (args) => {
      const injector = angular.element(document.body).injector();
      const Ordencompra = injector.get('OrdencompraResource');
      const payload = {
        ordencompra: {
          local_id: args.localId,
          proveedor_id: args.proveedorId,
          moneda_id: args.monedaId,
          ordencompra_tipocambio: args.tipoCambio,
          ordencompra_fecha: args.fecha,
          ordencompra_fechavencimiento: args.fechaVencimiento,
          ordencompra_distribucion: args.distribucion ? '1' : '0',
        },
        productos: args.lineas.map((l) => ({
          item_id: l.itemId,
          item_tipo: l.itemTipo,
          detalleordencompra_descripcion: l.descripcion || '',
          detalleordencompra_cantidad: l.cantidad,
          detalleordencompra_costo: l.costo,
          detalleordencompra_precio: l.costo,
          detalleordencompra_importe: l.cantidad * l.costo,
          almacen_id: l.almacenId,
          insumo_id: l.itemTipo === 1 ? l.itemId : null,
          producto_id: l.itemTipo === 2 ? l.itemId : null,
          presentacioninsumo_id: l.itemTipo === 1 ? l.presentacionId : null,
          presentacioncompraproducto_id: l.itemTipo === 2 ? l.presentacionId : null,
          ordencompra_id: '-1',
        })),
        idRequerimientocompraList: args.solicitudIds || [],
      };
      try {
        const r = await Ordencompra.agregar(payload);
        return { ok: r.tipo === 1 || r.tipo === '1', id: r.data, error: r.mensajes?.[0] };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    {
      localId: ctx.localId,
      proveedorId: ctx.proveedorId,
      monedaId: ctx.monedaId,
      tipoCambio: ctx.tipoCambio,
      fecha: fechaHora(),
      fechaVencimiento,
      distribucion,
      lineas,
      solicitudIds,
    },
  );
  return resp;
}

/**
 * Resuelve en vivo el `presentacioninsumo_id` de un insumo por nombre.
 * Nunca se hardcodean ids de presentación: 'Carne QA' lo crea el Bloque 1 y
 * su presentación nace con id propio; los maestros de la semilla sí tienen
 * ids conocidos, pero resolverlos en vivo los mantiene veraces.
 */
export async function resolverPresentacion(
  page: Page,
  insumoNombre: string,
  presentacionNombre = 'Base',
): Promise<number | null> {
  try {
    const r = await page.evaluate(
      async (args) => {
        const injector = angular.element(document.body).injector();
        const CommonCollection = injector.get('CommonCollection');
        const Insumo = injector.get('Insumo');
        const PARAM = injector.get('PARAM');
        const SecurityService = injector.get('SecurityService');
        const localId = SecurityService.getLocalId() || PARAM.NO;
        const resp = await CommonCollection.busquedaSensitivaSegunTipos(
          args.insumoNombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
          PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, localId, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
        );
        const lista = resp && resp.data ? resp.data : [];
        const item = lista.find(
          (x: any) =>
            String(x.item_descripcion || '').trim().toLowerCase() ===
            String(args.insumoNombre).trim().toLowerCase(),
        );
        if (!item) return null;
        const det = await Insumo.obtenerInsumoDetallado(item.item_id, 0, 0).catch(() => null);
        const pres = (det && det.data && det.data.listaPresentaciones) || [];
        const encontrada = pres.find(
          (p: any) =>
            String(p.presentacioninsumo_nombre || p.presentacion_nombre || '').trim().toLowerCase() ===
            String(args.presentacionNombre).trim().toLowerCase(),
        );
        if (encontrada) return Number(encontrada.presentacioninsumo_id);
        if (item.item_presentacionid) return Number(item.item_presentacionid);
        return null;
      },
      { insumoNombre, presentacionNombre },
    );
    return r == null ? null : Number(r);
  } catch {
    return null;
  }
}

export function calcularTotales(
  lineas: Array<{ cantidad: number; costo: number; afecto: boolean; descuento?: number }>,
  igvPct: number,
  opts: { flete?: number; icbper?: number; percepcion?: number } = {},
): TotalesCompra {
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
  return {
    subtotal: Math.round(subtotal * 1000) / 1000,
    igv: Math.round(igv * 1000) / 1000,
    total: Math.round((subtotal + igv + flete + icbper + percepcion) * 1000) / 1000,
    flete,
    icbper,
    percepcion,
    retencion: 0,
  };
}

export function ppp(stockAnt: number, costoAnt: number, cant: number, costo: number): number {
  const den = stockAnt + cant;
  if (den <= 0) return 0;
  return (stockAnt * costoAnt + cant * costo) / den;
}

export function precioSin(costoCon: number, divisorIgv: number): number {
  return Math.round((costoCon / divisorIgv) * 1000) / 1000;
}
