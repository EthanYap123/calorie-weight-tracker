// The tracker service on both stores, plus the HTTP API. The parity test is
// what keeps the browser demo honest: the same actions through the Express
// API (SQLite) and through the in-browser store must give identical results.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DEMO_TRUE_MAINTENANCE } from '../core/seed.js';
import { createTracker } from '../core/service.js';
import { createMemoryStore } from '../core/store-memory.js';
import { createApp } from '../server/app.js';
import { createSqliteStore } from '../server/sqlite-store.js';

const TODAY = '2026-10-26';
const PROFILE = { name: 'Sam', sex: 'female', age: 30, heightCm: 165, activity: 'light', goalKg: 60, weeklyRateKg: 0.5 };

for (const [label, makeStore] of [
  ['memory store', () => createMemoryStore()],
  ['SQLite store', () => createSqliteStore()],
]) {
  describe(`tracker on the ${label}`, () => {
    test('asks for setup until there is a profile and a weigh-in', async () => {
      const t = createTracker(makeStore());
      assert.equal((await t.dashboard(TODAY)).setupNeeded, true);
      await t.saveProfile(PROFILE);
      assert.equal((await t.dashboard(TODAY)).setupNeeded, true);
      await t.logWeight({ date: TODAY, kg: 66 });
      const d = await t.dashboard(TODAY);
      assert.equal(d.setupNeeded, false);
      assert.equal(d.plan.source, 'formula');
      assert.equal(d.today.remaining, d.plan.target);
    });

    test('logs and removes food', async () => {
      const t = createTracker(makeStore());
      await t.saveProfile(PROFILE);
      await t.logWeight({ date: TODAY, kg: 66 });
      const meal = await t.addMeal({ date: TODAY, slot: 'lunch', name: 'Laksa', kcal: 589, protein: 22, carbs: 55, fat: 32 });
      await t.addMeal({ date: TODAY, slot: 'snacks', name: 'Apple', kcal: 95 });

      let d = await t.dashboard(TODAY);
      assert.equal(d.today.totals.kcal, 684);
      assert.equal(d.today.meals.find((s) => s.slot === 'lunch').items[0].name, 'Laksa');
      assert.equal(d.streak, 1);

      await t.deleteMeal(meal.id);
      d = await t.dashboard(TODAY);
      assert.equal(d.today.totals.kcal, 95);
      await assert.rejects(t.deleteMeal(meal.id), { status: 404 });
    });

    test('a second weigh-in on the same day replaces the first', async () => {
      const t = createTracker(makeStore());
      await t.logWeight({ date: TODAY, kg: 66 });
      await t.logWeight({ date: TODAY, kg: 65.4 });
      const d = await t.dashboard(TODAY);
      assert.equal(d.weight.series.length, 1);
      assert.equal(d.weight.latest.kg, 65.4);
    });

    test('ignores entries after the day being viewed', async () => {
      const t = createTracker(makeStore());
      await t.logWeight({ date: '2026-10-20', kg: 66 });
      await t.logWeight({ date: TODAY, kg: 64 });
      const d = await t.dashboard('2026-10-21');
      assert.equal(d.weight.latest.kg, 66);
    });

    test('sample data gives back the true maintenance', async () => {
      const t = createTracker(makeStore());
      await t.loadDemo(TODAY);
      const d = await t.dashboard(TODAY);
      assert.equal(d.adaptive.ready, true);
      assert.ok(Math.abs(d.adaptive.maintenance - DEMO_TRUE_MAINTENANCE) <= 150, `got ${d.adaptive.maintenance}`);
      assert.equal(d.plan.source, 'adaptive');
      assert.ok(d.weight.weeklyRate < 0);
      assert.ok(d.weight.goal, 'projects a goal date');
    });

    test('saved foods can be searched, logged by amount and deleted', async () => {
      const t = createTracker(makeStore());
      const food = await t.addFood({ name: 'Marigold HL milk', per: 'serving', servingUnit: 'packet', servingGrams: 200, kcal: 94, protein: 6.8, carbs: 9.6, fat: 3.2 });
      const [hit] = await t.searchFoods('2 packets hl milk');
      assert.equal(hit.food.id, `my-${food.id}`);
      assert.equal(hit.amount, '2 packets (400 g)');
      assert.equal(hit.kcal, 188);
      await t.deleteFood(food.id);
      assert.deepEqual(await t.listFoods(), []);
      await assert.rejects(t.deleteFood(food.id), { status: 404 });
    });

    test('meals keep their amount and grams', async () => {
      const t = createTracker(makeStore());
      const [rice] = await t.searchFoods('1 bowl white rice');
      const { food, qty, unit, ...entry } = rice;
      const saved = await t.addMeal({ date: TODAY, slot: 'lunch', name: food.name, ...entry });
      assert.equal(saved.amount, '1 bowl (200 g)');
      assert.equal(saved.grams, 200);
      const [meal] = await t.listMeals(TODAY);
      assert.equal(meal.kcal, 260);
    });

    test('export and import round-trip', async () => {
      const a = createTracker(makeStore());
      await a.loadDemo(TODAY);
      await a.addFood({ name: 'Protein bar', kcal: 380, protein: 33, carbs: 35, fat: 12, servingUnit: 'bar', servingGrams: 60 });
      const dump = await a.exportData();
      const b = createTracker(makeStore());
      const counts = await b.importData(dump);
      assert.equal(counts.weights, dump.weights.length);
      assert.equal(counts.foods, 1);
      assert.deepEqual(await b.listFoods(), await a.listFoods());
      assert.deepEqual(await b.dashboard(TODAY), await a.dashboard(TODAY));
      await assert.rejects(b.importData({ hello: 1 }), { status: 400 });
    });
  });
}

describe('HTTP API', () => {
  let server;
  let base;
  before(async () => {
    server = createApp(createSqliteStore()).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${server.address().port}/api`;
  });
  after(() => server.close());

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  test('validation errors come back as 400 with every message', async () => {
    const res = await call('POST', '/meals', { date: '2026-13-01', slot: 'lunch' });
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.length >= 3);
  });

  test('unknown ids are 404, unknown routes are 404 JSON', async () => {
    assert.equal((await call('DELETE', '/meals/999')).status, 404);
    assert.equal((await call('GET', '/nope')).body.error, 'Not found.');
  });

  test('food search', async () => {
    const res = await call('GET', '/foods?q=1%20bowl%20laksa');
    assert.equal(res.body[0].food.name, 'Laksa');
    assert.equal(res.body[0].amount, '1 bowl (520 g)');
  });

  test('API and browser store give identical dashboards', async () => {
    const local = createTracker(createMemoryStore());
    const steps = [
      ['PUT', '/profile', PROFILE, (t) => t.saveProfile(PROFILE)],
      ['POST', '/demo', { today: TODAY }, (t) => t.loadDemo(TODAY)],
      ['POST', '/weights', { date: TODAY, kg: 74.2 }, (t) => t.logWeight({ date: TODAY, kg: 74.2 })],
      ['POST', '/meals', { date: TODAY, slot: 'dinner', name: 'Laksa', amount: '1 bowl (520 g)', grams: 520, kcal: 589 }, (t) =>
        t.addMeal({ date: TODAY, slot: 'dinner', name: 'Laksa', amount: '1 bowl (520 g)', grams: 520, kcal: 589 })],
      ['POST', '/my-foods', { name: 'Kopi peng', kcal: 40 }, (t) => t.addFood({ name: 'Kopi peng', kcal: 40 })],
    ];
    for (const [method, path, body, run] of steps) {
      await call(method, path, body);
      await run(local);
    }
    for (const date of [TODAY, '2026-10-12']) {
      const remote = (await call('GET', `/dashboard?date=${date}`)).body;
      assert.deepEqual(remote, await local.dashboard(date));
    }
    assert.deepEqual((await call('GET', '/export')).body, await local.exportData());
    assert.deepEqual((await call('GET', '/foods?q=kopi%20peng')).body, await local.searchFoods('kopi peng'));
  });
});
