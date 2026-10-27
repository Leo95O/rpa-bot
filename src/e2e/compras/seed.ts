// seed.ts — Helpers de seed/limpieza para el módulo de Compras (SOLID: Single Responsibility)
import mysql from 'mysql2/promise';
import { Configuracion } from './tipos';

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logisticaaa',
};

/**
 * Resuelve la ruta del binario mysql.exe del entorno actual.
 * Prioridad: DB_MYSQL_BIN env > XAMPP > Laragon (auto-detect) > 'mysql' en PATH.
 */
export function resolverMysqlBin(): string {
  if (process.env.DB_MYSQL_BIN) return process.env.DB_MYSQL_BIN;
  const fs = require('fs');
  // Laragon primero (BD siempre es la de Laragon)
  try {
    const laragonBase = 'C:\\\\laragon\\\\bin\\\\mysql';
    if (fs.existsSync(laragonBase)) {
      const dirs = fs.readdirSync(laragonBase);
      // Preferir mysql-* sobre mariadb-* (misma version que el servidor)
      const mysqlDirs = dirs.filter((d: string) => d.startsWith('mysql-'));
      const allDirs = mysqlDirs.length > 0 ? mysqlDirs : dirs;
      for (const d of allDirs) {
        const candidate = laragonBase + '\\\\' + d + '\\\\bin\\\\mysql.exe';
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  // Fallback: XAMPP
  const xampp = 'C:\\\\xampp\\\\mysql\\\\bin\\\\mysql.exe';
  if (fs.existsSync(xampp)) return xampp;
  return 'mysql';
}

async function conn() {
  return mysql.createConnection(DB);
}

export async function limpiarTransaccionales(): Promise<void> {
  const c = await conn();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    // Limpiar duplicados de configuracionlocal (mantener solo el primero por configuracion_id + local_id)
    await c.query(
      'DELETE c1 FROM configuracionlocal c1 INNER JOIN configuracionlocal c2 ' +
      'WHERE c1.configuracionlocal_id > c2.configuracionlocal_id ' +
      'AND c1.configuracion_id = c2.configuracion_id ' +
      'AND c1.local_id = c2.local_id',
    );
    const tablas = [
      'detallecompra', 'compra', 'detalleguia', 'guia',
      'detalleordencompra', 'ordencompra',
      'detallerequerimientocompra', 'requerimientocompra',
      'notacreditocompra', 'detallenotacreditocompra',
      'movimientoalmaceninsumo', 'movimientoalmacenconsumible',
      'almacenproductoinsumo', 'presentacioninsumo', 'presentacioncompraproducto',
      'insumo', 'producto', 'distribucionordencompra',
      'ordenrequerimientocompra', 'comprasporpagar', 'detallecomprasporpagar',
      'egreso', 'ingreso', 'merma', 'detallemerma',
      'detallecompramanual', 'avancecompra', 'detalleavancecompra',
      'detalleordenproduccion', 'ordenproduccion',
      'requerimientomovimiento',
      'detallesolitudmovimiento', 'solitudmovimiento',
    ];
    for (const t of tablas) {
      await c.query(`DELETE FROM ${t} WHERE ${t}_id > 0`);
    }
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await c.end();
  }
}

/**
 * Mapa maestro NOMBRE -> id, leído de la BD.
 * Se resuelve por nombre (no por rango de ids) porque 'Carne QA' lo crea el
 * Bloque 1 durante la corrida y nace con un id propio: los ids de la semilla
 * no son estables una vez que el bot da de alta maestros.
 */
export async function seedMaestros(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const c = await conn();
  try {
    const [rows] = await c.query('SELECT insumo_id AS id, insumo_nombre AS nombre FROM insumo');
    for (const r of rows as Array<{ id: number; nombre: string }>) {
      if (r.nombre && !ids.has(r.nombre)) ids.set(r.nombre, Number(r.id));
    }
    const [prods] = await c.query('SELECT producto_id AS id, producto_descripcion AS nombre FROM producto');
    for (const r of prods as Array<{ id: number; nombre: string }>) {
      if (r.nombre && !ids.has(r.nombre)) ids.set(r.nombre, Number(r.id));
    }
  } finally {
    await c.end();
  }
  return ids;
}

/**
 * Resuelve en vivo el `presentacioncompraproducto_id` de un producto por nombre
 * (los productos no usan `presentacioninsumo`: son otra tabla).
 */
export async function resolverPresentacionProducto(
  productoNombre: string,
  presentacionNombre: string,
): Promise<number | null> {
  const c = await conn();
  try {
    const [prods] = await c.query('SELECT producto_id FROM producto WHERE producto_descripcion = ? LIMIT 1', [productoNombre]);
    const prodId = (prods as Array<{ producto_id: number }>)[0]?.producto_id;
    if (!prodId) return null;
    const [pres] = await c.query(
      'SELECT presentacioncompraproducto_id FROM presentacioncompraproducto WHERE producto_id = ? AND presentacioncompraproducto_nombre = ? LIMIT 1',
      [prodId, presentacionNombre],
    );
    const id = (pres as Array<{ presentacioncompraproducto_id: number }>)[0]?.presentacioncompraproducto_id;
    return id === undefined ? null : Number(id);
  } finally {
    await c.end();
  }
}

export async function leerConfigs(localId: number): Promise<Configuracion[]> {
  const c = await conn();
  try {
    const [rows] = await c.query(
      'SELECT configuracion_id AS id, configuracionlocal_valor AS valor, configuracionlocal_valoraux1 AS aux1, configuracionlocal_valoraux2 AS aux2 FROM configuracionlocal WHERE local_id = ?',
      [localId],
    );
    return (rows as Array<{ id: number; valor: string; aux1?: string; aux2?: string }>).map((r) => ({
      id: Number(r.id),
      localId,
      valor: r.valor,
      aux1: r.aux1,
      aux2: r.aux2,
    }));
  } finally {
    await c.end();
  }
}

export async function leerIgvFiscalizado(localId: number): Promise<number> {
  const c = await conn();
  try {
    const [rows] = await c.query(
      'SELECT igv_porcentajeigv AS pct FROM igv WHERE igv_fiscalizado = 1 AND local_id = ? LIMIT 1',
      [localId],
    );
    const list = rows as Array<{ pct: number }>;
    if (list.length && Number(list[0].pct) > 0) {
      let pct = Number(list[0].pct);
      if (pct === 10) pct = 18;
      return pct;
    }
    return 18;
  } finally {
    await c.end();
  }
}

export async function leerTipoCambio(monedaId: number): Promise<number> {
  const c = await conn();
  try {
    const [rows] = await c.query(
      'SELECT moneda_tipocambio_compra AS tc FROM moneda WHERE moneda_id = ?',
      [monedaId],
    );
    const list = rows as Array<{ tc: string }>;
    return list.length ? Number(list[0].tc) : 1;
  } finally {
    await c.end();
  }
}
