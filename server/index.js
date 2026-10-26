import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { createSqliteStore } from './sqlite-store.js';

const port = Number(process.env.PORT ?? 3000);
const file = process.env.DB_FILE ?? 'data/tracker.db';
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

const store = createSqliteStore(file);
createApp(store).listen(port, () => {
  console.log(`Tracker running on http://localhost:${port} (database: ${file})`);
});
