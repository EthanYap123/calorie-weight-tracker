// One small database interface for both Postgres drivers:
//   query(text, params) -> { rows, rowCount }
//   transaction(fn)     -> runs fn(tx) on a single connection, inside BEGIN/COMMIT
// A postgres:// URL uses node-postgres (Neon in production). Anything else is
// a PGlite data directory ("memory://" for nothing on disk), so local dev and
// the tests run real Postgres without installing a server.

export async function connect(url) {
  if (/^postgres(ql)?:\/\//.test(url)) return connectPg(url);
  return connectPglite(url);
}

async function connectPg(url) {
  const { default: pg } = await import('pg');
  // Serverless functions each hold their own pool, so keep it small.
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 3) });
  pool.on('error', (err) => console.error('Idle database connection failed:', err.message));
  const wrap = (client) => ({
    async query(text, params) {
      const { rows, rowCount } = await client.query(text, params);
      return { rows, rowCount };
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function connectPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dir);
  const wrap = (conn) => ({
    async query(text, params) {
      const { rows, affectedRows } = await conn.query(text, params);
      return { rows, rowCount: affectedRows || rows.length };
    },
  });
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}
