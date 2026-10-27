// Vercel serverless entry: every /api/* request is rewritten here (see
// vercel.json). Static files come from public/, built by scripts/build-demo.js.
import { createApp } from '../server/app.js';
import { connect } from '../server/db.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Connect a Neon database in Vercel Storage.');

const db = await connect(process.env.DATABASE_URL);

export default createApp(db, { jwtSecret: process.env.JWT_SECRET_KEY, trustProxy: true });
