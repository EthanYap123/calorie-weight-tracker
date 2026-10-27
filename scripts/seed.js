// Fill one account with the eight-week sample data, ending today. Creates
// the account if it doesn't exist yet. Uses the same database as npm start.
//   npm run seed -- you@example.com your-password
import { mkdirSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { localToday } from '../core/dates.js';
import { createTracker } from '../core/service.js';
import { validateCredentials } from '../server/auth.js';
import { connect } from '../server/db.js';
import { createPgStore } from '../server/pg-store.js';
import { setupSchema } from '../server/schema.js';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run seed -- <email> <password>');
  process.exit(1);
}
const creds = validateCredentials({ email, password });
const url = process.env.DATABASE_URL || process.env.PGLITE_DIR || 'data/pglite';
if (url === 'data/pglite') mkdirSync('data', { recursive: true });
const db = await connect(url);
await setupSchema(db);

await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [
  creds.email,
  await bcrypt.hash(creds.password, 10),
]);
const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [creds.email]);
const store = createPgStore(db, rows[0].id);
await createTracker(store).loadDemo(localToday());
console.log(
  `Seeded ${creds.email}: ${(await store.listWeights()).length} weigh-ins, ${(await store.listMeals()).length} food entries.`,
);
await db.close();
