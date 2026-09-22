/**
 * utils/deepFind.ts — Buscador resiliente de IDs dentro de objetos del $scope.
 *
 * CANÓNICO (lado Node): esta es la implementación de referencia, pura y sin
 * dependencias del navegador, tipada en estricto. Sirve para post-procesar
 * estructuras ya extraídas (p. ej. desde `debugger.ts`) y como documentación
 * viva del algoritmo.
 *
 * ESPEJO EN NAVEGADOR: `page.evaluate()` serializa solo la función que recibe,
 * por lo que NO puede importar este módulo. Las funciones `coincide()` de
 * `compras.ts` (modificarCompra / registrarNotaCredito) y `guias.ts`
 * (modificarGuia) contienen una copia compacta del mismo algoritmo inline.
 * Si se cambia la lógica aquí, replicarla allí (busca el comentario
 * "Espejo de utils/deepFind.ts").
 *
 * Estrategia de matching (en orden):
 *   1. Claves con pinta de ID (`item_id`, `insumo_id`, `producto_id`,
 *      `presentacioninsumo_id`, `presentacion_id`, `detallecompra_id`,
 *      `detalleguia_id`, o cualquier clave que combine "insumo"+"id")
 *      cuyo valor numérico coincida con el objetivo.
 *   2. Recursión en profundidad sobre sub-objetos/arrays.
 *   3. Como último recurso, clave exactamente `id` (p. ej. `item.producto.id`).
 * Se ignoran claves internas de AngularJS (`$...`, `$$...`) y ciclos.
 */

export interface CoincidenciaId {
  encontrada: boolean;
  /** Valor tal cual aparece en el objeto (puede ser string numérico). */
  valor?: number | string;
  /** Ruta legible, ej. "presentacion.insumo_id" o "items[2].insumo_id". */
  ruta?: string;
  /** Clave donde se encontró. */
  clave?: string;
}

export interface OpcionesDeepFind {
  maxProfundidad?: number;
  maxNodos?: number;
}

const PATRON_CLAVE_ID_EXACTA =
  /^(item_id|insumo_id|producto_id|presentacioninsumo_id|presentacion_id|detallecompra_id|detalleguia_id)$/i;

const PATRON_CLAVE_INSUMO_ID = /insumo.*id|id.*insumo/i;

/** Normaliza números y strings numéricos ("1636" === 1636). Sin esto, un id
 *  que viaja como string jamás matchearía contra el insumoId numérico. */
export function normalizarNumero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (texto !== '' && !Number.isNaN(Number(texto))) return Number(texto);
  }
  return null;
}

function esClaveId(clave: string): boolean {
  return PATRON_CLAVE_ID_EXACTA.test(clave) || PATRON_CLAVE_INSUMO_ID.test(clave);
}

function rutaHija(base: string, clave: string | number): string {
  if (typeof clave === 'number') return `${base}[${clave}]`;
  return base ? `${base}.${clave}` : String(clave);
}

/**
 * Enumeración tolerante: `Object.keys` pierde propiedades no-enumerables y los
 * getters que lanzan rompen el recorrido. Se usa `getOwnPropertyNames` con
 * fallback y cada lectura va protegida (ver `leerSeguro`).
 */
function clavesSeguras(nodo: object): string[] {
  let todas: string[];
  try {
    todas = Object.getOwnPropertyNames(nodo);
  } catch {
    try {
      todas = Object.keys(nodo as Record<string, unknown>);
    } catch {
      return [];
    }
  }
  return todas.filter((k) => !k.startsWith('$$') && !k.startsWith('$'));
}

function leerSeguro(nodo: object, clave: string): { ok: boolean; valor?: unknown } {
  try {
    const v = (nodo as Record<string, unknown>)[clave];
    if (typeof v === 'function') return { ok: false };
    return { ok: true, valor: v };
  } catch {
    return { ok: false };
  }
}

export function deepFindId(
  raiz: unknown,
  objetivo: number | string,
  opciones?: OpcionesDeepFind,
): CoincidenciaId {
  const maxProfundidad = opciones?.maxProfundidad ?? 8;
  const maxNodos = opciones?.maxNodos ?? 2000;
  let visitados = 0;
  const ancestros = new Set<object>();

  function coincideValor(valor: unknown): boolean {
    if (typeof objetivo === 'number') {
      return normalizarNumero(valor) === objetivo;
    }
    return valor === objetivo;
  }

  function recorrer(nodo: unknown, ruta: string, profundidad: number): CoincidenciaId | null {
    if (nodo === null || nodo === undefined) return null;
    if (profundidad > maxProfundidad) return null;
    if (typeof nodo !== 'object') return null;
    if (ancestros.has(nodo)) return null;
    visitados += 1;
    if (visitados > maxNodos) return null;
    ancestros.add(nodo);
    try {
      const claves: Array<string | number> = Array.isArray(nodo)
        ? nodo.map((_, i) => i)
        : clavesSeguras(nodo);
      const leer = (k: string | number): unknown => {
        if (typeof k === 'number') return (nodo as unknown[])[k];
        const r = leerSeguro(nodo, k);
        return r.ok ? r.valor : undefined;
      };

      // Pasada 1: claves con pinta de ID en este nivel.
      for (const k of claves) {
        const ks = String(k);
        if (ks.startsWith('$$') || ks.startsWith('$')) continue;
        if (!esClaveId(ks)) continue;
        const v = leer(k);
        if ((typeof v === 'number' || typeof v === 'string') && coincideValor(v)) {
          return { encontrada: true, valor: v, ruta: rutaHija(ruta, k), clave: ks };
        }
      }
      // Pasada 2: recursión (las hojas no-objeto no aportan nada nuevo aquí).
      for (const k of claves) {
        const ks = String(k);
        if (ks.startsWith('$$') || ks.startsWith('$')) continue;
        const v = leer(k);
        if (v === null || typeof v !== 'object') continue;
        const r = recorrer(v, rutaHija(ruta, k), profundidad + 1);
        if (r) return r;
      }
      // Pasada 3: clave desnuda `id` en este nivel (p. ej. item.producto.id).
      for (const k of claves) {
        const ks = String(k);
        if (ks.toLowerCase() !== 'id') continue;
        const v = leer(k);
        if ((typeof v === 'number' || typeof v === 'string') && coincideValor(v)) {
          return { encontrada: true, valor: v, ruta: rutaHija(ruta, k), clave: ks };
        }
      }
      return null;
    } finally {
      ancestros.delete(nodo);
    }
  }

  return recorrer(raiz, '', 0) ?? { encontrada: false };
}
