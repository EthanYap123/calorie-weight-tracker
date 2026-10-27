// Accounts and per-user data. Steady holds personal health data, so these
// tests check that one account can never see or change another's.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createTracker } from '../core/service.js';
import { createMemoryStore } from '../core/store-memory.js';
import { createPgStore } from '../server/pg-store.js';
import { db, startServer } from './helpers.js';

const TODAY = '2026-10-26';
const PROFILE = { name: 'Sam', sex: 'female', age: 30, heightCm: 165, activity: 'light', goalKg: 60, weeklyRateKg: 0.5 };
const MEAL = { date: TODAY, slot: 'lunch', name: 'Laksa', amount: '1 bowl (520 g)', grams: 520, kcal: 589 };

describe('accounts', () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(() => server.close());

  test('sign up, then log in with the same email in any case', async () => {
    const res = await server.request('POST', '/auth/register', { email: ` Ethan-${Date.now()}@Example.test `, password: 'long enough pw' });
    assert.equal(res.status, 201);
    assert.match(res.body.user.email, /^ethan-\d+@example\.test$/);
    const login = await server.request('POST', '/auth/login', { email: res.body.user.email.toUpperCase(), password: 'long enough pw' });
    assert.equal(login.status, 200);
    const me = await server.request('GET', '/auth/me', null, login.body.token);
    assert.deepEqual(me.body, { email: res.body.user.email });
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const call = await server.client();
    const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', [call.email]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$10\$/);
    assert.ok(!rows[0].password_hash.includes(call.password));
  });

  test('sign-up checks the email and password', async () => {
    const res = await server.request('POST', '/auth/register', { email: 'not-an-email', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.errors.length, 2);
    const long = await server.request('POST', '/auth/register', { email: 'a@b.test', password: 'x'.repeat(73) });
    assert.equal(long.status, 400);
  });

  test('an email can only be signed up once', async () => {
    const call = await server.client();
    const again = await server.request('POST', '/auth/register', { email: call.email, password: 'another password' });
    assert.equal(again.status, 409);
  });

  test('a wrong password and an unknown email get the same answer', async () => {
    const call = await server.client();
    const wrong = await server.request('POST', '/auth/login', { email: call.email, password: 'wrong password' });
    const unknown = await server.request('POST', '/auth/login', { email: 'nobody@example.test', password: 'wrong password' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.ok(!('token' in wrong.body));
  });

  test('every tracker route needs a valid token', async () => {
    const call = await server.client();
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [call.email]);
    const forged = jwt.sign({ sub: String(rows[0].id) }, 'some other secret');
    const expired = jwt.sign({ sub: String(rows[0].id), exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret');
    const unsigned = jwt.sign({ sub: String(rows[0].id) }, null, { algorithm: 'none' });
    for (const token of [undefined, 'garbage', forged, expired, unsigned]) {
      for (const [method, path, body] of [
        ['GET', `/dashboard?date=${TODAY}`],
        ['GET', '/export'],
        ['POST', '/meals', MEAL],
        ['DELETE', '/meals/1'],
        ['POST', '/import', { app: 'calorie-weight-tracker' }],
        ['POST', '/reset', {}],
        ['GET', '/online-foods?q=milk'],
      ]) {
        const res = await server.request(method, path, body, token);
        assert.equal(res.status, 401, `${method} ${path} with ${token}`);
      }
    }
    assert.equal((await server.request('GET', '/health')).status, 200);
  });

  test('API responses are never cached', async () => {
    const call = await server.client();
    assert.equal((await call('GET', `/dashboard?date=${TODAY}`)).headers.get('cache-control'), 'no-store');
  });

  test('deleting an account needs the password and removes every row', async () => {
    const call = await server.client();
    await call('PUT', '/profile', PROFILE);
    await call('POST', '/demo', { today: TODAY });
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [call.email]);
    const id = rows[0].id;
    assert.equal((await call('POST', '/account/delete', { password: 'wrong password' })).status, 401);
    await call('PUT', '/settings', { fdcKey: 'k'.repeat(40) });
    assert.equal((await call('POST', '/account/delete', { password: call.password })).status, 204);
    assert.equal((await call('GET', `/dashboard?date=${TODAY}`)).status, 401);
    for (const table of ['profiles', 'weights', 'meals', 'water', 'exercises', 'checkins', 'fasts', 'id_counters', 'user_settings']) {
      const left = await db.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [id]);
      assert.equal(left.rows.length, 0, table);
    }
  });

  test('a missing JWT secret fails closed', async () => {
    const broken = await startServer({ jwtSecret: undefined });
    const res = await broken.request('POST', '/auth/register', { email: 'x@example.test', password: 'long enough pw' });
    assert.equal(res.status, 500);
    assert.equal((await broken.request('GET', `/dashboard?date=${TODAY}`, null, 'anything')).status, 500);
    await broken.close();
  });
});

describe('each account only sees its own data', () => {
  let server;
  let alice;
  let bob;
  before(async () => {
    server = await startServer();
    alice = await server.client();
    bob = await server.client();
    await alice('PUT', '/profile', PROFILE);
    await alice('POST', '/weights', { date: TODAY, kg: 66 });
    await alice('POST', '/meals', MEAL);
    await alice('POST', '/my-foods', { name: 'Kopi peng', kcal: 40 });
    await alice('PUT', '/water', { date: TODAY, ml: 750 });
    await alice('POST', '/exercises', { date: TODAY, activity: 'badminton', minutes: 30 });
    await alice('POST', '/measurements', { date: TODAY, waistCm: 80 });
    await alice('PUT', '/checkins', { date: TODAY, sleepHours: 7, mood: 4, note: 'private note' });
    await alice('POST', '/fasts/start', { time: '2026-10-26T01:00:00.000Z' });
  });
  after(() => server.close());

  const aliceSnapshot = async () => ({
    dashboard: (await alice('GET', `/dashboard?date=${TODAY}`)).body,
    export: (await alice('GET', '/export')).body,
  });

  test("a new account starts empty, even with someone else's ids in use", async () => {
    const d = (await bob('GET', `/dashboard?date=${TODAY}`)).body;
    assert.equal(d.setupNeeded, true);
    assert.equal(d.profile, null);
    assert.equal(d.today.totals.kcal, 0);
    assert.equal(d.water.ml, 0);
    assert.equal(d.checkin, null);
    assert.equal(d.fasting.active, null);
    const dump = (await bob('GET', '/export')).body;
    for (const key of ['weights', 'meals', 'foods', 'water', 'exercises', 'measurements', 'fasts', 'checkins']) {
      assert.deepEqual(dump[key], [], key);
    }
    assert.deepEqual((await bob('GET', `/meals?date=${TODAY}`)).body, []);
    assert.deepEqual((await bob('GET', '/my-foods')).body, []);
    assert.deepEqual((await bob('GET', `/recent-foods?date=${TODAY}`)).body, []);
    assert.equal((await bob('GET', '/foods?q=kopi%20peng')).body.some((r) => r.food.source.kind === 'mine'), false);
  });

  test("ids are per account, and one account can't touch another's rows", async () => {
    const before = await aliceSnapshot();
    const id = before.dashboard.today.meals.find((s) => s.slot === 'lunch').items[0].id;
    assert.equal(id, 1);
    // Bob has no meal 1 yet, so every attempt on Alice's misses.
    assert.equal((await bob('PUT', `/meals/${id}`, { ...MEAL, kcal: 1 })).status, 404);
    assert.equal((await bob('DELETE', `/meals/${id}`)).status, 404);
    assert.equal((await bob('DELETE', '/my-foods/1')).status, 404);
    assert.equal((await bob('DELETE', '/exercises/1')).status, 404);
    assert.equal((await bob('DELETE', '/fasts/1')).status, 404);
    assert.equal((await bob('DELETE', `/weights/${TODAY}`)).status, 404);
    assert.equal((await bob('DELETE', `/measurements/${TODAY}`)).status, 404);
    assert.equal((await bob('DELETE', `/checkins/${TODAY}`)).status, 404);
    assert.equal((await bob('POST', '/fasts/end', { time: '2026-10-26T09:00:00.000Z' })).status, 404);

    // Bob's own meal 1 is a different row: changing it leaves Alice's alone.
    const mine = (await bob('POST', '/meals', { ...MEAL, name: 'Bob lunch' })).body;
    assert.equal(mine.id, 1);
    assert.equal((await bob('PUT', '/meals/1', { ...MEAL, name: 'Bob dinner', slot: 'dinner' })).status, 200);
    assert.equal((await bob('DELETE', '/meals/1')).status, 204);
    // Same dates, separate rows.
    await bob('POST', '/weights', { date: TODAY, kg: 90 });
    await bob('PUT', '/water', { date: TODAY, ml: 2000 });
    await bob('PUT', '/checkins', { date: TODAY, mood: 1 });
    await bob('POST', '/meals/copy', { from: TODAY, to: '2026-10-27' });

    assert.deepEqual(await aliceSnapshot(), before);
  });

  test("import, sample data and start fresh only replace the caller's data", async () => {
    const before = await aliceSnapshot();
    assert.equal((await bob('POST', '/demo', { today: TODAY })).status, 204);
    assert.equal((await bob('POST', '/import', { app: 'calorie-weight-tracker', weights: [{ date: TODAY, kg: 99 }] })).status, 200);
    assert.equal((await bob('POST', '/reset', {})).status, 204);
    assert.deepEqual(await aliceSnapshot(), before);
    assert.equal(before.export.checkins[0].note, 'private note');
  });

  test('the USDA key is saved per account and follows the login', async () => {
    const key = 'A'.repeat(20) + 'b1'.repeat(10);
    assert.deepEqual((await alice('GET', '/settings')).body, { fdcKey: null });
    assert.deepEqual((await alice('PUT', '/settings', { fdcKey: ` ${key} ` })).body, { fdcKey: key });
    // A second device logging in to the same account gets it.
    const other = await server.request('POST', '/auth/login', { email: alice.email, password: alice.password });
    assert.equal((await server.request('GET', '/settings', null, other.body.token)).body.fdcKey, key);
    // Nobody else does.
    assert.deepEqual((await bob('GET', '/settings')).body, { fdcKey: null });
    assert.equal((await alice('PUT', '/settings', { fdcKey: 'not a key!' })).status, 400);
    assert.equal((await server.request('GET', '/settings')).status, 401);
    assert.deepEqual((await alice('PUT', '/settings', { fdcKey: '' })).body, { fdcKey: null });
  });

  test('a store refuses to run without a user id', () => {
    assert.throws(() => createPgStore(db, undefined));
    assert.throws(() => createPgStore(db, '1'));
  });
});

describe('moving data from the browser version', () => {
  test('a browser export imports into an account unchanged', async () => {
    const server = await startServer();
    // The Pages app keeps everything in the memory store (+ localStorage).
    const browser = createTracker(createMemoryStore());
    await browser.loadDemo(TODAY);
    await browser.addFood({ name: 'Protein bar', kcal: 380, protein: 33, carbs: 35, fat: 12, servingUnit: 'bar', servingGrams: 60 });
    await browser.startFast('2026-10-26T01:00:00.000Z');
    // Exported JSON goes through a file, so round-trip it as text.
    const file = JSON.parse(JSON.stringify(await browser.exportData()));

    const call = await server.client();
    const res = await call('POST', '/import', file);
    assert.equal(res.status, 200);
    assert.equal(res.body.meals, file.meals.length);
    assert.deepEqual((await call('GET', '/export')).body, await browser.exportData());
    assert.deepEqual((await call('GET', `/dashboard?date=${TODAY}`)).body, await browser.dashboard(TODAY));
    // The next entry carries on from the imported ids, like the browser store.
    const next = (await call('POST', '/meals', MEAL)).body;
    assert.equal(next.id, (await browser.addMeal({ ...MEAL, protein: 0, carbs: 0, fat: 0 })).id);
    await server.close();
  });
});

describe('rate limits', () => {
  let server;
  before(async () => {
    server = await startServer({
      trustProxy: true,
      limits: { signup: { max: 2, windowSec: 3600 }, login: { max: 3, windowSec: 900 }, writes: { max: 4, windowSec: 60 } },
    });
  });
  after(() => server.close());

  // Fresh addresses each run, in case the database outlives the test run.
  const run = Math.random().toString(16).slice(2, 6);
  const from = (n) => ({ 'x-forwarded-for': `2001:db8:${run}::${n}, 10.0.0.1` });

  test('sign-ups per address', async () => {
    const ip = 'a1';
    const signUp = (n) =>
      server.request('POST', '/auth/register', { email: `rl-${n}-${Date.now()}@example.test`, password: 'long enough pw' }, null, from(ip));
    assert.equal((await signUp(1)).status, 201);
    assert.equal((await signUp(2)).status, 201);
    const blocked = await signUp(3);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Another address is still fine.
    const other = await server.request('POST', '/auth/register', { email: `rl-other-${Date.now()}@example.test`, password: 'long enough pw' }, null, from('a2'));
    assert.equal(other.status, 201);
  });

  test('logins per email, even from many addresses', async () => {
    const email = `target-${Date.now()}@example.test`;
    await server.request('POST', '/auth/register', { email, password: 'the real password' }, null, from('b1'));
    for (let i = 0; i < 3; i++) {
      const res = await server.request('POST', '/auth/login', { email, password: 'guess' }, null, from(`b${i + 2}`));
      assert.equal(res.status, 401);
    }
    // Locked for this window, even with the right password from a new address.
    const res = await server.request('POST', '/auth/login', { email, password: 'the real password' }, null, from('b99'));
    assert.equal(res.status, 429);
  });

  test('writes per account; reads are not limited', async () => {
    const res = await server.request('POST', '/auth/register', { email: `w-${Date.now()}@example.test`, password: 'long enough pw' }, null, from('c1'));
    const token = res.body.token;
    for (let i = 0; i < 4; i++) {
      assert.equal((await server.request('PUT', '/water', { date: TODAY, ml: 250 * (i + 1) }, token)).status, 200);
    }
    assert.equal((await server.request('PUT', '/water', { date: TODAY, ml: 5000 }, token)).status, 429);
    assert.equal((await server.request('GET', `/dashboard?date=${TODAY}`, null, token)).status, 200);
  });
});
