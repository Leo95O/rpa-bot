import mysql from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'logistica';

export async function limpiarBaseDatos(): Promise<void> {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DELETE FROM presentacioninsumo WHERE presentacioninsumo_id > 0');
    await conn.query('DELETE FROM movimientoalmaceninsumo WHERE movimientoalmaceninsumo_id > 0');
    await conn.query('DELETE FROM almacenproductoinsumo WHERE almacenproductoinsumo_id > 0');
    await conn.query('DELETE FROM insumo WHERE insumo_id > 0');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Base de datos limpiada correctamente.');
  } finally {
    await conn.end();
  }
}
