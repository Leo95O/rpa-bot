import * as fs from 'fs';
import * as path from 'path';
import mysql from 'mysql2/promise';

/**
 * Semilla idempotente de catálogos mínimos que el bot necesita y la limpieza
 * NO toca (maestros). Caso real: `categoriainsumo` con su única fila en
 * estado=0 → el endpoint filtra estado=1 (`CategoriainsumoController:336-339`)
 * → `vm.listaCategoriainsumo` vacío → `esperarInsumoListo` timeoutea 60s.
 */
async function asegurarCatalogosMinimos(conn: mysql.Connection): Promise<void> {
  const [rows] = await conn.query(
    "SELECT categoriainsumo_id FROM categoriainsumo WHERE categoriainsumo_descripcion = 'Categoria uno' AND categoriainsumo_estado = 1 LIMIT 1",
  );
  if ((rows as unknown[]).length === 0) {
    await conn.query(
      "INSERT INTO categoriainsumo (categoriainsumo_descripcion, categoriainsumo_estado) VALUES ('Categoria uno', 1)",
    );
    console.log('Semilla: categoría "Categoria uno" creada/reactivada.');
  }
}

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'logisticaaa';

export async function limpiarBaseDatos(): Promise<void> {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    // Script ordenado hijos-primero (ver data/limpieza_bd.sql y BLUEPRINT §6).
    // Incluye sus propios SET FOREIGN_KEY_CHECKS = 0/1 (obligatorios por los
    // ciclos insumo ↔ producto ↔ productogeneral y las auto-referencias).
    const sql = fs.readFileSync(path.resolve('data', 'limpieza_bd.sql'), 'utf8');
    // Quitar líneas de comentario ANTES de partir (si no, los ';' dentro de
    // comentarios generan fragmentos inválidos).
    const sinComentarios = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    const statements = sinComentarios
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s);
    for (const st of statements) {
      await conn.query(st);
    }
    console.log('Base de datos limpiada correctamente (' + statements.length + ' statements).');
    await asegurarCatalogosMinimos(conn);
  } finally {
    await conn.end();
  }
}
