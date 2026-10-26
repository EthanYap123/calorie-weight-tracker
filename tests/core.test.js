import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateMaintenance } from '../core/adaptive.js';
import { addDays, daysBetween, isIsoDate } from '../core/dates.js';
import { FOODS, customToFood, nutritionFor, searchFoods } from '../core/foods.js';
import { interpret, parseEntry, resolveAmount } from '../core/parse.js';
import { bmr, calorieTarget, formulaMaintenance, macroTargets } from '../core/nutrition.js';
import { dailyIntake, loggingStreak } from '../core/summary.js';
import { projectGoal, weeklyRate, weightTrend } from '../core/trend.js';
import {
  ValidationError,
  validateCustomFood,
  validateMeal,
  validateProfile,
  validateWeight,
} from '../core/validate.js';

const profile = {
  name: '',
  sex: 'male',
  age: 25,
  heightCm: 175,
  activity: 'moderate',
  goalKg: 70,
  weeklyRateKg: 0.5,
};

describe('dates', () => {
  test('rejects impossible dates', () => {
    assert.ok(isIsoDate('2024-02-29'));
    assert.ok(!isIsoDate('2023-02-29'));
    assert.ok(!isIsoDate('2024-2-1'));
    assert.ok(!isIsoDate(20240101));
  });

  test('day maths crosses months and leap days', () => {
    assert.equal(addDays('2024-02-28', 2), '2024-03-01');
    assert.equal(daysBetween('2023-12-25', '2024-01-08'), 14);
  });
});

describe('nutrition', () => {
  test('Mifflin-St Jeor matches worked examples', () => {
    assert.equal(bmr(profile, 80), 10 * 80 + 6.25 * 175 - 5 * 25 + 5); // 1773.75
    assert.equal(bmr({ ...profile, sex: 'female' }, 60), 600 + 1093.75 - 125 - 161);
  });

  test('target is maintenance minus 550 kcal for 0.5 kg a week', () => {
    const plan = calorieTarget(profile, 80);
    const maintenance = formulaMaintenance(profile, 80);
    assert.equal(plan.direction, 'lose');
    assert.ok(Math.abs(plan.target - (maintenance - 550)) <= 5);
    assert.deepEqual(plan.warnings, []);
  });

  test('switches to maintenance near the goal', () => {
    const plan = calorieTarget(profile, 70.3);
    assert.equal(plan.direction, 'maintain');
    assert.equal(plan.target, plan.maintenance);
  });

  test('caps loss at 1% of body weight a week', () => {
    const plan = calorieTarget({ ...profile, weeklyRateKg: 1, goalKg: 45 }, 55);
    assert.equal(plan.weeklyRateKg, 0.55);
    assert.match(plan.warnings[0], /capped/);
  });

  test('never goes below the calorie floor', () => {
    const small = { ...profile, sex: 'female', age: 60, heightCm: 150, activity: 'sedentary', goalKg: 45 };
    const plan = calorieTarget(small, 55, 1500);
    assert.equal(plan.target, 1200);
    assert.ok(plan.warnings.some((w) => w.includes('1200')));
  });

  test('macros add back up to the target', () => {
    const m = macroTargets(2000, 75);
    assert.equal(m.protein, 120);
    const kcal = m.protein * 4 + m.carbs * 4 + m.fat * 9;
    assert.ok(Math.abs(kcal - 2000) < 10);
  });
});

describe('weight trend', () => {
  test('a constant weight gives a flat trend', () => {
    const series = weightTrend([0, 1, 2, 3].map((i) => ({ date: addDays('2026-01-01', i), kg: 70 })));
    assert.ok(series.every((p) => p.trend === 70));
  });

  test('a single heavy day only moves the trend 10%', () => {
    const series = weightTrend([
      { date: '2026-01-01', kg: 70 },
      { date: '2026-01-02', kg: 72 },
    ]);
    assert.equal(series[1].trend, 70.2);
  });

  test('gaps count as several smoothing steps', () => {
    const series = weightTrend([
      { date: '2026-01-01', kg: 70 },
      { date: '2026-01-11', kg: 68 },
    ]);
    // 1 - 0.9^10 = 0.651 of the way
    assert.equal(series[1].trend, 68.7);
  });

  test('sorts unordered input', () => {
    const series = weightTrend([
      { date: '2026-01-03', kg: 69 },
      { date: '2026-01-01', kg: 70 },
    ]);
    assert.deepEqual(series.map((p) => p.date), ['2026-01-01', '2026-01-03']);
  });

  test('weekly rate recovers a steady loss', () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({
      date: addDays('2026-01-01', i),
      kg: 80 - (0.6 / 7) * i,
    }));
    assert.equal(weeklyRate(entries, '2026-01-21'), -0.6);
  });

  test('weekly rate needs at least a week of weigh-ins', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => ({ date: addDays('2026-01-01', i), kg: 80 }));
    assert.equal(weeklyRate(entries, '2026-01-05'), null);
  });

  test('projects the goal date only when heading towards it', () => {
    assert.deepEqual(projectGoal(75, 72, -0.5, '2026-01-01'), { date: '2026-02-12', weeks: 6 });
    assert.equal(projectGoal(75, 72, 0.3, '2026-01-01'), null);
    assert.equal(projectGoal(75, 72, null, '2026-01-01'), null);
    assert.deepEqual(projectGoal(72.05, 72, -0.5, '2026-01-01'), { date: '2026-01-01', weeks: 0 });
  });
});

describe('adaptive maintenance', () => {
  // 28 days eating 2,000 kcal while losing 0.5 kg a week => burning 2,550.
  const end = '2026-01-28';
  const days = Array.from({ length: 28 }, (_, i) => addDays('2026-01-01', i));
  const meals = days.flatMap((date) => [
    { date, kcal: 900 },
    { date, kcal: 1100 },
  ]);
  const weights = days.map((date, i) => ({ date, kg: 80 - (0.5 / 7) * i }));

  test('recovers maintenance from intake and weight change', () => {
    const est = estimateMaintenance(meals, weights, end);
    assert.equal(est.ready, true);
    assert.equal(est.maintenance, 2550);
    assert.equal(est.avgIntake, 2000);
    assert.equal(est.confidence, 'high');
  });

  test('skips half-logged days', () => {
    const partial = [...meals, { date: '2025-12-31', kcal: 300 }];
    const withLow = partial.map((m) => (m.date === '2026-01-05' ? { ...m, kcal: 200 } : m));
    const est = estimateMaintenance(withLow, weights, end);
    assert.equal(est.loggedDays, 27);
    assert.equal(est.avgIntake, 2000);
  });

  test('waits for enough data', () => {
    // 20 rows = the first 10 days, short of the 14 needed.
    const est = estimateMaintenance(meals.slice(0, 20), weights, end);
    assert.equal(est.ready, false);
    assert.equal(est.loggedDays, 10);
  });
});

describe('summary', () => {
  const meals = ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05'].map((date) => ({ date, kcal: 500 }));

  test('streak counts back from today and forgives an empty today', () => {
    assert.equal(loggingStreak(meals, '2026-01-05'), 2);
    assert.equal(loggingStreak(meals, '2026-01-06'), 2);
    assert.equal(loggingStreak(meals, '2026-01-07'), 0);
  });

  test('daily intake fills empty days with zero', () => {
    assert.deepEqual(
      dailyIntake(meals, '2026-01-02', '2026-01-04').map((d) => d.kcal),
      [500, 0, 500],
    );
  });
});

describe('food data', () => {
  test('ids are unique and every food has a portion', () => {
    const ids = FOODS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const f of FOODS) assert.ok(f.portions.length > 0, f.id);
  });

  // Energy should match protein x 4 + carbs x 4 + fat x 9 (Atwater factors).
  // USDA uses food-specific factors, so allow a small gap. Alcoholic drinks
  // get most of their energy from alcohol, which isn't a macro tracked here.
  const ALCOHOL = new Set(['beer', 'wine-red', 'spirits']);
  test('calories agree with the macros for every food', () => {
    for (const f of FOODS.filter((x) => !ALCOHOL.has(x.id))) {
      const fromMacros = 4 * f.protein + 4 * f.carbs + 9 * f.fat;
      assert.ok(Math.abs(f.kcal - fromMacros) <= Math.max(16, f.kcal * 0.15), `${f.id}: ${f.kcal} vs ${fromMacros}`);
    }
  });

  test('white rice uses the USDA values', () => {
    const rice = FOODS.find((f) => f.id === 'rice-white');
    assert.equal(rice.kcal, 130);
    assert.equal(rice.source.fdcId, 168878);
    assert.deepEqual(nutritionFor(rice, 200), { kcal: 260, protein: 5.4, carbs: 56.4, fat: 0.6 });
  });
});

describe('food search', () => {
  test('an exact alias wins: "rice" is plain rice, not chicken rice', () => {
    assert.equal(searchFoods('rice')[0].id, 'rice-white');
    assert.equal(searchFoods('chicken rice')[0].id, 'chicken-rice');
    assert.equal(searchFoods('kopi o kosong')[0].id, 'kopi-o-kosong');
  });

  test('plurals and partial words match', () => {
    assert.equal(searchFoods('eggs')[0].id, 'egg-boiled');
    assert.equal(searchFoods('potatoes')[0].id, 'potato');
    assert.equal(searchFoods('chick rice')[0].id, 'chicken-rice');
  });

  test('every word must match', () => {
    assert.deepEqual(searchFoods('chicken pizza'), []);
    assert.deepEqual(searchFoods('   '), []);
  });

  test('saved foods are searched too', () => {
    const mine = customToFood({ id: 3, name: 'Marigold HL milk', kcal: 47, protein: 3.4, carbs: 4.8, fat: 1.6, servingUnit: 'packet', servingGrams: 200 });
    assert.equal(searchFoods('marigold', [mine])[0].id, 'my-3');
  });
});

describe('typing an entry', () => {
  const cases = [
    ['1 bowl white rice', { qty: 1, unit: 'bowl', query: 'white rice' }],
    ['100g white rice', { qty: 100, unit: 'g', query: 'white rice' }],
    ['100 grams of rice', { qty: 100, unit: 'g', query: 'rice' }],
    ['2 eggs', { qty: 2, unit: null, query: 'eggs' }],
    ['half a bowl of rice', { qty: 0.5, unit: 'bowl', query: 'rice' }],
    ['1 1/2 cups oats', { qty: 1.5, unit: 'cup', query: 'oats' }],
    ['1/2 plate chicken rice', { qty: 0.5, unit: 'plate', query: 'chicken rice' }],
    ['white rice 200g', { qty: 200, unit: 'g', query: 'white rice' }],
    ['chicken rice x2', { qty: 2, unit: null, query: 'chicken rice' }],
    ['300ml milk', { qty: 300, unit: 'ml', query: 'milk' }],
    ['banana', { qty: 1, unit: null, query: 'banana' }],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}"`, () => assert.deepEqual(parseEntry(text), expected));
  }

  test('"1 bowl white rice" and "200g white rice" log the same', () => {
    const a = interpret('1 bowl white rice').results[0];
    const b = interpret('200g white rice').results[0];
    assert.equal(a.amount, '1 bowl (200 g)');
    assert.equal(a.grams, 200);
    assert.equal(a.kcal, 260);
    assert.equal(b.kcal, a.kcal);
  });

  test('no unit uses the usual portion', () => {
    const r = interpret('2 eggs').results[0];
    assert.equal(r.amount, '2 large (100 g)');
    assert.equal(r.kcal, 155);
  });

  test('drinks convert ml with their density', () => {
    const r = interpret('1 glass milk').results[0];
    assert.equal(r.amount, '1 glass (250 ml)');
    assert.equal(r.grams, 258);
  });

  test('a unit the food does not have explains the options', () => {
    const r = interpret('1 slice rice').results[0];
    assert.match(r.error, /isn't measured in slices.*grams or bowl/);
  });

  test('rejects zero and negative amounts', () => {
    const rice = FOODS.find((f) => f.id === 'rice-white');
    assert.ok(resolveAmount(rice, 0, 'g').error);
    assert.ok(resolveAmount(rice, -1, 'bowl').error);
  });
});

describe('validation', () => {
  test('accepts numbers sent as form strings', () => {
    const p = validateProfile({ ...profile, age: '25', heightCm: '175', goalKg: '70', weeklyRateKg: '0.5' });
    assert.equal(p.age, 25);
    assert.equal(validateWeight({ date: '2026-01-01', kg: '72.46' }).kg, 72.5);
  });

  test('collects every problem in one error', () => {
    try {
      validateMeal({ date: 'yesterday', slot: 'brunch', kcal: -5 });
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.status, 400);
      assert.equal(err.errors.length, 4);
    }
  });

  test('saved foods are stored per 100 g, even from a per-serving label', () => {
    const f = validateCustomFood({ name: 'HL milk', per: 'serving', servingUnit: 'Packet', servingGrams: 200, kcal: 94, protein: 6.8, carbs: 9.6, fat: 3.2 });
    assert.deepEqual(f, { name: 'HL milk', kcal: 47, protein: 3.4, carbs: 4.8, fat: 1.6, servingUnit: 'packet', servingGrams: 200 });
    assert.throws(() => validateCustomFood({ name: 'x', per: 'serving', kcal: 100 }), /serving size/);
    assert.throws(() => validateCustomFood({ name: 'x', kcal: 1200 }), ValidationError);
  });

  test('rejects out-of-range weights', () => {
    assert.throws(() => validateWeight({ date: '2026-01-01', kg: 3000 }), ValidationError);
    assert.throws(() => validateWeight({ date: '2026-01-01', kg: 'abc' }), ValidationError);
  });
});
