/**
 * utils/debugger.ts — Inspector estructurado de memoria ($scope → JSON en /data).
 *
 * Problema que resuelve: los objetos de AngularJS tienen referencias circulares
 * ($$childHead, $$nextSibling, $parent...), funciones y miles de nodos. Un
 * `console.log` o un `JSON.stringify` directo o bien explota o bien ensucia la
 * consola. Esta utilidad extrae SOLO el sub-árbol pedido, lo sanitiza y lo
 * vuelca a un archivo `data/debug_<nombre>_<timestamp>.json` con inventario
 * de claves de primer nivel, para inspeccionar "qué tan anidado" está un campo.
 *
 * Dos puntos de entrada:
 *  - `volcarScope(page, opts)`: corre DENTRO del navegador (page.evaluate),
 *    localiza el scope por marca de vm, resuelve `objetivo` (ruta desde vm,
 *    ej. "compra.detallecompraList[0]") y sanitiza allí mismo.
 *  - `escribirMuestra(nombre, datos)`: lado Node, para datos que ya están en
 *    mano (p. ej. lo devuelto por un evaluate). Usa `sanitizarPlano`.
 */
import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

declare const angular: any;

export interface OpcionesVolcado {
  /** Prefijo del archivo: se genera `debug_<nombre>_<timestamp>.json`. */
  nombre: string;
  /** Función del vm que identifica el scope, ej. 'fnActualizarCompra'. */
  marcaVm: string;
  /** Ruta desde `vm`, ej. "compra.detallecompraList[0]". Si se omite, vuelca `vm` completo (puede ser grande). */
  objetivo?: string;
  limiteProfundidad?: number;
  limiteItems?: number;
  limiteNodos?: number;
}

export interface ResultadoVolcado {
  ok: boolean;
  path?: string;
  clavesRaiz?: string[];
  nodos?: number;
  error?: string;
}

interface ResultadoLectura {
  ok: boolean;
  datos?: unknown;
  claves?: string[];
  nodos?: number;
  error?: string;
}

/**
 * Sanitizador puro lado Node (para objetos ya extraídos del navegador).
 * Espejo del sanitizador inline de `volcarScope`; mantener sincronizados.
 *
 * A diferencia de un `Object.keys` plano, lee con `getOwnPropertyNames` (capta
 * propiedades no-enumerables) y cada lectura va en try/catch (los getters de
 * modelos AngularJS pueden lanzar). Si un objeto no aporta ninguna clave útil,
 * se registra su `__ctor` (nombre del constructor) en vez de un `{}` mudo:
 * eso fue lo que delató filas HandsOnTable/modelo en los dumps reales.
 */
export function sanitizarPlano(
  datos: unknown,
  limites?: { profundidad?: number; items?: number; nodos?: number },
): unknown {
  const maxProf = limites?.profundidad ?? 8;
  const maxItems = limites?.items ?? 50;
  const maxNodos = limites?.nodos ?? 8000;
  const cont = { n: 0 };
  const vistos: unknown[] = [];

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

  function nombreCtor(nodo: object): string | null {
    try {
      const c = (nodo as { constructor?: { name?: unknown } }).constructor;
      if (c && typeof c.name === 'string' && c.name !== 'Object' && c.name !== 'Array') return c.name;
    } catch {
      /* ignore */
    }
    return null;
  }

  function san(nodo: unknown, prof: number): unknown {
    if (cont.n > maxNodos) return '[LIMITE_NODOS]';
    if (nodo === null || nodo === undefined) return nodo;
    const t = typeof nodo;
    if (t === 'function') return '[function]';
    if (t === 'number' || t === 'boolean') return nodo;
    if (t === 'string') {
      const s = nodo as string;
      return s.length > 300 ? s.slice(0, 300) + '…' : s;
    }
    if (t !== 'object') return String(nodo);
    if (vistos.indexOf(nodo) >= 0) return '[circular]';
    vistos.push(nodo);
    cont.n += 1;
    try {
      if (prof > maxProf) return '[MAX_PROFUNDIDAD]';
      if (Array.isArray(nodo)) {
        const arr = (nodo as unknown[]).slice(0, maxItems).map((x) => san(x, prof + 1));
        if ((nodo as unknown[]).length > maxItems) arr.push('[TRUNCADO total=' + (nodo as unknown[]).length + ']');
        return arr;
      }
      const out: Record<string, unknown> = {};
      for (const k of clavesSeguras(nodo)) {
        const r = leerSeguro(nodo, k);
        if (r.ok) out[k] = san(r.valor, prof + 1);
      }
      if (Object.keys(out).length === 0) {
        const ctor = nombreCtor(nodo);
        return ctor ? { __ctor: ctor } : {};
      }
      return out;
    } finally {
      const i = vistos.indexOf(nodo);
      if (i >= 0) vistos.splice(i, 1);
    }
  }

  return san(datos, 0);
}

/** Escribe un objeto ya-en-mano (sanitizado aquí) a /data y devuelve su ruta. */
export async function escribirMuestra(nombre: string, datos: unknown): Promise<string> {
  const dir = path.resolve('data');
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.resolve(dir, 'debug_' + sanitizarNombre(nombre) + '_' + Date.now() + '.json');
  fs.writeFileSync(ruta, JSON.stringify(sanitizarPlano(datos), null, 2));
  return ruta;
}

function sanitizarNombre(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'volcado';
}

export async function volcarScope(page: Page, opts: OpcionesVolcado): Promise<ResultadoVolcado> {
  const objetivo = opts.objetivo ?? '';
  const lectura: ResultadoLectura = await page.evaluate(
    (o: { marcaVm: string; objetivo: string; limiteProfundidad: number; limiteItems: number; limiteNodos: number }) => {
      // Sanitizador inline (navegador). Espejo de `sanitizarPlano` de este módulo.
      // Lee con getOwnPropertyNames (capta no-enumerables) y cada lectura en
      // try/catch (los getters de modelos AngularJS pueden lanzar).
      function clavesSeguras(nodo: any): string[] {
        let todas: string[];
        try {
          todas = Object.getOwnPropertyNames(nodo);
        } catch (e) {
          try {
            todas = Object.keys(nodo);
          } catch (e2) {
            return [];
          }
        }
        const out: string[] = [];
        for (const k of todas) {
          if (k.charAt(0) !== '$') out.push(k);
        }
        return out;
      }
      function leerSeguro(nodo: any, clave: string): any {
        try {
          const v = nodo[clave];
          if (typeof v === 'function') return { ok: false };
          return { ok: true, valor: v };
        } catch (e) {
          return { ok: false };
        }
      }
      function nombreCtor(nodo: any): any {
        try {
          const c = nodo.constructor;
          if (c && typeof c.name === 'string' && c.name !== 'Object' && c.name !== 'Array') return c.name;
        } catch (e) {
          /* ignore */
        }
        return null;
      }
      function sanitizar(nodo: unknown, prof: number, vistos: unknown[], cont: { n: number }): unknown {
        if (cont.n > o.limiteNodos) return '[LIMITE_NODOS]';
        if (nodo === null || nodo === undefined) return nodo;
        const t = typeof nodo;
        if (t === 'function') return '[function]';
        if (t === 'number' || t === 'boolean') return nodo;
        if (t === 'string') {
          const s = nodo as string;
          return s.length > 300 ? s.slice(0, 300) + '…' : s;
        }
        if (t !== 'object') return String(nodo);
        if ((vistos as unknown[]).indexOf(nodo) >= 0) return '[circular]';
        (vistos as unknown[]).push(nodo);
        cont.n += 1;
        try {
          if (prof > o.limiteProfundidad) return '[MAX_PROFUNDIDAD]';
          if (Array.isArray(nodo)) {
            const arr = (nodo as unknown[]).slice(0, o.limiteItems).map((x: unknown) => sanitizar(x, prof + 1, vistos, cont));
            if ((nodo as unknown[]).length > o.limiteItems) {
              (arr as unknown[]).push('[TRUNCADO total=' + (nodo as unknown[]).length + ']');
            }
            return arr;
          }
          const out: Record<string, unknown> = {};
          for (const k of clavesSeguras(nodo)) {
            const r: any = leerSeguro(nodo, k);
            if (r.ok) out[k] = sanitizar(r.valor, prof + 1, vistos, cont);
          }
          if (Object.keys(out).length === 0) {
            const ctor = nombreCtor(nodo);
            return ctor ? { __ctor: ctor } : {};
          }
          return out;
        } finally {
          const i = (vistos as unknown[]).indexOf(nodo);
          if (i >= 0) (vistos as unknown[]).splice(i, 1);
        }
      }

      try {
        const injector = angular.element(document.body).injector();
        const $rootScope = injector.get('$rootScope');
        let scope: any = null;
        (function walk(s: any): void {
          if (scope) return;
          if (s.vm && typeof s.vm[o.marcaVm] === 'function') {
            scope = s;
            return;
          }
          let c = s.$$childHead;
          while (c) {
            walk(c);
            c = c.$$nextSibling;
          }
        })($rootScope);
        if (!scope) return { ok: false, error: 'No se encontró scope con vm.' + o.marcaVm };

        let objetivo: unknown = scope.vm;
        if (o.objetivo) {
          const partes = o.objetivo.split(/[.[\]]+/).filter((p: string) => p.length > 0);
          for (const p of partes) {
            if (objetivo === null || objetivo === undefined || typeof objetivo !== 'object') {
              return { ok: false, error: 'Ruta "' + o.objetivo + '" no resoluble en "' + p + '".' };
            }
            objetivo = (objetivo as Record<string, unknown>)[p];
          }
        }

        const cont = { n: 0 };
        const datos = sanitizar(objetivo, 0, [], cont);
        const claves =
          datos !== null && typeof datos === 'object' && !Array.isArray(datos)
            ? Object.keys(datos as Record<string, unknown>)
            : [];
        return { ok: true, datos, claves, nodos: cont.n };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    {
      marcaVm: opts.marcaVm,
      objetivo,
      limiteProfundidad: opts.limiteProfundidad ?? 8,
      limiteItems: opts.limiteItems ?? 50,
      limiteNodos: opts.limiteNodos ?? 8000,
    },
  );

  if (!lectura.ok) return { ok: false, error: lectura.error };
  const ruta = await escribirMuestra(opts.nombre, {
    objetivo: objetivo || '(vm completo)',
    clavesRaiz: lectura.claves,
    nodos: lectura.nodos,
    datos: lectura.datos,
  });
  return { ok: true, path: ruta, clavesRaiz: lectura.claves, nodos: lectura.nodos };
}
