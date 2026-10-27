// Create or update the database tables. Safe to run any number of times;
// it is the Vercel build step, so every deploy brings the schema up to date.
//   DATABASE_URL=postgres://... npm run db:setup
import { connect } from '../server/db.js';
import { setupSchema } from '../server/schema.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. On Vercel, connect a Neon database in the Storage tab, then redeploy.');
  process.exit(1);
}
const db = await connect(url);
await setupSchema(db);
await db.close();
console.log('Database tables are ready.');
