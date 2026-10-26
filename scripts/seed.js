// Fill the server database with the eight-week demo data, ending today.
//   npm run seed
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { localToday } from '../core/dates.js';
import { createTracker } from '../core/service.js';
import { createSqliteStore } from '../server/sqlite-store.js';

const file = process.env.DB_FILE ?? 'data/tracker.db';
mkdirSync(dirname(file), { recursive: true });
const store = createSqliteStore(file);
await createTracker(store).loadDemo(localToday());
console.log(
  `Seeded ${file}: ${store.listWeights().length} weigh-ins, ${store.listMeals().length} food entries.`,
);
store.close();
