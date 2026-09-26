import { Page } from 'playwright';

declare const angular: any;

export interface ResultadoValidacion {
  paso: string;
  ok: boolean;
  esperado: { cantidad: number; costo: number; costoSinImp?: number };
  real: { stock: number; costo: number; costoSinImp?: number } | null;
  error?: string;
}

export interface EstadoGlobal {
  fecha: string;
  insumos: Array<{ nombre: string; id: number; stock: number; costo: number }>;
}

const TOLERANCIA = 0.02;

// Busca un insumo por nombre usando el buscador del frontend (sin navegar).
export async function buscarInsumo(page: Page, nombre: string): Promise<{ id: number; nombre: string } | null> {
  return page.evaluate(async (nombre) => {
    try {
      const injector = angular.element(document.body).injector();
      const CommonCollection = injector.get('CommonCollection');
      const PARAM = injector.get('PARAM');
      const SecurityService = injector.get('SecurityService');

      const local_id = SecurityService.getLocalId() || PARAM.NO;

      const resp = await CommonCollection.busquedaSensitivaSegunTipos(
        nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
        PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
      );
      const lista = resp && resp.data ? resp.data : [];
      const item = lista.find(
        (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(nombre).trim().toLowerCase(),
      );
      if (!item) return null;
      return { id: Number(item.item_id), nombre: item.item_descripcion };
    } catch {
      return null;
    }
  }, nombre);
}

// Lee el stock + costo promedio de un insumo desde el endpoint autoritativo
// `producto/insumo/obtenerStockYCosto/{id}` (la misma fuente que alimenta el Kardex).
// Evita leer el $scope de HandsOnTable, que resultó poco fiable (devolvía 0).
async function leerStockYCosto(
  page: Page,
  nombre: string,
): Promise<{ nombre: string; id: number; stock: number; costo: number; costoSinImp: number }> {
  return page.evaluate(async (nombre) => {
    const injector = angular.element(document.body).injector();
    const CommonCollection = injector.get('CommonCollection');
    const Insumo = injector.get('Insumo');
    const PARAM = injector.get('PARAM');
    const SecurityService = injector.get('SecurityService');

    const local_id = SecurityService.getLocalId() || PARAM.NO;
    const resp = await CommonCollection.busquedaSensitivaSegunTipos(
      nombre, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.NO, PARAM.SI, PARAM.NO,
      PARAM.SI, PARAM.SI, PARAM.SI, PARAM.NO, PARAM.NO, PARAM.SI, local_id, PARAM.NO, PARAM.SI, PARAM.NO, PARAM.NO,
    );
    const lista = resp && resp.data ? resp.data : [];
    const item = lista.find(
      (x: any) => String(x.item_descripcion || '').trim().toLowerCase() === String(nombre).trim().toLowerCase(),
    );
    if (!item) {
      throw new Error('No se encontró el insumo "' + nombre + '".');
    }

    const stockResp = await Insumo.obtenerStockYCosto(item.item_id);
    const almacenes = stockResp && stockResp.data ? stockResp.data : [];
    const principal =
      almacenes.find((a: any) => /principal/i.test(a.almacen_descripcion || '')) || almacenes[0];

    let stock = 0;
    let costo = 0;
    let costoSinImp = 0;
    if (principal) {
      stock = Number(principal.stock || 0);
      const cs = principal.costoStock;
      // `costo` es el costo promedio correcto; `costoStock.costopromedio` solo se
      // calcula si el backend recibe `retornar_costo_promedio`, por lo que suele ser 0.
      costo = Number(principal.costo || 0);
      if (costo === 0 && cs && Number(cs.costopromedio || 0) > 0) {
        costo = Number(cs.costopromedio);
      }
      // PPP sin impuestos en paralelo (getStockCosto[].costosinimpuesto;
      // InsumoLogistica.php:2388). Para exonerados coincide con el costo.
      if (cs && cs.costosinimpuesto !== undefined && cs.costosinimpuesto !== null) {
        costoSinImp = Math.round(Number(cs.costosinimpuesto) * 1000) / 1000;
      }
    }

    return { nombre: item.item_descripcion, id: Number(item.item_id), stock, costo, costoSinImp };
  }, nombre);
}

export async function validarStock(
  page: Page,
  nombre: string,
  cantidad: number,
  costo: number,
  costoSinImp?: number,
): Promise<ResultadoValidacion> {
  const paso = 'validarStock("' + nombre + '")';
  const esperado = { cantidad, costo, costoSinImp };
  try {
    // El stock puede tardar un digest/movimiento en asentarse tras
    // actualizarCompra: reintentar ante lecturas 0/0 transitorias.
    let r = await leerStockYCosto(page, nombre);
    for (let i = 0; i < 3 && r.stock === 0 && r.costo === 0 && (cantidad !== 0 || costo !== 0); i++) {
      await page.waitForTimeout(2000);
      r = await leerStockYCosto(page, nombre);
    }
    const real = { stock: r.stock, costo: r.costo, costoSinImp: r.costoSinImp };
    let ok = Math.abs(real.stock - cantidad) < TOLERANCIA && Math.abs(real.costo - costo) < TOLERANCIA;
    if (ok && costoSinImp !== undefined) {
      ok = Math.abs((real.costoSinImp || 0) - costoSinImp) < TOLERANCIA;
    }
    return {
      paso,
      ok,
      esperado,
      real,
      error: ok ? undefined : 'Divergencia de stock/costo (esperado vs real).',
    };
  } catch (e) {
    return {
      paso,
      ok: false,
      esperado,
      real: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function obtenerEstadoGlobal(
  page: Page,
  nombres: string[] = ['test A', 'test B'],
): Promise<EstadoGlobal> {
  const insumos: EstadoGlobal['insumos'] = [];
  for (const n of nombres) {
    try {
      const r = await leerStockYCosto(page, n);
      insumos.push({ nombre: r.nombre, id: r.id, stock: r.stock, costo: r.costo });
    } catch {
      /* el insumo aún no existe en esta fase */
    }
  }
  return { fecha: new Date().toISOString(), insumos };
}
