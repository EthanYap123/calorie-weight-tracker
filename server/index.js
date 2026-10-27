// Local server. With DATABASE_URL it uses that Postgres; without it, an
// embedded PGlite database in data/pglite (PGLITE_DIR=memory:// keeps nothing).
import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';
import { connect } from './db.js';
import { setupSchema } from './schema.js';

const port = Number(process.env.PORT ?? 3000);
const url = process.env.DATABASE_URL || process.env.PGLITE_DIR || 'data/pglite';
if (url === 'data/pglite') mkdirSync('data', { recursive: true });

const db = await connect(url);
await setupSchema(db);
// A fixed secret is fine on your own machine; production sets JWT_SECRET_KEY.
const jwtSecret = process.env.JWT_SECRET_KEY || 'local-development-only';
createApp(db, { jwtSecret }).listen(port, () => {
  const where = url.startsWith('postgres') ? 'Postgres from DATABASE_URL' : `PGlite in ${url}`;
  console.log(`Tracker running on http://localhost:${port} (database: ${where})`);
});
