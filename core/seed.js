// Eight weeks of believable sample data for the demo. A simulated person
// with a true maintenance of 2,500 kcal eats real dishes from the food list;
// their weight follows what they ate, plus day-to-day water noise. The
// adaptive estimate should land close to 2,500 when it reads this back.
import { addDays } from './dates.js';
import { findFood, nutritionFor } from './foods.js';
import { exerciseKcal, findActivity, stepsKcal } from './exercise.js';
import { KCAL_PER_KG } from './nutrition.js';
import { resolveAmount } from './parse.js';

export const DEMO_TRUE_MAINTENANCE = 2500;
export const DEMO_DAYS = 56;

export const DEMO_PROFILE = {
  name: 'Alex',
  sex: 'male',
  age: 21,
  heightCm: 176,
  activity: 'light',
  goalKg: 72,
  weeklyRateKg: 0.5,
  waterGoalMl: 2500,
  eatBackExercise: false,
  fastingHours: 16,
};

// Weekly routine for the sample exercise log: [weekday, activity id, minutes]
const WORKOUTS = [
  [1, 'gym', 50],
  [3, 'running-10', 30],
  [5, 'gym', 50],
  [6, 'badminton', 90],
];

// Each option is one meal: [food id, amount, unit][]; unit null = the food's usual portion.
const MENU = {
  breakfast: [
    [['kaya-toast', 1, null], ['egg-boiled', 2, null], ['kopi', 1, null]],
    [['oats', 1, null], ['banana', 1, null], ['milk-lowfat', 1, 'glass']],
    [['egg-boiled', 2, null], ['bread-wholemeal', 2, 'slice'], ['kopi-o-kosong', 1, null]],
    [['chwee-kueh', 4, null], ['kopi', 1, null]],
    [['prata-egg', 1, null], ['prata-plain', 1, null], ['teh', 1, null]],
    [['yogurt-greek', 1, 'tub'], ['banana', 1, null], ['almonds', 15, 'g']],
  ],
  lunch: [
    [['chicken-rice', 1, null]],
    [['fishball-noodles', 1, null]],
    [['fish-soup', 1, null], ['rice-white', 1, 'bowl']],
    [['yong-tau-foo', 1, null], ['rice-white', 0.5, 'bowl']],
    [['economy-rice', 1, null]],
    [['wanton-mee', 1, null]],
    [['thunder-tea-rice', 1, null]],
    [['ban-mian', 1, null]],
  ],
  dinner: [
    [['chicken-breast', 150, 'g'], ['rice-brown', 1, 'bowl'], ['broccoli', 1, 'cup']],
    [['salmon', 1, 'fillet'], ['sweet-potato', 1, 'medium'], ['lettuce', 1, 'bowl']],
    [['bak-chor-mee', 1, null]],
    [['char-siew-rice', 1, null]],
    [['tofu-firm', 150, 'g'], ['stirfry-greens', 1, 'plate'], ['rice-white', 1, 'bowl']],
    [['duck-rice', 1, null]],
  ],
  weekendDinner: [
    [['laksa', 1, null], ['chendol', 1, null]],
    [['satay', 10, null], ['beef-hor-fun', 1, null]],
    [['chicken-rice-roasted', 1, null], ['fries', 1, 'medium'], ['cola', 1, 'can']],
    [['pizza', 3, 'slice']],
  ],
  snacks: [
    [['apple', 1, null]],
    [['whey', 1, 'scoop']],
    [['almonds', 1, 'handful']],
    [['banana', 1, null]],
    [['bubble-tea', 1, null]],
    [],
  ],
};


/** Small seeded PRNG (mulberry32) so the demo looks the same every load. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mealFromFood(id, qty, unit, date, slot) {
  const food = findFood(id);
  const { grams, amount } = resolveAmount(food, qty, unit);
  return { date, slot, name: food.name, amount, grams, ...nutritionFor(food, grams) };
}

/**
 * @param {string} today last day of data; only breakfast and lunch are
 *   logged for it, so the Today view shows a day in progress.
 */
export function demoData(today) {
  const rand = prng(20261026);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const noise = () => (rand() + rand() + rand() - 1.5) * 0.5; // ~N(0, 0.25)

  const meals = [];
  const weights = [];
  let trueKg = 79.4;

  for (let i = DEMO_DAYS - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const isToday = i === 0;

    // Weigh in most mornings; Monday water weight after the weekend.
    if (isToday || rand() < 0.82) {
      const water = weekday === 1 ? 0.4 : 0;
      weights.push({ date, kg: Math.round((trueKg + noise() + water) * 10) / 10 });
    }

    const slots = isToday ? ['breakfast', 'lunch'] : ['breakfast', 'lunch', 'dinner', 'snacks'];
    let eaten = 0;
    for (const slot of slots) {
      const menu = slot === 'dinner' && weekend ? MENU.weekendDinner : MENU[slot];
      for (const [id, qty, unit] of pick(menu)) {
        const meal = mealFromFood(id, qty, unit, date, slot);
        meals.push(meal);
        eaten += meal.kcal;
      }
    }
    // A late supper now and then.
    if (!isToday && rand() < 0.2) {
      const meal = mealFromFood('bread-white', 2, 'slice', date, 'snacks');
      meals.push(meal);
      eaten += meal.kcal;
    }

    if (!isToday) trueKg -= (DEMO_TRUE_MAINTENANCE - eaten) / KCAL_PER_KG;
  }

  return { profile: { ...DEMO_PROFILE }, weights, meals, foods: [], ...demoExtras(today) };
}

/**
 * Water, exercise, tape measurements and a few fasts for the sample. They
 * use their own random sequence, so the food and weight data stay the same.
 */
function demoExtras(today) {
  const rand = prng(7);
  const water = [];
  const exercises = [];
  const measurements = [];
  const fasts = [];
  const checkins = [];
  const kg = 76;

  for (let i = DEMO_DAYS - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    water.push({ date, ml: i === 0 ? 1000 : 1750 + 250 * Math.floor(rand() * 5) });

    const steps = 5000 + Math.floor(rand() * 60) * 100;
    exercises.push({ date, activity: 'steps', name: `${steps.toLocaleString('en-US')} steps`, minutes: null, steps, kcal: stepsKcal(steps, kg) });
    for (const [day, id, minutes] of WORKOUTS) {
      if (day !== weekday || i === 0) continue;
      const a = findActivity(id);
      exercises.push({ date, activity: id, name: a.name, minutes, steps: null, kcal: exerciseKcal(a.met, kg, minutes) });
    }

    const sleepHours = Math.round((6 + rand() * 2.5) * 4) / 4;
    checkins.push({
      date,
      sleepHours,
      sleepQuality: Math.min(5, Math.max(1, Math.round(sleepHours - 3.5 + rand()))),
      mood: Math.min(5, Math.max(1, Math.round(2.5 + rand() * 2.5))),
      note: '',
    });

    // Tape measurements every two weeks, the waist slowly coming down.
    if (i % 14 === 0) {
      measurements.push({ date, waistCm: Math.round((84 + i * 0.08) * 10) / 10, neckCm: 38, hipCm: null });
    }
    // A 16:8 fast on most weekdays of the last two weeks.
    if (i > 0 && i <= 14 && weekday >= 1 && weekday <= 4) {
      const start = new Date(`${addDays(date, -1)}T20:00:00+08:00`);
      const end = new Date(start.getTime() + (15.5 + rand() * 2) * 3600000);
      fasts.push({ start: start.toISOString(), end: new Date(Math.round(end.getTime() / 60000) * 60000).toISOString() });
    }
  }
  return { water, exercises, measurements, fasts, checkins };
}
