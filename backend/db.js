/**
 * Opens a connection pool to the SAME Postgres container Flowable already
 * uses (docker-compose calls it "flowable-db", but it's just plain
 * postgres:15 — nothing Flowable-specific about it). This file only
 * manages the connection; actual queries live in ticketsRepo.js.
 *
 * New env vars needed in .env (see .env.example):
 *   DB_HOST=localhost      (or 'flowable-db' if the backend itself runs
 *                            inside Docker, on the same compose network)
 *   DB_PORT=5432
 *   DB_NAME=flowable
 *   DB_USER=flowable
 *   DB_PASS=flowable
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'flowable',
  user: process.env.DB_USER || 'flowable',
  password: process.env.DB_PASS || 'flowable',
  max: 20,                     // max simultaneous connections in the pool
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Fires on a background/idle client error (e.g. network blip) — log it
  // instead of crashing the whole server.
  console.error('[db] unexpected error on idle client:', err.message);
});

/** Runs one query using a connection from the pool. Logs (doesn't fail)
 *  on anything slower than 200ms, so you notice missing indexes early. */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 200) {
    console.warn(`[db] slow query (${ms}ms): ${text.slice(0, 100)}`);
  }
  return result;
}

/** Runs several statements as one all-or-nothing transaction. Pass a
 *  function that receives a `client` and use client.query(...) inside it
 *  instead of the module-level query() (so everything shares one
 *  connection). Used for things like "insert ticket + insert first
 *  status-history row" so they can never end up half-done. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Quick startup check — call this once when the server boots so a bad
 *  DB_* config fails loudly at launch instead of on the first request. */
async function testConnection() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

module.exports = { pool, query, withTransaction, testConnection };