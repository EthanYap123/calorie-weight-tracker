// Shared test setup: a real Postgres for the server store. TEST_DATABASE_URL
// points at a Postgres server (CI uses a service container); without it each
// test file gets its own in-memory PGlite.
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.js';
import { connect } from '../server/db.js';
import { createPgStore } from '../server/pg-store.js';
import { setupSchema } from '../server/schema.js';

export const db = await connect(process.env.TEST_DATABASE_URL || 'memory://');
await setupSchema(db);

const unique = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const HASH = bcrypt.hashSync('unused-password', 4);

/** A fresh user with an empty store. */
export async function pgStore() {
  const { rows } = await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [
    `store-${unique()}@example.test`,
    HASH,
  ]);
  return createPgStore(db, rows[0].id);
}

const ROOMY = { signup: { max: 1000, windowSec: 60 }, login: { max: 1000, windowSec: 60 }, writes: { max: 1000, windowSec: 60 } };

/**
 * Start the API on a random port. `server.client()` signs up a new account
 * and returns call(method, path, body) that sends its token.
 */
export async function startServer(options = {}) {
  const server = createApp(db, { jwtSecret: 'test-secret', limits: ROOMY, ...options }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/api`;

  const request = async (method, path, body, token, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
  };

  async function client(email = `user-${unique()}@example.test`, password = 'correct horse battery') {
    const res = await request('POST', '/auth/register', { email, password });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    const call = (method, path, body) => request(method, path, body, res.body.token);
    return Object.assign(call, { token: res.body.token, email, password });
  }

  return { base, request, client, close: () => new Promise((r) => server.close(r)) };
}
