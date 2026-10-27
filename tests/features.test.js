// BMI, body fat, exercise, water, fasting and entry editing.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { bmi, bmiCategory, bodyFatCategory, bodyFatNavy, healthyRange, waistToHeight } from '../core/body.js';
import { exerciseKcal, stepsKcal } from '../core/exercise.js';
import { createTracker } from '../core/service.js';
import { createMemoryStore } from '../core/store-memory.js';
import { pgStore, startServer } from './helpers.js';

const TODAY = '2026-10-26';
const PROFILE = { name: '', sex: 'male', age: 21, heightCm: 176, activity: 'light', goalKg: 70, weeklyRateKg: 0.5 };

describe('body maths', () => {
  test('BMI with Singapore and WHO cut-offs', () => {
    assert.equal(bmi(70, 175), 22.9);
    assert.equal(bmiCategory(22.9).label, 'Healthy');
    assert.equal(bmiCategory(23).label, 'Overweight');
    assert.equal(bmiCategory(24, 'who').label, 'Normal');
    assert.equal(bmiCategory(27.5).label, 'Obese');
  });

  test('healthy weight range for a height', () => {
    assert.deepEqual(healthyRange(176), { min: 57.3, max: 70.9 });
  });

  test('US Navy body fat matches a worked example', () => {
    // Man, 178 cm, waist 85, neck 38: 495 / (1.0324 - 0.19077 log 47 + 0.15456 log 178) - 450
    assert.equal(bodyFatNavy({ sex: 'male', heightCm: 178, waistCm: 85, neckCm: 38 }), 16.4);
    assert.equal(bodyFatCategory(16.4, 'male'), 'Fit');
    assert.equal(bodyFatNavy({ sex: 'female', heightCm: 165, waistCm: 72, neckCm: 33 }), null, 'women need hips');
    assert.equal(bodyFatNavy({ sex: 'male', heightCm: 178, waistCm: 30, neckCm: 38 }), null);
  });

  test('waist-to-height ratio', () => {
    assert.deepEqual(waistToHeight(84, 176), { ratio: 0.48, ok: true });
    assert.equal(waistToHeight(null, 176), null);
  });
});

describe('exercise maths', () => {
  test('counts only calories above resting', () => {
    // Running 10 km/h is 9.8 METs: (9.8 - 1) x 70 kg x 0.5 h
    assert.equal(exerciseKcal(9.8, 70, 30), 308);
    assert.equal(exerciseKcal(1, 70, 60), 0);
  });

  test('10,000 steps at 70 kg is about 290 kcal', () => {
    assert.equal(stepsKcal(10000, 70), 292);
  });
});

for (const [label, makeStore] of [
  ['memory store', () => createMemoryStore()],
  ['Postgres store', pgStore],
]) {
  describe(`daily features on the ${label}`, () => {
    const setup = async () => {
      const t = createTracker(await makeStore());
      await t.saveProfile(PROFILE);
      await t.logWeight({ date: TODAY, kg: 75 });
      return t;
    };

    test('water adds up and can be cleared', async () => {
      const t = await setup();
      await t.setWater({ date: TODAY, ml: 750 });
      let d = await t.dashboard(TODAY);
      assert.deepEqual([d.water.ml, d.water.goal], [750, 2000]);
      await t.setWater({ date: TODAY, ml: 0 });
      d = await t.dashboard(TODAY);
      assert.equal(d.water.ml, 0);
    });

    test('exercise uses body weight and only counts toward the target when chosen', async () => {
      const t = await setup();
      const run = await t.addExercise({ date: TODAY, activity: 'running-10', minutes: 30 });
      assert.equal(run.kcal, exerciseKcal(9.8, 75, 30));
      await t.addExercise({ date: TODAY, activity: 'steps', steps: 6000 });
      let d = await t.dashboard(TODAY);
      assert.equal(d.today.burned, run.kcal + stepsKcal(6000, 75));
      assert.equal(d.today.budget, d.plan.target);

      await t.saveProfile({ ...PROFILE, eatBackExercise: true });
      d = await t.dashboard(TODAY);
      assert.equal(d.today.budget, d.plan.target + d.today.burned);

      await t.deleteExercise(run.id);
      await assert.rejects(t.deleteExercise(run.id), { status: 404 });
      await assert.rejects(t.addExercise({ date: TODAY, activity: 'flying', minutes: 10 }), { status: 400 });
    });

    test('exercise needs a weight to work out the burn', async () => {
      const t = createTracker(await makeStore());
      await assert.rejects(t.addExercise({ date: TODAY, activity: 'gym', minutes: 45 }), /Log your weight first/);
    });

    test('BMI and body fat use the trend and the latest tape measurements', async () => {
      const t = await setup();
      await t.logMeasurement({ date: '2026-10-20', waistCm: 86, neckCm: 38 });
      await t.logMeasurement({ date: TODAY, waistCm: 84 });
      const d = await t.dashboard(TODAY);
      assert.equal(d.body.bmi, bmi(75, 176));
      assert.deepEqual(d.body.tape, { waistCm: 84, neckCm: 38, hipCm: null });
      assert.equal(d.body.bodyFat, bodyFatNavy({ sex: 'male', heightCm: 176, waistCm: 84, neckCm: 38 }));
      await assert.rejects(t.logMeasurement({ date: TODAY }), /at least one/);
    });

    test('a fast can start, end and be listed; only one runs at a time', async () => {
      const t = await setup();
      await t.startFast('2026-10-25T12:00:00.000Z');
      await assert.rejects(t.startFast('2026-10-25T13:00:00.000Z'), /already running/);
      let d = await t.dashboard(TODAY);
      assert.equal(d.fasting.active.start, '2026-10-25T12:00:00.000Z');
      await assert.rejects(t.endFast('2026-10-25T11:00:00.000Z'), /after it started/);
      await t.endFast('2026-10-26T04:30:00.000Z');
      d = await t.dashboard(TODAY);
      assert.equal(d.fasting.active, null);
      assert.equal(d.fasting.recent[0].hours, 16.5);
      await assert.rejects(t.endFast('2026-10-26T05:00:00.000Z'), { status: 404 });
    });

    test('entries can be edited, copied to another day and re-logged from Recent', async () => {
      const t = await setup();
      const yesterday = '2026-10-25';
      const rice = { date: yesterday, slot: 'lunch', name: 'White rice (cooked)', amount: '1 bowl (200 g)', grams: 200, kcal: 260, protein: 5.4, carbs: 56.3, fat: 0.6 };
      const saved = await t.addMeal(rice);
      const edited = await t.updateMeal(saved.id, { ...rice, amount: '150 g', grams: 150, kcal: 195 });
      assert.equal(edited.kcal, 195);
      await assert.rejects(t.updateMeal(999, rice), { status: 404 });

      assert.deepEqual(await t.copyMeals({ from: yesterday, to: TODAY, slot: 'lunch' }), { copied: 1 });
      assert.deepEqual(await t.copyMeals({ from: yesterday, to: TODAY, slot: 'dinner' }), { copied: 0 });
      const [copy] = await t.listMeals(TODAY);
      assert.equal(copy.amount, '150 g');

      const [recent] = await t.recentFoods(TODAY);
      assert.deepEqual([recent.name, recent.amount, recent.count], ['White rice (cooked)', '150 g', 2]);
    });

    test('export and import keep every kind of entry', async () => {
      const a = await setup();
      await a.setWater({ date: TODAY, ml: 1500 });
      await a.addExercise({ date: TODAY, activity: 'gym', minutes: 45 });
      await a.logMeasurement({ date: TODAY, waistCm: 84, neckCm: 38 });
      await a.startFast('2026-10-25T12:00:00.000Z');
      const dump = await a.exportData();
      const b = createTracker(await makeStore());
      await b.importData(dump);
      assert.deepEqual(await b.exportData(), dump);
      assert.deepEqual(await b.dashboard(TODAY), await a.dashboard(TODAY));
    });
  });
}

describe('HTTP API for the daily features', () => {
  let server;
  let call;
  before(async () => {
    server = await startServer();
    call = await server.client();
  });
  after(() => server.close());

  test('API and browser store stay identical', async () => {
    const local = createTracker(createMemoryStore());
    const steps = [
      ['PUT', '/profile', PROFILE, (t) => t.saveProfile(PROFILE)],
      ['POST', '/weights', { date: TODAY, kg: 75 }, (t) => t.logWeight({ date: TODAY, kg: 75 })],
      ['PUT', '/water', { date: TODAY, ml: 1250 }, (t) => t.setWater({ date: TODAY, ml: 1250 })],
      ['POST', '/exercises', { date: TODAY, activity: 'badminton', minutes: 60 }, (t) => t.addExercise({ date: TODAY, activity: 'badminton', minutes: 60 })],
      ['POST', '/measurements', { date: TODAY, waistCm: 84, neckCm: 38 }, (t) => t.logMeasurement({ date: TODAY, waistCm: 84, neckCm: 38 })],
      ['PUT', '/checkins', { date: TODAY, sleepHours: 7, mood: 4 }, (t) => t.logCheckin({ date: TODAY, sleepHours: 7, mood: 4 })],
      ['POST', '/fasts/start', { time: '2026-10-25T12:00:00.000Z' }, (t) => t.startFast('2026-10-25T12:00:00.000Z')],
      ['POST', '/fasts/end', { time: '2026-10-26T04:00:00.000Z' }, (t) => t.endFast('2026-10-26T04:00:00.000Z')],
      ['POST', '/meals', { date: TODAY, slot: 'lunch', name: 'Laksa', amount: '1 bowl (520 g)', grams: 520, kcal: 589 }, (t) =>
        t.addMeal({ date: TODAY, slot: 'lunch', name: 'Laksa', amount: '1 bowl (520 g)', grams: 520, kcal: 589 })],
      ['PUT', '/meals/1', { date: TODAY, slot: 'dinner', name: 'Laksa', amount: '260 g', grams: 260, kcal: 295 }, (t) =>
        t.updateMeal(1, { date: TODAY, slot: 'dinner', name: 'Laksa', amount: '260 g', grams: 260, kcal: 295 })],
    ];
    for (const [method, path, body, run] of steps) {
      const res = await call(method, path, body);
      assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
      await run(local);
    }
    assert.deepEqual((await call('GET', `/dashboard?date=${TODAY}`)).body, await local.dashboard(TODAY));
    assert.deepEqual((await call('GET', `/recent-foods?date=${TODAY}`)).body, await local.recentFoods(TODAY));
  });

  test('bad input is a 400 with the reason', async () => {
    const res = await call('POST', '/exercises', { date: TODAY, activity: 'gym' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Minutes/);
  });
});
